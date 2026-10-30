package dev.helm.planner.sync

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.RemoteTask
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * A known task that both lists of a snapshot miss was purged, or it moved between the trash and the active list while
 * the two lists were read (`app:listAll` and `app:listTrash` are separate queries). `app:getTask` tells them apart.
 * A proposal out of the trash goes too: `app:listAll` leaves proposals out.
 */
object MissingTasks {
    /** [found]: tasks the server still has, to merge with the snapshot. [keep]: local ids of tasks not checked now. */
    data class Check(val found: List<RemoteTask> = emptyList(), val keep: Set<String> = emptySet())

    /**
     * Every missing task the server answers "not found" for, or whose id it does not take for a task id (an id of
     * another deployment), is gone. One with no answer (offline, a server hiccup) stays until a later snapshot.
     * Without [queries] (no server) nothing is checked, as before.
     */
    suspend fun check(local: List<Task>, remote: List<RemoteTask>, queries: suspend () -> QueryRunner?): Check {
        val listed = remote.mapTo(HashSet()) { it.id }
        val missing = local.filter { it.serverId != null && it.serverId !in listed }
        if (missing.isEmpty()) return Check()
        val runner = queries() ?: return Check()
        val found = mutableListOf<RemoteTask>()
        val keep = mutableSetOf<String>()
        for (task in missing) {
            val serverId = requireNotNull(task.serverId)
            when (val result = runner.query(RemoteJson.QUERY_TASK, buildJsonObject { put("taskId", serverId) })) {
                is SendResult.Applied -> {
                    val json = (result.value as? JsonObject)?.get("task") as? JsonObject
                    val read = json?.let(RemoteJson::task)
                    val proposal = (json?.get("proposedAt") as? JsonPrimitive)?.doubleOrNull != null
                    if (read?.id == serverId) {
                        if (!proposal || read.deletedAt != null) found += read
                    } else {
                        keep += task.localId
                    }
                }
                is SendResult.Rejected -> if (result.code !in UNKNOWN_TASK) keep += task.localId
                SendResult.Unauthorized, is SendResult.Failed -> keep += task.localId
            }
        }
        return Check(found, keep)
    }

    private val UNKNOWN_TASK = setOf("not_found", "invalid_argument")
}
