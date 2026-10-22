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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Overdue: done, to today, or (menu) another day and archive. */
@Composable
fun OverdueRow(task: Task, today: LocalDate, actions: TodayActions) {
    TaskLine(task, actions, subtitle = overdueLabel(task, today)) {
        val todayText = stringResource(R.string.move_to_today_described, task.title)
        TextButton(
            onClick = { actions.moveTo(task.localId, today.toString()) },
            modifier = Modifier
                .heightIn(min = 48.dp)
                .semantics { contentDescription = todayText },
        ) { Text(stringResource(R.string.move_to_today)) }
        TaskMenu(task, today, actions, offerNow = false)
    }
}

/** Today: done, or (menu) work on it now, another day, archive. */
@Composable
fun TodayRow(task: Task, today: LocalDate, actions: TodayActions) {
    TaskLine(task, actions, subtitle = null) { TaskMenu(task, today, actions, offerNow = true) }
}

@Composable
fun DoneRow(task: Task, actions: TodayActions) {
    val description = stringResource(R.string.reopen_task, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(horizontal = 4.dp),
    ) {
        TaskCheckbox(checked = true, description = description) { actions.reopen(task.localId) }
        Text(
            task.title,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textDecoration = TextDecoration.LineThrough,
            modifier = Modifier
                .weight(1f)
                .openTask(task, actions)
                .padding(end = 16.dp),
        )
    }
}

/** The single "now" task, with where the work stopped right under its title. */
@Composable
fun NowCard(task: Task, today: LocalDate, actions: TodayActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    val completeText = stringResource(R.string.complete_task, task.title)
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(TodayTags.NOW),
    ) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp)) {
            TaskCheckbox(checked = false, description = completeText) { actions.complete(task.localId) }
            Column(Modifier.weight(1f).padding(top = 4.dp)) {
                Text(
                    stringResource(R.string.section_now).uppercase(Locale.getDefault()),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                TaskTitle(
                    task,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    emphasized = true,
                    modifier = Modifier.openTask(task, actions),
                )
                val resume = task.resumeNote
                Text(
                    text = resume ?: stringResource(R.string.resume_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = if (resume == null) 0.7f else 1f),
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
private fun TaskLine(task: Task, actions: TodayActions, subtitle: String?, trailing: @Composable () -> Unit) {
    val completeText = stringResource(R.string.complete_task, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(start = 4.dp, end = 4.dp),
    ) {
        TaskCheckbox(checked = false, description = completeText) { actions.complete(task.localId) }
        Column(
            Modifier
                .weight(1f)
                .openTask(task, actions)
                .padding(vertical = 8.dp),
        ) {
            TaskTitle(task)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
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
        Checkbox(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun TaskTitle(
    task: Task,
    color: Color = MaterialTheme.colorScheme.onSurface,
    emphasized: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val time = task.dueTime
    Text(
        text = if (time != null) "$time  ${task.title}" else task.title,
        style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
        color = color,
        modifier = modifier,
    )
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
    var open by remember { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.more_actions, task.title))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (offerNow) MenuItem(R.string.set_now) { open = false; actions.setNow(task.localId) }
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
    var open by remember { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.more_actions, task.title))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            MenuItem(R.string.resume_edit) { open = false; onEditNote() }
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
    DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = onClick, modifier = Modifier.heightIn(min = 48.dp))
}

@Composable
fun ResumeNoteDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.resume_label)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= TaskRepository.MAX_RESUME_NOTE) text = it },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { TextButton(onClick = { onSave(text) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** "yesterday" or a short date such as "Mon, 19 Oct" in the app's language. */
@Composable
private fun overdueLabel(task: Task, today: LocalDate): String? {
    val due = task.dueDate?.let(LocalDate::parse) ?: return null
    if (due == today.minusDays(1)) return stringResource(R.string.yesterday)
    return due.format(DateTimeFormatter.ofPattern("EEE, d MMM", Locale.getDefault()))
}
