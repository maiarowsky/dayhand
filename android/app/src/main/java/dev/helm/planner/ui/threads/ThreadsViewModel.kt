package dev.helm.planner.ui.threads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.Threads
import dev.helm.planner.ui.common.minuteTicks
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Every task on the phone and the time, once a minute, so ages move on; the threads and their groups come from them. */
data class ThreadsUiState(val tasks: List<Task>, val now: Long) {
    val groups: Threads.Groups = Threads.groups(tasks)
}

/** The Threads list and a thread's details share one model; closing a thread completes its task like any other. */
class ThreadsViewModel(private val repository: TaskRepository) : ViewModel() {
    val state = combine(repository.tasks, minuteTicks(System::currentTimeMillis)) { tasks, now -> ThreadsUiState(tasks, now) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun close(localId: String) { viewModelScope.launch { repository.complete(localId) } }
}
