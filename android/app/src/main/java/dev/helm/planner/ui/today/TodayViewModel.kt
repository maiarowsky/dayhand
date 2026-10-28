package dev.helm.planner.ui.today

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.daySections
import dev.helm.planner.sample.SamplePlan
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
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
    /** Keeps the day shown across a screen rotation and the app being restarted by the system. */
    private val savedState: SavedStateHandle,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), TodayActions {

    private val dayOffset = savedState.getStateFlow(DAY_OFFSET, 0)

    val state: StateFlow<TodayUiState?> =
        combine(
            combine(repository.tasks, dayOffset, ::Pair),
            settings.settings,
            minuteTicks(clock),
            connectionStatus(settings.settings, network.online, liveSync.state),
            repository.pendingChanges,
        ) { (tasks, offset), s, now, c, pending ->
            TodayUiState(
                daySections(tasks, now, s.timezone, offset),
                c,
                pending,
                sample = tasks.any { SamplePlan.isSample(it.localId) },
                timezone = s.timezone,
                blocked = AgentWork.blockedTasks(tasks),
                dayOffset = offset,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun complete(localId: String) = launch { repository.complete(localId) }
    override fun reopen(localId: String) = launch { repository.reopen(localId) }
    override fun moveTo(localId: String, date: String) = launch { repository.reschedule(localId, date) }
    override fun archive(localId: String) = launch { repository.archive(localId) }
    override fun setNow(localId: String) = launch { repository.setNow(localId) }
    override fun clearNow() = launch { repository.clearNow() }
    override fun saveResumeNote(localId: String, note: String) = launch { repository.setResumeNote(localId, note) }
    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) =
        launch { repository.add(title, dueDate, dueTime, note, projectId) }
    override fun removeSample() = launch { repository.removeSample() }
    override fun showDay(offset: Int) {
        savedState[DAY_OFFSET] = offset
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val DAY_OFFSET = "dayOffset"
    }
}
