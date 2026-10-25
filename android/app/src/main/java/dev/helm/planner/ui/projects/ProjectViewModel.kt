package dev.helm.planner.ui.projects

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.ui.common.minuteTicks
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.board.BoardActions
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ProjectUiState(val project: Project?, val projectId: String?, val label: String?, val tasks: List<Task>, val today: String, val timezone: String,
                          val blocked: Map<String, dev.helm.planner.domain.AgentWork.Blocked> = dev.helm.planner.domain.AgentWork.blockedTasks(tasks))

fun projectUiState(tasks: List<Task>, projects: List<Project>, projectId: String?, label: String?, today: String, timezone: String) =
    ProjectUiState(projects.firstOrNull { it.localId == projectId }, projectId, label,
        tasks.filter { if (label != null) label in it.labels else it.projectId == projectId }, today, timezone,
        dev.helm.planner.domain.AgentWork.blockedTasks(tasks))

class ProjectViewModel(private val repository: TaskRepository, settings: SettingsStore, private val projectId: String?, private val label: String?) : ViewModel() {
    val state = combine(repository.tasks, repository.projects, settings.settings, minuteTicks(System::currentTimeMillis)) { tasks, projects, s, now ->
        projectUiState(tasks, projects, projectId, label, HelmDates.localDate(now, s.timezone), s.timezone)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val todayActions = object : TodayActions {
        override fun complete(localId: String) = launchChange { repository.complete(localId) }
        override fun reopen(localId: String) = launchChange { repository.reopen(localId) }
        override fun moveTo(localId: String, date: String) = launchChange { repository.reschedule(localId, date) }
        override fun archive(localId: String) = launchChange { repository.archive(localId) }
        override fun setNow(localId: String) = launchChange { repository.setNow(localId) }
        override fun clearNow() = launchChange { repository.clearNow() }
        override fun saveResumeNote(localId: String, note: String) = launchChange { repository.setResumeNote(localId, note) }
        override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) =
            launchChange { repository.add(title, dueDate, dueTime, note, projectId) }
    }
    val boardActions = object : BoardActions {
        override fun move(localId: String, status: TaskStatus) = launchChange { repository.moveTo(localId, status) }
        override fun setNow(localId: String) = todayActions.setNow(localId)
        override fun clearNow() = todayActions.clearNow()
        override fun saveResumeNote(localId: String, note: String) = todayActions.saveResumeNote(localId, note)
        override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) =
            todayActions.add(title, dueDate, dueTime, note, projectId)
    }
    private fun launchChange(block: suspend () -> Unit) { viewModelScope.launch { block() } }
}
