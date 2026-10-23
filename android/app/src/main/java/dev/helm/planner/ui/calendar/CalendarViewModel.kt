package dev.helm.planner.ui.calendar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.ui.common.minuteTicks
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.connectionStatus
import java.time.Instant
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What the calendar shows: every task from Room, today and the minute of the day in the user's time zone. */
data class CalendarUiState(
    val tasks: List<Task>,
    val today: String,
    val nowMinute: Int,
    val connection: ConnectionStatus,
    val pendingChanges: Int,
)

/** What the user can do on the calendar; a move changes Room first and queues the server change, like Today. */
interface CalendarActions {
    /** Sets the task's day and time (null: no time); the same call undoes a move. */
    fun move(localId: String, date: String, time: String?) {}
    fun openTask(localId: String) {}
    fun openSettings() {}
}

class CalendarViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    network: NetworkMonitor,
    liveSync: LiveSync,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), CalendarActions {

    val state: StateFlow<CalendarUiState?> =
        combine(
            repository.tasks,
            settings.settings,
            minuteTicks(clock),
            connectionStatus(settings.settings, network.online, liveSync.state),
            repository.pendingChanges,
        ) { tasks, s, now, c, pending ->
            val local = Instant.ofEpochMilli(now).atZone(HelmDates.zone(s.timezone))
            CalendarUiState(tasks, local.toLocalDate().toString(), local.hour * 60 + local.minute, c, pending)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun move(localId: String, date: String, time: String?) {
        viewModelScope.launch { repository.setDue(localId, date, time) }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
