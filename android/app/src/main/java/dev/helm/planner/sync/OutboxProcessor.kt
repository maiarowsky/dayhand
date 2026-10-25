package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

/** Durable append-only queue of task changes. Project management never enters it. */
interface OutboxStore {
    suspend fun next(): OutboxOp?
    suspend fun serverIdOf(taskLocalId: String): String?
    suspend fun acknowledge(op: OutboxOp, value: JsonElement)
    suspend fun reject(op: OutboxOp, reason: String)
    /** Keep the task and queued edits, removing only the refused assignment and its dependent proof. */
    suspend fun clearProjectAssignment(op: OutboxOp) {}
    /** Keep a local occurrence whose proof the server refused, sending it as an ordinary task. */
    suspend fun dropRepeatProof(op: OutboxOp)
    suspend fun recordFailure(op: OutboxOp, reason: String)
}

enum class DrainResult { DONE, MORE_LEFT, RETRY_LATER, UNAUTHORIZED }

/** One ordered drain, shared by the worker and online commands. Lost replies are safe by clientId. */
class OutboxProcessor(
    private val store: OutboxStore,
    private val sender: MutationSender,
    private val maxOpsPerRun: Int = MAX_OPS_PER_RUN,
    private val queries: QueryRunner? = sender as? QueryRunner,
) {
    suspend fun drain(): DrainResult = drainLock.withLock { drainInOrder() }

    private suspend fun drainInOrder(): DrainResult {
        repeat(maxOpsPerRun) {
            val op = store.next() ?: return DrainResult.DONE
            val args = argsFor(op)
            if (args == null) {
                store.reject(op, "task never reached the server")
                return@repeat
            }
            when (val result = sender.send(op.mutation, args)) {
                is SendResult.Applied -> store.acknowledge(op, result.value)
                is SendResult.Rejected -> {
                    when (assignmentRefused(op, args, result)) {
                        true -> store.clearProjectAssignment(op) // Retry the same seq, not a new/reordered task.
                        null -> return DrainResult.RETRY_LATER
                        false -> when {
                            op.mutation != Mutations.ADD || "repeatedFrom" !in args -> store.reject(op, result.message)
                            result.code != null -> store.dropRepeatProof(op)
                            else -> {
                                store.recordFailure(op, "local repeat not accepted")
                                return DrainResult.RETRY_LATER
                            }
                        }
                    }
                }
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

    /** Only a confirmed deleted/archived target permits stripping an assignment, never an unrelated validation error. */
    private suspend fun assignmentRefused(op: OutboxOp, args: JsonObject, result: SendResult.Rejected): Boolean? {
        if (op.mutation !in setOf(Mutations.ADD, Mutations.UPDATE) || result.code !in setOf("invalid_argument", "not_found")) return false
        val id = (args["projectId"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return false
        return when (val projects = queries?.query(RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap()))) {
            is SendResult.Applied -> RemoteJson.projects(projects.value).firstOrNull { it.serverId == id }?.archived != false
            else -> {
                store.recordFailure(op, "project assignment lookup unavailable")
                null
            }
        }
    }

    private suspend fun argsFor(op: OutboxOp): JsonObject? {
        var args = Json.parseToJsonElement(op.argsJson).jsonObject
        val parent = (args["repeatParentLocalId"] as? JsonPrimitive)?.content
        if (parent != null) {
            val parentId = store.serverIdOf(parent)
            val completedBy = args["repeatCompletedBy"]
            val completedOn = args["repeatCompletedOn"]
            args = JsonObject(args - REPEAT_PROOF_KEYS)
            if (parentId != null && completedBy != null && completedOn != null) args = JsonObject(args + ("repeatedFrom" to buildJsonObject {
                put("taskId", JsonPrimitive(parentId))
                put("completedBy", completedBy)
                put("completedOn", completedOn)
            }))
        }
        val localId = op.taskLocalId
        if (localId == null || op.mutation == Mutations.ADD) return args
        val serverId = store.serverIdOf(localId) ?: return null
        return JsonObject(args + ("taskId" to JsonPrimitive(serverId)))
    }

    companion object {
        const val MAX_OPS_PER_RUN = 200
        internal val REPEAT_PROOF_KEYS = setOf("repeatParentLocalId", "repeatCompletedBy", "repeatCompletedOn", "repeatedFrom")
        private val drainLock = Mutex()
    }
}
