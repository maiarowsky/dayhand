package dev.helm.planner.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.domain.todaySections
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.ui.common.connectionStatus
import dev.helm.planner.ui.common.minuteTicks
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TodayViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    network: NetworkMonitor,
    liveSync: LiveSync,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), TodayActions {

    val state: StateFlow<TodayUiState?> =
        combine(
            repository.tasks,
            settings.settings,
            minuteTicks(clock),
            connectionStatus(settings.settings, network.online, liveSync.state),
            repository.pendingChanges,
        ) { tasks, s, now, c, pending ->
            TodayUiState(todaySections(tasks, now, s.timezone), c, pending)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun complete(localId: String) = launch { repository.complete(localId) }
    override fun reopen(localId: String) = launch { repository.reopen(localId) }
    override fun moveTo(localId: String, date: String) = launch { repository.reschedule(localId, date) }
    override fun archive(localId: String) = launch { repository.archive(localId) }
    override fun setNow(localId: String) = launch { repository.setNow(localId) }
    override fun clearNow() = launch { repository.clearNow() }
    override fun saveResumeNote(localId: String, note: String) = launch { repository.setResumeNote(localId, note) }
    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?) =
        launch { repository.add(title, dueDate, dueTime, note) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
