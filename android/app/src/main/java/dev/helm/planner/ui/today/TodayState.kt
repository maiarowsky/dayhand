package dev.helm.planner.ui.today

import dev.helm.planner.domain.TodaySections
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.sync.FeedState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/** The connection line at the top of Today and in Settings. */
enum class ConnectionStatus { SYNCED, CONNECTING, OFFLINE, OFFLINE_MODE, NOT_CONFIGURED, UNAUTHORIZED, ERROR }

/** What the user should know about the server connection, most important first. */
fun connectionStatus(
    settings: Flow<AppSettings>,
    online: Flow<Boolean>,
    feed: Flow<FeedState>,
): Flow<ConnectionStatus> = combine(settings, online, feed) { s, isOnline, state ->
    when {
        // A phone the server signed out says so until it is paired again.
        s.backend == null -> if (s.pairingLost) ConnectionStatus.UNAUTHORIZED else ConnectionStatus.NOT_CONFIGURED
        s.offlineMode -> ConnectionStatus.OFFLINE_MODE
        !isOnline -> ConnectionStatus.OFFLINE
        state == FeedState.UNAUTHORIZED -> ConnectionStatus.UNAUTHORIZED
        state == FeedState.ERROR -> ConnectionStatus.ERROR
        state == FeedState.SYNCED -> ConnectionStatus.SYNCED
        else -> ConnectionStatus.CONNECTING
    }
}

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
