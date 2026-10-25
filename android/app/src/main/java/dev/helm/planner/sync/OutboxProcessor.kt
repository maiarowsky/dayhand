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

    suspend fun projectServerIdOf(localId: String): String? = null
    suspend fun linkProject(op: OutboxOp, serverId: String) {}

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
    private val queries: dev.helm.planner.data.remote.QueryRunner? = sender as? dev.helm.planner.data.remote.QueryRunner,
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
                is SendResult.Rejected -> {
                    // Two devices may create the same name offline. Only a confirmed name match repairs that conflict.
                    if (op.mutation == Mutations.ADD_PROJECT && result.code == "invalid_argument") {
                        when (val projects = queries?.query(dev.helm.planner.data.remote.RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap()))) {
                            is SendResult.Applied -> {
                                val name = (args["name"] as? JsonPrimitive)?.content.orEmpty()
                                val match = dev.helm.planner.data.remote.RemoteJson.projects(projects.value).firstOrNull {
                                    dev.helm.planner.domain.ProjectRules.nameKey(it.name) == dev.helm.planner.domain.ProjectRules.nameKey(name)
                                }
                                if (match != null) {
                                    store.linkProject(op, requireNotNull(match.serverId))
                                    store.acknowledge(op, kotlinx.serialization.json.buildJsonObject {
                                        put("project", kotlinx.serialization.json.buildJsonObject { put("id", JsonPrimitive(match.serverId)) })
                                    })
                                } else store.reject(op, result.message)
                            }
                            else -> {
                                store.recordFailure(op, "project conflict lookup unavailable")
                                return DrainResult.RETRY_LATER
                            }
                        }
                    } else store.reject(op, result.message)
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

    /** Stored arguments plus the task's server id, which a task created offline gets only after its `add`. */
    private suspend fun argsFor(op: OutboxOp): JsonObject? {
        var args = Json.parseToJsonElement(op.argsJson).jsonObject
        val projectId = op.projectLocalId
        if (projectId != null && op.mutation != Mutations.ADD_PROJECT) {
            val serverId = store.projectServerIdOf(projectId) ?: return null
            args = JsonObject(args + ("projectId" to JsonPrimitive(serverId)))
        }
        val target = (args["moveTasksToLocalId"] as? JsonPrimitive)?.content
        if (target != null) {
            val serverId = store.projectServerIdOf(target) ?: return null
            args = JsonObject(args - "moveTasksToLocalId" + ("moveTasksTo" to JsonPrimitive(serverId)))
        }
        val localId = op.taskLocalId
        if (localId == null || op.mutation == Mutations.ADD) return args
        val serverId = store.serverIdOf(localId) ?: return null
        return JsonObject(args + ("taskId" to JsonPrimitive(serverId)))
    }

    companion object {
        const val MAX_OPS_PER_RUN = 200
    }
}
