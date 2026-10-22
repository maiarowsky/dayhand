package dev.helm.planner.ui.task

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.common.repeatLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.today.DayPickerDialog
import dev.helm.planner.ui.today.ResumeNoteDialog
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

object TaskDetailTags {
    const val TITLE = "detail-title"
    const val NOTE = "detail-note"
    const val DUE = "detail-due"
    const val REPEAT = "detail-repeat"
    const val LABELS = "detail-labels"
    const val LINKS = "detail-links"
    const val TRASH = "detail-trash"
    const val TRASH_BANNER = "detail-trash-banner"
    const val RESTORE = "detail-restore"
    const val HISTORY = "detail-history"
    const val MISSING = "detail-missing"
    fun status(status: TaskStatus) = "detail-status-${status.wire}"
}

/** How long the server keeps a task in the trash (`TRASH_RETENTION_MS` in the backend). */
const val TRASH_DAYS = 30L

/** Everything about one task: edit any field, move it on the board, trash or restore it, and see who changed what. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskDetailScreen(state: TaskDetailUiState, actions: TaskDetailActions, modifier: Modifier = Modifier) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.detail_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = actions::back, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        when (state) {
            is TaskDetailUiState.Missing -> Text(
                stringResource(R.string.detail_missing),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier
                    .padding(padding)
                    .padding(24.dp)
                    .testTag(TaskDetailTags.MISSING),
            )
            is TaskDetailUiState.Ready -> Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 32.dp),
            ) {
                DetailBody(state, actions)
            }
        }
    }
}

@Composable
private fun DetailBody(state: TaskDetailUiState.Ready, actions: TaskDetailActions) {
    val task = state.task
    val today = LocalDate.parse(state.today)
    val editable = !task.inTrash
    if (task.inTrash || task.archivedAt != null) RestoreBanner(task, today, state.timezone, actions)
    TitleSection(task, editable, actions)
    StatusSection(task, editable, actions)
    Divider()
    DueSection(task, today, editable, actions)
    RepeatSection(task, editable, actions)
    Divider()
    LabelsSection(task, state.knownLabels, editable, actions)
    LinksSection(task, editable, actions)
    Divider()
    NoteSection(task, editable, actions)
    Divider()
    HistorySection(state)
    if (editable) {
        OutlinedButton(
            onClick = { actions.moveToTrash(task.localId) },
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 24.dp)
                .heightIn(min = 48.dp)
                .testTag(TaskDetailTags.TRASH),
        ) {
            Icon(Icons.Filled.Delete, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.move_to_trash))
        }
    }
}

@Composable
private fun RestoreBanner(task: Task, today: LocalDate, timezone: String, actions: TaskDetailActions) {
    val text = task.deletedAt?.let { deleted ->
        // The same day the Trash screen shows: 30 days after the day it was deleted, in the user's zone.
        val purge = Instant.ofEpochMilli(deleted).atZone(HelmDates.zone(timezone)).toLocalDate().plusDays(TRASH_DAYS)
        val days = ChronoUnit.DAYS.between(today, purge).coerceAtLeast(0)
        pluralStringResource(R.plurals.detail_in_trash, days.toInt(), days, dayLabel(purge, today))
    } ?: stringResource(R.string.detail_archived)
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .testTag(TaskDetailTags.TRASH_BANNER),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            Button(
                onClick = { actions.restore(task.localId) },
                modifier = Modifier
                    .padding(top = 8.dp)
                    .heightIn(min = 48.dp)
                    .testTag(TaskDetailTags.RESTORE),
            ) { Text(stringResource(R.string.restore)) }
        }
    }
}

@Composable
private fun TitleSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    Text(
        task.title,
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(enabled = editable, onClickLabel = stringResource(R.string.edit_title)) { editing = true }
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(TaskDetailTags.TITLE),
    )
    if (editing) {
        TextEditDialog(
            title = stringResource(R.string.edit_title),
            initial = task.title,
            maxLength = TaskRules.MAX_TITLE,
            singleLine = true,
            allowEmpty = false,
            onDismiss = { editing = false },
            onSave = {
                actions.rename(task.localId, it)
                editing = false
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    SectionLabel(stringResource(R.string.detail_status))
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(horizontal = 16.dp),
    ) {
        TaskStatus.entries.forEach { status ->
            FilterChip(
                selected = task.status == status,
                onClick = { actions.move(task.localId, status) },
                enabled = editable,
                label = { Text(statusLabel(status)) },
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .testTag(TaskDetailTags.status(status)),
            )
        }
    }
    if (task.status != TaskStatus.DONE) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .toggleable(
                    value = task.isNow,
                    enabled = editable,
                    role = Role.Switch,
                    onValueChange = { on -> if (on) actions.setNow(task.localId) else actions.clearNow() },
                )
                .padding(horizontal = 16.dp),
        ) {
            Text(stringResource(R.string.set_now), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = task.isNow, onCheckedChange = null, enabled = editable)
        }
    }
    if (task.isNow) ResumeRow(task, editable, actions)
}

@Composable
private fun ResumeRow(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    ValueRow(
        label = stringResource(R.string.resume_label),
        value = task.resumeNote ?: stringResource(R.string.resume_empty),
        placeholder = task.resumeNote == null,
        editLabel = stringResource(R.string.resume_edit),
        enabled = editable,
        onClick = { editing = true },
    )
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DueSection(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    SectionLabel(stringResource(R.string.detail_due))
    Text(
        dueLabel(task, today) ?: stringResource(R.string.detail_no_due),
        style = MaterialTheme.typography.bodyLarge,
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .testTag(TaskDetailTags.DUE),
    )
    if (editable) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 16.dp)) {
            AssistChip(onClick = { pickingDay = true }, label = { Text(stringResource(R.string.pick_day)) }, modifier = ChipHeight)
            if (task.dueDate != null) {
                AssistChip(
                    onClick = { pickingTime = true },
                    label = { Text(stringResource(if (task.dueTime == null) R.string.add_time else R.string.change_time)) },
                    modifier = ChipHeight,
                )
                if (task.dueTime != null) {
                    AssistChip(
                        onClick = { actions.setDue(task.localId, task.dueDate, null) },
                        label = { Text(stringResource(R.string.remove_time)) },
                        modifier = ChipHeight,
                    )
                }
                AssistChip(
                    onClick = { actions.setDue(task.localId, null, null) },
                    label = { Text(stringResource(R.string.remove_due)) },
                    modifier = ChipHeight,
                )
            }
        }
    }
    if (pickingDay) {
        DayPickerDialog(
            initial = task.dueDate?.let(LocalDate::parse) ?: today,
            onDismiss = { pickingDay = false },
            onPick = {
                pickingDay = false
                actions.setDue(task.localId, it.toString(), task.dueTime)
            },
        )
    }
    if (pickingTime) {
        TimePickerDialog(
            initial = task.dueTime?.let(LocalTime::parse) ?: LocalTime.of(9, 0),
            onDismiss = { pickingTime = false },
            onPick = {
                pickingTime = false
                actions.setDue(task.localId, task.dueDate, it)
            },
        )
    }
}

@Composable
private fun RepeatSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    ValueRow(
        label = stringResource(R.string.detail_repeat),
        value = task.repeat?.let { repeatLabel(it) } ?: stringResource(R.string.repeat_none),
        placeholder = task.repeat == null,
        editLabel = stringResource(R.string.edit_repeat),
        enabled = editable,
        onClick = { editing = true },
        modifier = Modifier.testTag(TaskDetailTags.REPEAT),
    )
    if (editing) {
        RepeatDialog(
            initial = task.repeat,
            onDismiss = { editing = false },
            onSave = {
                actions.setRepeat(task.localId, it)
                editing = false
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LabelsSection(task: Task, known: List<String>, editable: Boolean, actions: TaskDetailActions) {
    var adding by rememberSaveable { mutableStateOf(false) }
    SectionLabel(stringResource(R.string.detail_labels))
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .testTag(TaskDetailTags.LABELS),
    ) {
        task.labels.forEach { label ->
            val removeText = stringResource(R.string.remove_label, label)
            InputChip(
                selected = false,
                enabled = editable,
                onClick = { actions.setLabels(task.localId, task.labels - label) },
                label = { Text(label) },
                trailingIcon = if (editable) {
                    { Icon(Icons.Filled.Close, contentDescription = null, Modifier.size(InputChipDefaults.IconSize)) }
                } else {
                    null
                },
                modifier = ChipHeight.semantics { contentDescription = removeText },
            )
        }
        if (editable) {
            AssistChip(
                onClick = { adding = true },
                label = { Text(stringResource(R.string.add_label)) },
                leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
                modifier = ChipHeight,
            )
        }
    }
    if (adding) {
        LabelDialog(
            current = task.labels,
            suggestions = known - task.labels.toSet(),
            onDismiss = { adding = false },
            onAdd = {
                actions.setLabels(task.localId, task.labels + it)
                adding = false
            },
        )
    }
}

@Composable
private fun LinksSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var adding by rememberSaveable { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    SectionLabel(stringResource(R.string.detail_links))
    Column(Modifier.testTag(TaskDetailTags.LINKS)) {
        task.links.forEach { link ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, end = 4.dp)) {
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .clickable(onClickLabel = stringResource(R.string.open_link)) { uriHandler.openUri(link.url) }
                        .padding(vertical = 8.dp),
                ) {
                    Text(link.title ?: link.url, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
                    if (link.title != null) {
                        Text(link.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (editable) {
                    IconButton(onClick = { actions.setLinks(task.localId, task.links - link) }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.remove_link, link.title ?: link.url))
                    }
                }
            }
        }
        if (task.links.isEmpty()) Placeholder(stringResource(R.string.no_links))
        if (editable && task.links.size < TaskRules.MAX_LINKS) {
            TextButton(onClick = { adding = true }, modifier = Modifier.padding(horizontal = 8.dp).heightIn(min = 48.dp)) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.add_link))
            }
        }
    }
    if (adding) {
        LinkDialog(
            onDismiss = { adding = false },
            onAdd = {
                actions.setLinks(task.localId, task.links + it)
                adding = false
            },
        )
    }
}

@Composable
private fun NoteSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    ValueRow(
        label = stringResource(R.string.quick_add_note),
        value = task.note ?: stringResource(R.string.note_empty),
        placeholder = task.note == null,
        editLabel = stringResource(R.string.edit_note),
        enabled = editable,
        onClick = { editing = true },
        modifier = Modifier.testTag(TaskDetailTags.NOTE),
    )
    if (editing) {
        TextEditDialog(
            title = stringResource(R.string.edit_note),
            initial = task.note.orEmpty(),
            maxLength = TaskRules.MAX_NOTE,
            singleLine = false,
            allowEmpty = true,
            onDismiss = { editing = false },
            onSave = {
                actions.setNote(task.localId, it)
                editing = false
            },
        )
    }
}

/** A labelled value that opens its editor when tapped. */
@Composable
private fun ValueRow(
    label: String,
    value: String,
    placeholder: Boolean,
    editLabel: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(enabled = enabled, onClickLabel = editLabel, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.semantics { heading() })
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = if (placeholder) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
internal fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp)
            .semantics { heading() },
    )
}

@Composable
internal fun Placeholder(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
    )
}

@Composable
private fun Divider() = HorizontalDivider(Modifier.padding(top = 16.dp))

/** Chips draw 32 dp tall; their whole row is kept at the 48 dp touch target. */
internal val ChipHeight = Modifier.heightIn(min = 48.dp)
