package dev.helm.planner.ui.board

import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.BoardColumns
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.today.ConnectionStatus

data class BoardUiState(
    val columns: BoardColumns,
    val connection: ConnectionStatus,
    val pendingChanges: Int,
    /** The zone quick add reads a date phrase in: the server's, or the phone's on this phone only. */
    val timezone: String = HelmDates.DEFAULT_TIMEZONE,
    /** Tasks that cannot go on (a blocked reason or a dependency not done), by local id. */
    val blocked: Map<String, AgentWork.Blocked> = emptyMap(),
)

/** What the user can do on the board; every call changes Room first and queues the server change. */
interface BoardActions {
    fun move(localId: String, status: TaskStatus) {}
    fun setNow(localId: String) {}
    fun clearNow() {}
    fun saveResumeNote(localId: String, note: String) {}
    fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectLocalId: String? = null) {}
    fun openTask(localId: String) {}
    fun openTrash() {}
    fun openSettings() {}
}
