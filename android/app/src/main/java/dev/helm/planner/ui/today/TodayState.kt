package dev.helm.planner.ui.today

import dev.helm.planner.domain.TodaySections

/** The connection line at the top of Today. */
enum class ConnectionStatus { SYNCED, CONNECTING, OFFLINE, OFFLINE_MODE, NOT_CONFIGURED, UNAUTHORIZED, ERROR }

data class TodayUiState(
    val sections: TodaySections,
    val connection: ConnectionStatus,
    val pendingChanges: Int,
)

/** What the user can do on Today; every call changes Room first and queues the server change. */
interface TodayActions {
    fun complete(localId: String) {}
    fun reopen(localId: String) {}
    fun moveTo(localId: String, date: String) {}
    fun archive(localId: String) {}
    fun setNow(localId: String) {}
    fun clearNow() {}
    fun saveResumeNote(localId: String, note: String) {}
    fun add(title: String, dueDate: String?, dueTime: String?, note: String?) {}
    fun openSettings() {}
    fun openTask(localId: String) {}
}
