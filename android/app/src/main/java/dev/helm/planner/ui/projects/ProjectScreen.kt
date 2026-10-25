package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.ExperimentalMaterial3Api
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
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.boardColumns
import dev.helm.planner.domain.projectCounts
import dev.helm.planner.domain.projectSections
import dev.helm.planner.ui.board.BoardActions
import dev.helm.planner.ui.board.BoardScreen
import dev.helm.planner.ui.board.BoardUiState
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmFab
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.DoneRow
import dev.helm.planner.ui.today.OverdueRow
import dev.helm.planner.ui.today.QuickAddSheet
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayRow
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(state: ProjectUiState, todayActions: TodayActions, boardActions: BoardActions, onBack: () -> Unit,
                  bottomBar: @Composable () -> Unit = {}) {
    var board by rememberSaveable { mutableStateOf(false) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf(false) }
    var managing by rememberSaveable { mutableStateOf(false) }
    val counts = projectCounts(state.tasks, state.today)
    val title = state.label?.let { "# $it" } ?: state.project?.let { listOfNotNull(it.icon, it.name).joinToString(" ") }
        ?: stringResource(R.string.project_no_project)
    val canAdd = state.label == null && (state.projectLocalId == null || state.project?.selectable == true)
    val header: @Composable () -> Unit = {
        Column {
            LargeHeader(title, subtitle = stringResource(R.string.project_counts, counts.open, counts.overdue), onBack = onBack) {
                if (state.project != null) {
                    HeaderIconButton(Icons.Filled.Edit, stringResource(R.string.project_edit), { editing = true })
                    HeaderIconButton(Icons.Filled.MoreVert, stringResource(R.string.more_actions, state.project.name), { managing = true })
                }
            }
            PrimaryTabRow(selectedTabIndex = if (board) 1 else 0, containerColor = palette.background, contentColor = palette.accent,
                divider = { HorizontalDivider(color = palette.border) }) {
                Tab(!board, { board = false }, text = { Text(stringResource(R.string.project_list), style = helmType.smallStrong) }, modifier = Modifier.testTag("project-list-tab"))
                Tab(board, { board = true }, text = { Text(stringResource(R.string.project_board), style = helmType.smallStrong) }, modifier = Modifier.testTag("project-board-tab"))
            }
        }
    }
    if (board) {
        val now = LocalDate.parse(state.today).atStartOfDay(dev.helm.planner.domain.HelmDates.zone(state.timezone)).toInstant().toEpochMilli()
        BoardScreen(BoardUiState(boardColumns(state.tasks, now, state.timezone), ConnectionStatus.LOCAL, 0, state.timezone,
            AgentWork.blockedTasks(state.tasks)), boardActions, bottomBar = bottomBar, header = header,
            defaultProjectId = state.projectLocalId, allowAdding = canAdd)
    } else Scaffold(containerColor = palette.background, topBar = header, bottomBar = bottomBar, floatingActionButton = {
        if (canAdd) HelmFab(Icons.Filled.Add, stringResource(R.string.add_task), { adding = true }, Modifier.testTag("project-add"))
    }) { padding -> ProjectTaskList(state, todayActions, Modifier.padding(padding)) }
    if (adding) QuickAddSheet(state.timezone, onDismiss = { adding = false }, defaultProjectId = state.projectLocalId,
        onSave = { taskTitle, day, time, note, project -> todayActions.add(taskTitle, day, time, note, project); adding = false })
    if (editing) state.project?.let { ProjectEditSheet(it, onDismiss = { editing = false }) }
    if (managing) state.project?.let { ProjectManagement(it, onDismiss = { managing = false }, onDeleted = onBack) }
}

@Composable
private fun ProjectTaskList(state: ProjectUiState, actions: TodayActions, modifier: Modifier) {
    val sections = projectSections(state.tasks, state.today)
    val today = LocalDate.parse(state.today)
    val blocked = AgentWork.blockedTasks(state.tasks)
    var done by rememberSaveable { mutableStateOf(false) }
    LazyColumn(modifier.fillMaxSize().testTag("project-task-list"), contentPadding = PaddingValues(bottom = 96.dp)) {
        if (sections.overdue.isNotEmpty()) {
            item { SectionLabel(stringResource(R.string.section_overdue, sections.overdue.size), Modifier.padding(20.dp), palette.danger) }
            items(sections.overdue, key = { it.localId }) { OverdueRow(it, today, actions, blocked[it.localId]) }
        }
        if (sections.today.isNotEmpty()) {
            item { SectionLabel(stringResource(R.string.section_today), Modifier.padding(20.dp)) }
            items(sections.today, key = { it.localId }) { TodayRow(it, today, actions, blocked[it.localId]) }
        }
        if (sections.later.isNotEmpty()) {
            item { SectionLabel(stringResource(R.string.project_later), Modifier.padding(20.dp)) }
            items(sections.later, key = { it.localId }) { task ->
                Column {
                    dueLabel(task, today)?.let { Text(it, style = helmType.small, color = palette.textMuted, modifier = Modifier.padding(horizontal = 20.dp)) }
                    TodayRow(task, today, actions, blocked[task.localId])
                }
            }
        }
        if (sections.undated.isNotEmpty()) {
            item { SectionLabel(stringResource(R.string.project_undated), Modifier.padding(20.dp)) }
            items(sections.undated, key = { it.localId }) { TodayRow(it, today, actions, blocked[it.localId]) }
        }
        if (sections.done.isNotEmpty()) {
            item { TextAction(stringResource(R.string.section_done, sections.done.size), { done = !done }, Modifier.padding(horizontal = 20.dp)) }
            if (done) items(sections.done, key = { it.localId }) { DoneRow(it, actions) }
        }
    }
}
