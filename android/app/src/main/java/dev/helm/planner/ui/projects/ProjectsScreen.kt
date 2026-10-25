package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.domain.projectCounts
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmMenu
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

@Composable
fun ProjectsScreen(state: ProjectsUiState, onProject: (String?) -> Unit, onLabel: (String) -> Unit,
                   onTrash: () -> Unit, onSettings: () -> Unit, bottomBar: @Composable () -> Unit = {}) {
    val context = LocalProjects.current
    var adding by rememberSaveable { mutableStateOf(false) }
    var menu by rememberSaveable { mutableStateOf(false) }
    var ordering by rememberSaveable { mutableStateOf(false) }
    var archived by rememberSaveable { mutableStateOf(false) }
    var managingId by rememberSaveable { mutableStateOf<String?>(null) }
    var fromLabel by rememberSaveable { mutableStateOf<String?>(null) }
    val active = state.projects.filter { it.selectable }
    val archive = state.projects.filter { it.archived }
    val labels = state.tasks.filter { it.isActive }.flatMap { it.labels }.distinct().sorted()
    Scaffold(containerColor = palette.background, bottomBar = bottomBar, topBar = {
        LargeHeader(stringResource(R.string.projects_title)) {
            HeaderIconButton(Icons.Filled.Add, stringResource(R.string.project_new), { adding = true }, Modifier.testTag("projects-new"))
            Box {
                HeaderIconButton(Icons.Filled.MoreVert, stringResource(R.string.project_reorder), { menu = true })
                HelmMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.project_reorder), style = helmType.body, color = palette.text) },
                        onClick = { menu = false; ordering = !ordering })
                }
            }
            HeaderIconButton(Icons.Filled.Settings, stringResource(R.string.open_settings), onSettings)
        }
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp).testTag("projects-list"),
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap)) {
            if (context.failed) ListNote(stringResource(R.string.project_failed))
            if (ordering) TextAction(stringResource(R.string.project_reorder_done), { ordering = false })
            ListGroup(null, active.map { project -> @Composable {
                val counts = projectCounts(state.tasks.filter { it.projectLocalId == project.localId }, state.today)
                ListRow(project.name, "project-row-${project.localId}", value = counts.open.toString(),
                    note = stringResource(R.string.project_counts, counts.open, counts.overdue),
                    leadingContent = { ProjectMark(project) }, valueColor = if (counts.overdue > 0) palette.danger else palette.textMuted,
                    onClick = { onProject(project.localId) }, onLongClick = { managingId = project.localId },
                    longClickLabel = stringResource(R.string.project_edit),
                    trailing = if (ordering) { { ProjectReorder(project, context.actions) } } else null)
            } } + listOf<@Composable () -> Unit>({
                val counts = projectCounts(state.tasks.filter { it.projectLocalId == null }, state.today)
                ListRow(stringResource(R.string.project_no_project), "project-row-none", value = counts.open.toString(),
                    leadingContent = { ProjectMark(null) }, valueColor = if (counts.overdue > 0) palette.danger else palette.textMuted,
                    note = stringResource(R.string.project_counts, counts.open, counts.overdue), onClick = { onProject(null) })
            }))
            if (labels.isNotEmpty()) ListGroup(stringResource(R.string.detail_labels), labels.map { label -> @Composable {
                ListRow("# $label", "project-label-$label", value = projectCounts(state.tasks.filter { label in it.labels }, state.today).open.toString(),
                    onClick = { onLabel(label) }, onLongClick = { fromLabel = label }, longClickLabel = stringResource(R.string.project_from_label))
            } })
            ListGroup(null, listOf({
                ListRow(stringResource(R.string.project_archived, archive.size), "projects-archive", icon = LineIcon.Folder, onClick = { archived = !archived })
            }, {
                ListRow(stringResource(R.string.trash_title), "projects-trash", icon = LineIcon.List, onClick = onTrash)
            }))
            if (archived && archive.isNotEmpty()) ListGroup(stringResource(R.string.project_archived, archive.size), archive.map { project -> @Composable {
                ListRow(project.name, "project-archived-${project.localId}", leadingContent = { ProjectMark(project) },
                    onClick = { onProject(project.localId) }, onLongClick = { managingId = project.localId },
                    trailing = { TextAction(stringResource(R.string.restore), { context.actions.archive(project, false) }) })
            } })
        }
    }
    if (adding) ProjectEditSheet(onDismiss = { adding = false })
    state.projects.firstOrNull { it.localId == managingId }?.let { ProjectManagement(it, onDismiss = { managingId = null }) }
    fromLabel?.let { ProjectEditSheet(fromLabel = it, onDismiss = { fromLabel = null }) }
}
