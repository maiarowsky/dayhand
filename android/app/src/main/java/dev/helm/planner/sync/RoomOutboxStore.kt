package dev.helm.planner.sync

import androidx.room.withTransaction
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class RoomOutboxStore(private val db: HelmDatabase) : OutboxStore {
    override suspend fun next(): OutboxOp? = db.outbox().first()

    override suspend fun serverIdOf(taskLocalId: String): String? = db.tasks().byLocalId(taskLocalId)?.serverId

    override suspend fun projectServerIdOf(localId: String): String? = db.projects().byLocalId(localId)?.serverId

    override suspend fun linkProject(op: OutboxOp, serverId: String) = db.withTransaction {
        val id = op.projectLocalId ?: return@withTransaction
        // If the feed arrived first, keep the offline local id and re-point the feed's tasks before removing its row.
        val duplicate = db.projects().all().firstOrNull { it.serverId == serverId && it.localId != id }
        if (duplicate != null) {
            db.tasks().upsert(db.tasks().all().filter { it.projectLocalId == duplicate.localId }.map { it.copy(projectLocalId = id) })
            db.projects().delete(listOf(duplicate.localId))
        }
        db.projects().setServerId(id, serverId)
    }

    override suspend fun acknowledge(op: OutboxOp, value: JsonElement) = db.withTransaction {
        db.outbox().delete(op.seq)
        val localId = op.taskLocalId
        val serverId = ((value as? JsonObject)?.get("id") as? JsonPrimitive)?.content
        if (op.mutation == Mutations.ADD && localId != null && serverId != null) {
            db.tasks().setServerId(localId, serverId)
        }
        val projectId = op.projectLocalId
        if (op.mutation == Mutations.ADD_PROJECT && projectId != null) {
            val id = (((value as? JsonObject)?.get("project") as? JsonObject)?.get("id") as? JsonPrimitive)?.content
            if (id != null) linkProject(op, id)
        }
        if (op.mutation == Mutations.DELETE_PROJECT && projectId != null) db.projects().delete(listOf(projectId))
        if (op.mutation in setOf(Mutations.ADD_PROJECT, Mutations.DELETE_PROJECT)) {
            db.tasks().upsert(db.tasks().all().map { it.copy(serverUpdatedAt = null) })
        }
        if (op.mutation == Mutations.RELEASE && localId != null) {
            db.tasks().byLocalId(localId)?.let { db.tasks().upsert(listOf(it.copy(serverUpdatedAt = null))) }
        }
    }

    override suspend fun reject(op: OutboxOp, reason: String) = db.withTransaction {
        db.outbox().delete(op.seq)
        if (op.mutation in setOf(Mutations.ADD_PROJECT, Mutations.UPDATE_PROJECT, Mutations.DELETE_PROJECT)) {
            val id = op.projectLocalId ?: return@withTransaction
            val project = db.projects().byLocalId(id)
            if (op.mutation == Mutations.ADD_PROJECT) {
                db.projects().delete(listOf(id))
                db.tasks().upsert(db.tasks().all().filter { it.projectLocalId == id }.map { it.copy(projectLocalId = null, serverUpdatedAt = null) })
                // A refused project must never take the user's unsent tasks with it.
                db.outbox().all().filter { it.projectLocalId == id }.forEach { waiting ->
                    if (waiting.taskLocalId == null) db.outbox().delete(waiting.seq) else {
                        val args = kotlinx.serialization.json.Json.parseToJsonElement(waiting.argsJson) as JsonObject
                        db.outbox().upsert(waiting.copy(projectLocalId = null,
                            argsJson = (if (waiting.mutation == Mutations.ADD) JsonObject(args - "projectId")
                            else JsonObject(args + ("projectId" to kotlinx.serialization.json.JsonNull))).toString()))
                    }
                }
            } else if (project != null) db.projects().upsert(listOf(project.copy(deletedAt = null, serverUpdatedAt = null)))
            return@withTransaction
        }
        val localId = op.taskLocalId ?: return@withTransaction
        if (op.mutation == Mutations.ADD) {
            // The task never existed on the server: drop it and every change made to it since.
            db.outbox().deleteForTask(localId)
            db.tasks().delete(listOf(localId))
        } else {
            // Forget the server version so the next snapshot overwrites the refused local change.
            db.tasks().byLocalId(localId)?.let { db.tasks().upsert(listOf(it.copy(serverUpdatedAt = null))) }
        }
    }

    override suspend fun recordFailure(op: OutboxOp, reason: String) = db.outbox().recordFailure(op.seq, reason)
}
