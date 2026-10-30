package dev.helm.planner.sync

import androidx.room.withTransaction
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * Rewrites a queued change without a refused assignment and the proof valid only in that project. An update keeps the
 * server's previous project rather than clearing it, and one left with nothing to change is removed.
 */
suspend fun HelmDatabase.dropAssignment(op: OutboxOp, args: JsonObject) {
    val kept = JsonObject(args - OutboxProcessor.REPEAT_PROOF_KEYS - "projectId")
    if (op.mutation == Mutations.UPDATE && (kept.keys - "clientId").isEmpty()) outbox().delete(op.seq)
    else outbox().upsert(op.copy(argsJson = kept.toString()))
}

class RoomOutboxStore(private val db: HelmDatabase) : OutboxStore {
    override suspend fun next(): OutboxOp? = db.outbox().first()
    override suspend fun serverIdOf(taskLocalId: String): String? = db.tasks().byLocalId(taskLocalId)?.serverId

    override suspend fun acknowledge(op: OutboxOp, value: JsonElement) = db.withTransaction {
        db.outbox().delete(op.seq)
        val localId = op.taskLocalId
        val serverId = ((value as? JsonObject)?.get("id") as? JsonPrimitive)?.content
        if (op.mutation == Mutations.ADD && localId != null && serverId != null) db.tasks().setServerId(localId, serverId)
        if ((op.mutation == Mutations.RELEASE || op.mutation == Mutations.COMPLETE) && localId != null) {
            db.tasks().byLocalId(localId)?.let { db.tasks().upsert(listOf(it.copy(serverUpdatedAt = null))) }
        }
    }

    override suspend fun clearProjectAssignment(op: OutboxOp) = db.withTransaction {
        val localId = op.taskLocalId ?: return@withTransaction
        val refused = Json.parseToJsonElement(op.argsJson).jsonObject["projectId"]
        val waiting = db.outbox().all().map { it to Json.parseToJsonElement(it.argsJson).jsonObject }
        var affected = setOf(localId)
        do {
            val previous = affected
            affected = affected + waiting.filter { (_, args) ->
                args["projectId"] == refused && (args["repeatParentLocalId"] as? JsonPrimitive)?.content in previous
            }.mapNotNull { it.first.taskLocalId }
        } while (affected != previous)
        db.tasks().upsert(db.tasks().all().filter { it.localId in affected && JsonPrimitive(it.projectId) == refused }
            .map { it.copy(projectId = null, serverUpdatedAt = null) })
        waiting.filter { (change, args) -> change.taskLocalId in affected && args["projectId"] == refused }.forEach { (change, args) ->
            db.dropAssignment(change, args)
        }
    }

    override suspend fun dropRepeatProof(op: OutboxOp) = db.outbox().upsert(op.copy(
        argsJson = JsonObject(Json.parseToJsonElement(op.argsJson).jsonObject - OutboxProcessor.REPEAT_PROOF_KEYS).toString()))

    override suspend fun reject(op: OutboxOp, reason: String) = db.withTransaction {
        db.outbox().delete(op.seq)
        val localId = op.taskLocalId ?: return@withTransaction
        if (op.mutation == Mutations.ADD) {
            db.outbox().deleteForTask(localId)
            db.tasks().delete(listOf(localId))
        } else db.tasks().byLocalId(localId)?.let { db.tasks().upsert(listOf(it.copy(serverUpdatedAt = null))) }
    }

    override suspend fun recordFailure(op: OutboxOp, reason: String) = db.outbox().recordFailure(op.seq, reason)
}
