package dev.helm.planner.ui.task

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import dev.helm.planner.ui.components.ActionChip
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
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
    const val REMINDERS = "detail-reminders"
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
@Composable
fun TaskDetailScreen(state: TaskDetailUiState, actions: TaskDetailActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().background(palette.background)) {
        ScreenHeader(stringResource(R.string.detail_title), onBack = actions::back)
        when (state) {
            is TaskDetailUiState.Missing -> Text(
                stringResource(R.string.detail_missing),
                style = helmType.body,
                color = palette.textMuted,
                modifier = Modifier
                    .padding(HelmDimens.screenMargin)
                    .testTag(TaskDetailTags.MISSING),
            )
            is TaskDetailUiState.Ready -> Column(
                verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap),
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                    .padding(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, bottom = 32.dp),
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
    AgentWorkSection(task, state.dependencies, System.currentTimeMillis(), state.timezone, editable, actions)
    CardSection(stringResource(R.string.detail_due)) {
        DueSection(task, today, editable, actions)
        RepeatSection(task, today, editable, actions)
        RemindersRow(task, state.defaultReminders, editable, actions)
    }
    ChecklistSection(task, editable, actions)
    LabelsSection(task, state.knownLabels, editable, actions)
    LinksSection(task, editable, actions)
    HelmCard { NoteSection(task, editable, actions) }
    HistorySection(state)
    if (editable) {
        SecondaryButton(
            stringResource(R.string.move_to_trash),
            onClick = { actions.moveToTrash(task.localId) },
            color = palette.danger,
            icon = Icons.Filled.Delete,
            modifier = Modifier
                .padding(top = 12.dp)
                .testTag(TaskDetailTags.TRASH),
        )
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
    HelmCard(color = palette.dangerSoft, modifier = Modifier.padding(top = 8.dp).testTag(TaskDetailTags.TRASH_BANNER)) {
        Text(text, style = helmType.body, color = palette.text)
        PrimaryButton(
            stringResource(R.string.restore),
            onClick = { actions.restore(task.localId) },
            fillWidth = false,
            modifier = Modifier.testTag(TaskDetailTags.RESTORE),
        )
    }
}

@Composable
private fun TitleSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    Text(
        task.title,
        style = helmType.screenTitle,
        color = palette.text,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.field)
            .clickable(enabled = editable, onClickLabel = stringResource(R.string.edit_title)) { editing = true }
            .padding(horizontal = 4.dp, vertical = 8.dp)
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
    CardSection(stringResource(R.string.detail_status)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TaskStatus.entries.forEach { status ->
                HelmChip(
                    statusLabel(status),
                    selected = task.status == status,
                    onClick = { actions.move(task.localId, status) },
                    enabled = editable,
                    modifier = Modifier.testTag(TaskDetailTags.status(status)),
                )
            }
        }
        if (task.status != TaskStatus.DONE) {
            SwitchRow(
                stringResource(R.string.set_now),
                checked = task.isNow,
                onChange = { on -> if (on) actions.setNow(task.localId) else actions.clearNow() },
                enabled = editable,
            )
        }
        if (task.isNow) ResumeRow(task, editable, actions)
    }
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
    Text(
        dueLabel(task, today) ?: stringResource(R.string.detail_no_due),
        style = helmType.bodyStrong,
        color = if (task.dueDate == null) palette.textMuted else palette.text,
        modifier = Modifier.testTag(TaskDetailTags.DUE),
    )
    if (editable) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionChip(stringResource(R.string.pick_day), onClick = { pickingDay = true })
            if (task.dueDate != null) {
                ActionChip(
                    stringResource(if (task.dueTime == null) R.string.add_time else R.string.change_time),
                    onClick = { pickingTime = true },
                )
                if (task.dueTime != null) {
                    ActionChip(stringResource(R.string.remove_time), onClick = { actions.setDue(task.localId, task.dueDate, null) })
                }
                ActionChip(stringResource(R.string.remove_due), onClick = { actions.setDue(task.localId, null, null) })
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
private fun RepeatSection(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
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
            due = task.dueDate?.let(LocalDate::parse) ?: today,
            today = today,
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
    CardSection(stringResource(R.string.detail_labels)) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.testTag(TaskDetailTags.LABELS),
        ) {
            task.labels.forEach { label ->
                val removeText = stringResource(R.string.remove_label, label)
                ActionChip(
                    label,
                    onClick = { actions.setLabels(task.localId, task.labels - label) },
                    enabled = editable,
                    trailingIcon = if (editable) Icons.Filled.Close else null,
                    modifier = Modifier.semantics { contentDescription = removeText },
                )
            }
            if (editable) {
                ActionChip(stringResource(R.string.add_label), onClick = { adding = true }, icon = Icons.Filled.Add)
            }
        }
        if (task.labels.isEmpty() && !editable) Placeholder(stringResource(R.string.no_labels))
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
    val p = palette
    CardSection(stringResource(R.string.detail_links)) {
        Column(Modifier.testTag(TaskDetailTags.LINKS)) {
            task.links.forEach { link ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(
                        Modifier
                            .weight(1f)
                            .heightIn(min = HelmDimens.touchTarget)
                            .clickable(onClickLabel = stringResource(R.string.open_link)) { uriHandler.openUri(link.url) }
                            .padding(vertical = 8.dp),
                    ) {
                        Text(link.title ?: link.url, style = helmType.bodyStrong, color = p.accent)
                        if (link.title != null) Text(link.url, style = helmType.small, color = p.textMuted)
                    }
                    if (editable) {
                        HeaderIconButton(
                            Icons.Filled.Close,
                            stringResource(R.string.remove_link, link.title ?: link.url),
                            onClick = { actions.setLinks(task.localId, task.links - link) },
                            tint = p.textMuted,
                        )
                    }
                }
            }
            if (task.links.isEmpty()) Placeholder(stringResource(R.string.no_links))
            if (editable && task.links.size < TaskRules.MAX_LINKS) {
                SecondaryButton(
                    stringResource(R.string.add_link),
                    onClick = { adding = true },
                    color = p.accent,
                    icon = Icons.Filled.Add,
                    modifier = Modifier.padding(top = 8.dp),
                )
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

/** A labelled value inside a card that opens its editor when tapped. */
@Composable
internal fun ValueRow(
    label: String,
    value: String,
    placeholder: Boolean,
    editLabel: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.field)
            .clickable(enabled = enabled, onClickLabel = editLabel, onClick = onClick)
            .padding(vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = helmType.smallStrong, color = p.textMuted, modifier = Modifier.semantics { heading() })
        Text(value, style = helmType.body, color = if (placeholder) p.textMuted else p.text)
    }
}

@Composable
internal fun Placeholder(text: String) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = Modifier.padding(vertical = 4.dp))
}
