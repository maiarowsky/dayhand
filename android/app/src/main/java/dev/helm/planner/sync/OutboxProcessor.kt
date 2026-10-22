package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** Durable queue of local changes, as the processor needs it. */
interface OutboxStore {
    /** The oldest waiting change, or null when everything was sent. */
    suspend fun next(): OutboxOp?

    suspend fun serverIdOf(taskLocalId: String): String?

    /** The server applied [op]: forget it (and remember the server id of a new task). */
    suspend fun acknowledge(op: OutboxOp, value: JsonElement)

    /** The server refused [op] for good: forget it and let the next snapshot repair the row. */
    suspend fun reject(op: OutboxOp, reason: String)

    suspend fun recordFailure(op: OutboxOp, reason: String)
}

enum class DrainResult { DONE, MORE_LEFT, RETRY_LATER, UNAUTHORIZED }

/**
 * Sends the outbox strictly in order, one change at a time. A change leaves the queue only
 * when the server answered; on any doubt the processor stops, so nothing behind it can
 * overtake it. Resending after a lost answer is safe because every change carries the
 * `clientId` the backend deduplicates on.
 */
class OutboxProcessor(
    private val store: OutboxStore,
    private val sender: MutationSender,
    private val maxOpsPerRun: Int = MAX_OPS_PER_RUN,
) {
    suspend fun drain(): DrainResult {
        repeat(maxOpsPerRun) {
            val op = store.next() ?: return DrainResult.DONE
            val args = argsFor(op)
            if (args == null) {
                store.reject(op, "task never reached the server")
                return@repeat
            }
            when (val result = sender.send(op.mutation, args)) {
                is SendResult.Applied -> store.acknowledge(op, result.value)
                is SendResult.Rejected -> store.reject(op, result.message)
                SendResult.Unauthorized -> {
                    store.recordFailure(op, "unauthorized")
                    return DrainResult.UNAUTHORIZED
                }
                is SendResult.Failed -> {
                    store.recordFailure(op, result.message)
                    return DrainResult.RETRY_LATER
                }
            }
        }
        return if (store.next() == null) DrainResult.DONE else DrainResult.MORE_LEFT
    }

    /** Stored arguments plus the task's server id, which a task created offline gets only after its `add`. */
    private suspend fun argsFor(op: OutboxOp): JsonObject? {
        val args = Json.parseToJsonElement(op.argsJson).jsonObject
        val localId = op.taskLocalId
        if (localId == null || op.mutation == Mutations.ADD) return args
        val serverId = store.serverIdOf(localId) ?: return null
        return JsonObject(args + ("taskId" to JsonPrimitive(serverId)))
    }

    companion object {
        const val MAX_OPS_PER_RUN = 200
    }
}
