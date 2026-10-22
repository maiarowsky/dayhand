package dev.helm.planner.ui.trash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.ui.common.minuteTicks
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TrashViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), TrashActions {
    val state: StateFlow<TrashUiState?> =
        combine(repository.tasks, settings.settings, minuteTicks(clock)) { tasks, s, now ->
            TrashUiState(
                tasks = tasks.filter { it.inTrash }.sortedByDescending { it.deletedAt },
                today = HelmDates.localDate(now, s.timezone),
                timezone = s.timezone,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun restore(localId: String) {
        viewModelScope.launch { repository.restore(localId) }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
