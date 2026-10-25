package dev.helm.planner.ui.today

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.ui.common.BlockedMark
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmMenu
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.helmCheckboxColors
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectBadge
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate

/** Overdue: done, to today, or (menu) another day and archive. [blocked] marks a task that cannot go on. */
@Composable
fun OverdueRow(task: Task, today: LocalDate, actions: TodayActions, blocked: AgentWork.Blocked? = null) {
    TaskLine(task, actions, subtitle = overdueLabel(task, today), blocked = blocked) {
        val todayText = stringResource(R.string.move_to_today_described, task.title)
        SecondaryButton(
            stringResource(R.string.move_to_today),
            onClick = { actions.moveTo(task.localId, today.toString()) },
            color = palette.accent,
            modifier = Modifier.semantics { contentDescription = todayText },
        )
        TaskMenu(task, today, actions, offerNow = false)
    }
}

/** Today: done, or (menu) work on it now, another day, archive. */
@Composable
fun TodayRow(task: Task, today: LocalDate, actions: TodayActions, blocked: AgentWork.Blocked? = null) {
    TaskLine(task, actions, subtitle = null, blocked = blocked) { TaskMenu(task, today, actions, offerNow = true) }
}

@Composable
fun DoneRow(task: Task, actions: TodayActions) {
    val description = stringResource(R.string.reopen_task, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(horizontal = 8.dp),
    ) {
        TaskCheckbox(checked = true, description = description) { actions.reopen(task.localId) }
        Column(Modifier.weight(1f).openTask(task, actions).padding(end = 16.dp)) {
            Text(task.title, style = helmType.body, color = palette.textMuted, textDecoration = TextDecoration.LineThrough)
            ProjectBadge(task)
        }
    }
}

/** The single "now" task, with where the work stopped right under its title. */
@Composable
fun NowCard(task: Task, today: LocalDate, actions: TodayActions, blocked: AgentWork.Blocked? = null) {
    var editing by rememberSaveable { mutableStateOf(false) }
    val completeText = stringResource(R.string.complete_task, task.title)
    val p = palette
    HelmCard(
        color = p.accentSoft,
        contentPadding = 6.dp,
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(TodayTags.NOW),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            TaskCheckbox(checked = false, description = completeText) { actions.complete(task.localId) }
            Column(Modifier.weight(1f).padding(top = 10.dp)) {
                SectionLabel(stringResource(R.string.section_now))
                TaskTitle(task, blocked, emphasized = true, modifier = Modifier.openTask(task, actions))
                ProjectBadge(task)
                val resume = task.resumeNote
                Text(
                    text = resume ?: stringResource(R.string.resume_empty),
                    style = helmType.small,
                    color = if (resume == null) p.textMuted else p.text,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable(onClickLabel = stringResource(R.string.resume_edit)) { editing = true }
                        .padding(vertical = 12.dp),
                )
            }
            NowMenu(task, today, actions, onEditNote = { editing = true })
        }
    }
    if (editing) {
        ResumeNoteDialog(
            initial = task.resumeNote.orEmpty(),
            onDismiss = { editing = false },
            onSave = {
                actions.saveResumeNote(task.localId, it)
                editing = false
            },
        )
    }
}

@Composable
private fun TaskLine(task: Task, actions: TodayActions, subtitle: String?, blocked: AgentWork.Blocked?, trailing: @Composable () -> Unit) {
    val completeText = stringResource(R.string.complete_task, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(start = 8.dp, end = 8.dp),
    ) {
        TaskCheckbox(checked = false, description = completeText) { actions.complete(task.localId) }
        Column(
            Modifier
                .weight(1f)
                .openTask(task, actions)
                .padding(vertical = 8.dp),
        ) {
            TaskTitle(task, blocked)
            ProjectBadge(task)
            if (subtitle != null) {
                Text(subtitle, style = helmType.small, color = palette.danger)
            }
        }
        trailing()
    }
}

/** A checkbox whose whole 48 dp square is the touch target, announced with the task's title. */
@Composable
private fun TaskCheckbox(checked: Boolean, description: String, onToggle: () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(48.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle() })
            .semantics { contentDescription = description },
    ) {
        Checkbox(checked = checked, onCheckedChange = null, colors = helmCheckboxColors())
    }
}

@Composable
private fun TaskTitle(
    task: Task,
    blocked: AgentWork.Blocked?,
    modifier: Modifier = Modifier,
    color: Color = palette.text,
    emphasized: Boolean = false,
) {
    val time = task.dueTime
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        blocked?.let { BlockedMark(it, task.localId, Modifier.padding(end = 6.dp)) }
        Text(
            text = if (time != null) "$time  ${task.title}" else task.title,
            style = if (emphasized) helmType.title else helmType.body,
            color = color,
        )
    }
}

/** Tapping a task's text opens its details; at least 48 dp tall, announced as "open details". */
@Composable
private fun Modifier.openTask(task: Task, actions: TodayActions): Modifier {
    val label = stringResource(R.string.open_details)
    return heightIn(min = 48.dp)
        .clickable(onClickLabel = label) { actions.openTask(task.localId) }
        .wrapContentHeight(Alignment.CenterVertically)
}

@Composable
private fun TaskMenu(task: Task, today: LocalDate, actions: TodayActions, offerNow: Boolean) {
    val projects = LocalProjects.current
    var open by remember { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf(false) }
    Box {
        HeaderIconButton(Icons.Filled.MoreVert, stringResource(R.string.more_actions, task.title), { open = true }, tint = palette.textMuted)
        HelmMenu(expanded = open, onDismiss = { open = false }) {
            if (offerNow) MenuItem(R.string.set_now) { open = false; actions.setNow(task.localId) }
            MenuItem(R.string.project_move) { open = false; projects.pickTask(task) }
            MenuItem(R.string.move_to_day) { open = false; picking = true }
            MenuItem(R.string.archive) { open = false; actions.archive(task.localId) }
        }
    }
    if (picking) {
        DayPickerDialog(
            initial = task.dueDate?.let(LocalDate::parse) ?: today,
            onDismiss = { picking = false },
            onPick = { picking = false; actions.moveTo(task.localId, it.toString()) },
        )
    }
}

@Composable
private fun NowMenu(task: Task, today: LocalDate, actions: TodayActions, onEditNote: () -> Unit) {
    val projects = LocalProjects.current
    var open by remember { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf(false) }
    Box {
        HeaderIconButton(Icons.Filled.MoreVert, stringResource(R.string.more_actions, task.title), { open = true }, tint = palette.textMuted)
        HelmMenu(expanded = open, onDismiss = { open = false }) {
            MenuItem(R.string.resume_edit) { open = false; onEditNote() }
            MenuItem(R.string.project_move) { open = false; projects.pickTask(task) }
            MenuItem(R.string.stop_now) { open = false; actions.clearNow() }
            MenuItem(R.string.move_to_day) { open = false; picking = true }
            MenuItem(R.string.archive) { open = false; actions.archive(task.localId) }
        }
    }
    if (picking) {
        DayPickerDialog(
            initial = task.dueDate?.let(LocalDate::parse) ?: today,
            onDismiss = { picking = false },
            onPick = { picking = false; actions.moveTo(task.localId, it.toString()) },
        )
    }
}

@Composable
private fun MenuItem(@StringRes label: Int, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(stringResource(label), style = helmType.body, color = palette.text) },
        onClick = onClick,
        modifier = Modifier.heightIn(min = 48.dp),
    )
}

@Composable
fun ResumeNoteDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    HelmDialog(
        title = stringResource(R.string.resume_label),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.save),
        onConfirm = { onSave(text) },
        dismiss = stringResource(R.string.cancel),
    ) {
        HelmTextField(
            value = text,
            onValueChange = { if (it.length <= TaskRepository.MAX_RESUME_NOTE) text = it },
            minLines = 3,
        )
    }
}

/** "yesterday" or a short date such as "Mon, 19 Oct" in the app's language. */
@Composable
private fun overdueLabel(task: Task, today: LocalDate): String? {
    val due = task.dueDate?.let(LocalDate::parse) ?: return null
    if (due == today.minusDays(1)) return stringResource(R.string.yesterday)
    return due.format(dateFormat("EEEdMMM", appLocale()))
}
