package dev.helm.planner.ui.board

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.boardColumns
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.ui.common.minuteTicks
import dev.helm.planner.ui.today.connectionStatus
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class BoardViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    network: NetworkMonitor,
    liveSync: LiveSync,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), BoardActions {

    val state: StateFlow<BoardUiState?> =
        combine(
            repository.tasks,
            settings.settings,
            minuteTicks(clock),
            connectionStatus(settings.settings, network.online, liveSync.state),
            repository.pendingChanges,
        ) { tasks, s, now, c, pending ->
            BoardUiState(boardColumns(tasks, now, s.timezone), c, pending, timezone = s.timezone, blocked = AgentWork.blockedTasks(tasks))
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun move(localId: String, status: TaskStatus) = launch { repository.moveTo(localId, status) }
    override fun setNow(localId: String) = launch { repository.setNow(localId) }
    override fun clearNow() = launch { repository.clearNow() }
    override fun saveResumeNote(localId: String, note: String) = launch { repository.setResumeNote(localId, note) }
    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) =
        launch { repository.add(title, dueDate, dueTime, note, projectId) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
