package dev.helm.planner.ui.projects

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.ui.common.minuteTicks
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** All eight languages share these data, not server-supplied error messages. */
data class ProjectDraft(val name: String, val color: String? = null, val icon: String? = null, val note: String? = null)

interface ProjectActions {
    fun create(draft: ProjectDraft, onCreated: (Project) -> Unit) {}
    fun edit(project: Project, draft: ProjectDraft, onSaved: () -> Unit) {}
    fun archive(project: Project, archived: Boolean, archiveTasks: Boolean = false) {}
    fun delete(project: Project, target: String?, onDeleted: () -> Unit) {}
    fun move(project: Project, by: Int) {}
    fun assign(taskId: String, projectId: String?) {}
    fun clearError() {}
}

data class ProjectUiContext(val projects: List<Project> = emptyList(), val actions: ProjectActions = object : ProjectActions {},
                            val failed: Boolean = false, val pickTask: (Task) -> Unit = {}, val connectionRequired: Boolean = false)
val LocalProjects = staticCompositionLocalOf { ProjectUiContext() }

data class ProjectsUiState(val projects: List<Project>, val tasks: List<Task>, val today: String, val timezone: String, val pending: Int)

class ProjectsViewModel(private val repository: TaskRepository, settings: SettingsStore) : ViewModel(), ProjectActions {
    val failed = MutableStateFlow(false)
    val connectionRequired = MutableStateFlow(false)
    val state = combine(repository.projects, repository.tasks, settings.settings, minuteTicks(System::currentTimeMillis), repository.pendingChanges) { projects, tasks, s, now, pending ->
        ProjectsUiState(projects, tasks, HelmDates.localDate(now, s.timezone), s.timezone, pending)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    override fun create(draft: ProjectDraft, onCreated: (Project) -> Unit) = run {
        onCreated(repository.projectStore.add(draft.name, draft.color, draft.icon, draft.note))
    }
    override fun edit(project: Project, draft: ProjectDraft, onSaved: () -> Unit) = run {
        repository.projectStore.update(project.localId, draft.name, draft.color, draft.icon, draft.note)
        onSaved()
    }
    override fun archive(project: Project, archived: Boolean, archiveTasks: Boolean) = run { repository.projectStore.archive(project.localId, archived, archiveTasks) }
    override fun delete(project: Project, target: String?, onDeleted: () -> Unit) = run {
        repository.projectStore.delete(project.localId, target)
        onDeleted()
    }
    override fun move(project: Project, by: Int) = run { repository.projectStore.move(project.localId, by) }
    override fun assign(taskId: String, projectId: String?) = run { repository.setProject(taskId, projectId) }
    override fun clearError() { failed.value = false; connectionRequired.value = false }

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            clearError()
            try { block() } catch (e: CancellationException) { throw e }
            catch (_: dev.helm.planner.data.ProjectConnectionRequired) { connectionRequired.value = true; failed.value = true }
            catch (_: Exception) { failed.value = true }
        }
    }
}

/** Shared picker/marker data at the app boundary; previews and tests can supply their own typed context. */
@Composable
fun ProjectHost(repository: TaskRepository, settings: SettingsStore, content: @Composable () -> Unit) {
    val model = viewModel(key = "project-actions") { ProjectsViewModel(repository, settings) }
    val state by model.state.collectAsStateWithLifecycle()
    val failed by model.failed.collectAsStateWithLifecycle()
    val connectionRequired by model.connectionRequired.collectAsStateWithLifecycle()
    var assigning by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf<String?>(null) }
    CompositionLocalProvider(LocalProjects provides ProjectUiContext(state?.projects.orEmpty(), model, failed, { assigning = it.localId }, connectionRequired)) {
        content()
        state?.tasks?.firstOrNull { it.localId == assigning }?.let { task ->
            ProjectPickerSheet(task.projectId, onDismiss = { assigning = null }, onPick = { model.assign(task.localId, it) })
        }
        if (failed) dev.helm.planner.ui.components.HelmDialog(
            title = androidx.compose.ui.res.stringResource(dev.helm.planner.R.string.project_label), onDismiss = model::clearError,
            confirm = androidx.compose.ui.res.stringResource(dev.helm.planner.R.string.ok), onConfirm = model::clearError,
        ) { androidx.compose.material3.Text(androidx.compose.ui.res.stringResource(if (connectionRequired) dev.helm.planner.R.string.project_connection_required else dev.helm.planner.R.string.project_failed)) }
    }
}
