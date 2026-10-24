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

    override suspend fun acknowledge(op: OutboxOp, value: JsonElement) = db.withTransaction {
        db.outbox().delete(op.seq)
        val localId = op.taskLocalId
        val serverId = ((value as? JsonObject)?.get("id") as? JsonPrimitive)?.content
        if (op.mutation == Mutations.ADD && localId != null && serverId != null) {
            db.tasks().setServerId(localId, serverId)
        }
        if (op.mutation == Mutations.RELEASE && localId != null) {
            db.tasks().byLocalId(localId)?.let { db.tasks().upsert(listOf(it.copy(serverUpdatedAt = null))) }
        }
    }

    override suspend fun reject(op: OutboxOp, reason: String) = db.withTransaction {
        db.outbox().delete(op.seq)
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
