package dev.helm.planner.ui.task

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.historyEntry
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.sync.TaskHistorySync
import dev.helm.planner.ui.common.minuteTicks
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One task's details; [open] picks the task, so one instance serves every details screen. */
@OptIn(ExperimentalCoroutinesApi::class)
class TaskDetailViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    private val historySync: TaskHistorySync,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), TaskDetailActions {

    private val selected = MutableStateFlow<String?>(null)
    private val historyState = MutableStateFlow(HistoryState.LOADING)

    private val task: Flow<Task?> = selected.flatMapLatest { id -> id?.let(repository::task) ?: flowOf(null) }

    private val history = task.map { it?.serverId }.distinctUntilChanged().flatMapLatest { serverId ->
        serverId?.let(repository::history)?.map { events -> events.map(::historyEntry) } ?: flowOf(emptyList())
    }

    private val pending = selected.flatMapLatest { id -> id?.let(repository::pendingChangesFor) ?: flowOf(0) }

    /** The tasks by server id (to name the tasks this one waits for). */
    private val others = repository.tasks.map { tasks ->
        Others(tasks.filter { it.serverId != null }.associateBy { it.serverId!! })
    }

    private val today = combine(settings.settings, minuteTicks(clock)) { s, now -> Today(s.timezone, HelmDates.localDate(now, s.timezone), s.reminderMinutes) }

    val state: StateFlow<TaskDetailUiState?> =
        combine(task, history, combine(historyState, pending, ::Pair), others, today) { task, history, (historyState, pending), others, day ->
            if (task == null) {
                TaskDetailUiState.Missing(selected.value.orEmpty())
            } else {
                TaskDetailUiState.Ready(
                    task, day.date, day.zone, history, historyState, pending, day.reminders,
                    dependencies = AgentWork.dependencies(task, others.byServerId),
                )
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    private data class Today(val zone: String, val date: String, val reminders: List<Int>)

    private data class Others(val byServerId: Map<String, Task>)

    init {
        // Fetch the server's history when the task is opened and whenever a newer server copy arrives.
        viewModelScope.launch {
            task.map { it?.serverId to it?.serverUpdatedAt }.distinctUntilChanged().collectLatest { (serverId, _) ->
                historyState.value = historySync.refresh(serverId)
            }
        }
    }

    fun open(localId: String) {
        if (selected.value == localId) return
        historyState.value = HistoryState.LOADING
        selected.value = localId
    }

    override fun rename(localId: String, title: String) = launch { repository.rename(localId, title) }
    override fun setNote(localId: String, note: String) = launch { repository.setNote(localId, note) }
    override fun setDue(localId: String, date: String?, time: String?) = launch { repository.setDue(localId, date, time) }
    override fun setRepeat(localId: String, rule: RepeatRule?) = launch { repository.setRepeat(localId, rule) }
    override fun setLinks(localId: String, links: List<TaskLink>) = launch { repository.setLinks(localId, links) }
    override fun setReminders(localId: String, reminders: List<TaskReminder>?) = launch { repository.setReminders(localId, reminders) }
    override fun toggleItem(localId: String, itemId: String) = launch { repository.toggleItem(localId, itemId) }
    override fun addItem(localId: String, title: String) = launch { repository.addItem(localId, title) }
    override fun renameItem(localId: String, itemId: String, title: String) = launch { repository.renameItem(localId, itemId, title) }
    override fun removeItem(localId: String, itemId: String) = launch { repository.removeItem(localId, itemId) }
    override fun moveItem(localId: String, itemId: String, by: Int) = launch { repository.moveItem(localId, itemId, by) }
    override fun move(localId: String, status: TaskStatus) = launch { repository.moveTo(localId, status) }
    override fun setNow(localId: String) = launch { repository.setNow(localId) }
    override fun clearNow() = launch { repository.clearNow() }
    override fun saveResumeNote(localId: String, note: String) = launch { repository.setResumeNote(localId, note) }
    override fun moveToTrash(localId: String) = launch { repository.moveToTrash(localId) }
    override fun restore(localId: String) = launch { repository.restore(localId) }
    override fun release(localId: String) = launch { repository.release(localId) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
