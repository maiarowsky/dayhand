package dev.helm.planner.sync

import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteHistoryEntry
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Whether the details screen shows a fresh history or the last cached copy. */
enum class HistoryState { LOADING, FRESH, CACHED, NOT_ON_SERVER_YET }

/**
 * Fetches a task's change history (`app:getTask`) and caches it in Room, so the details screen
 * shows who changed what (the app or the agent) also offline. History lives only on the server:
 * a change still in the outbox appears in it once it was sent.
 */
class TaskHistorySync(
    /** The query runner for the configured backend, or null when offline or not set up. */
    private val runner: suspend () -> QueryRunner?,
    private val save: suspend (serverId: String, entries: List<RemoteHistoryEntry>) -> Unit,
) {
    suspend fun refresh(serverId: String?): HistoryState {
        if (serverId == null) return HistoryState.NOT_ON_SERVER_YET
        val queries = runner() ?: return HistoryState.CACHED
        val result = queries.query(RemoteJson.QUERY_TASK, buildJsonObject { put("taskId", serverId) })
        if (result !is SendResult.Applied) return HistoryState.CACHED
        save(serverId, RemoteJson.history(result.value))
        return HistoryState.FRESH
    }
}
