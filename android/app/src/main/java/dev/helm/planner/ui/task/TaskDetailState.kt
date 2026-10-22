package dev.helm.planner.ui.task

import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.sync.HistoryState

sealed interface TaskDetailUiState {
    /** The task is gone from the phone (purged from the trash, or never reached the server). */
    data class Missing(val localId: String) : TaskDetailUiState

    data class Ready(
        val task: Task,
        /** Today in the user's time zone, YYYY-MM-DD. */
        val today: String,
        val timezone: String,
        /** Newest first. */
        val history: List<HistoryEntry>,
        val historyState: HistoryState,
        /** Changes to this task still waiting in the outbox (not in the server's history yet). */
        val pendingChanges: Int,
        /** Every label in use, offered when adding one. */
        val knownLabels: List<String>,
    ) : TaskDetailUiState
}

/** Edits on the details screen; each one changes Room first and queues one server change. */
interface TaskDetailActions {
    fun rename(localId: String, title: String) {}
    fun setNote(localId: String, note: String) {}
    fun setDue(localId: String, date: String?, time: String?) {}
    fun setRepeat(localId: String, rule: RepeatRule?) {}
    fun setLabels(localId: String, labels: List<String>) {}
    fun setLinks(localId: String, links: List<TaskLink>) {}
    fun move(localId: String, status: TaskStatus) {}
    fun setNow(localId: String) {}
    fun clearNow() {}
    fun saveResumeNote(localId: String, note: String) {}
    fun moveToTrash(localId: String) {}
    fun restore(localId: String) {}
    fun back() {}
}
