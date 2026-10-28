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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.ParagraphStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.common.repeatLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectMark
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
    const val TITLE_MORE = "detail-title-more"
    const val SUMMARY = "detail-summary"
    const val SCHEDULE = "detail-schedule"
    const val LINKS_SECTION = "detail-links-section"
    const val LABELS_SECTION = "detail-labels-section"
    const val NOTE = "detail-note"
    const val NOTE_MORE = "detail-note-more"
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
                verticalArrangement = Arrangement.spacedBy(DETAIL_GAP),
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

/**
 * Top to bottom: the title (two lines, unfolded on request), one card with what is read most (status, the proof it
 * was done with, due day with its actions in one row, project in one row, and labels when the task has any), the note
 * (folded after about eight lines), an agent's work, then folding sections for repeat and reminders, the checklist,
 * labels when there are none, links and history.
 */
@Composable
private fun DetailBody(state: TaskDetailUiState.Ready, actions: TaskDetailActions) {
    val task = state.task
    val today = LocalDate.parse(state.today)
    val editable = !task.inTrash
    if (task.inTrash || task.archivedAt != null) RestoreBanner(task, today, state.timezone, actions)
    TitleSection(task, editable, actions)
    HelmCard(Modifier.testTag(TaskDetailTags.SUMMARY), contentPadding = CARD_PADDING) {
        StatusField(task, editable, actions)
        task.proof?.let { ProofLine(it) }
        DueField(task, today, editable, actions)
        ProjectField(task, editable)
        if (task.labels.isNotEmpty()) {
            FieldLabel(stringResource(R.string.detail_labels))
            LabelsField(task, state.knownLabels, editable, actions)
        }
    }
    HelmCard(contentPadding = CARD_PADDING - NOTE_INSET) { NoteSection(task, editable, actions) }
    AgentWorkSection(task, state.dependencies, System.currentTimeMillis(), state.timezone, editable, actions)
    FoldingSection(
        stringResource(R.string.detail_repeat_reminders),
        tag = TaskDetailTags.SCHEDULE,
        initiallyExpanded = false,
        summary = listOf(
            task.repeat?.let { repeatLabel(it) } ?: stringResource(R.string.repeat_none),
            remindersSummary(task.reminders, state.defaultReminders),
        ).joinToString(" · "),
    ) {
        RepeatSection(task, today, editable, actions)
        FieldDivider()
        RemindersRow(task, state.defaultReminders, editable, actions)
    }
    ChecklistSection(task, editable, actions)
    if (task.labels.isEmpty()) {
        FoldingSection(
            stringResource(R.string.detail_labels),
            tag = TaskDetailTags.LABELS_SECTION,
            initiallyExpanded = false,
            summary = stringResource(R.string.no_labels),
        ) {
            LabelsField(task, state.knownLabels, editable, actions)
        }
    }
    LinksSection(task, editable, actions)
    HistorySection(state)
    if (editable) {
        DetailAction(
            stringResource(R.string.move_to_trash),
            { actions.moveToTrash(task.localId) },
            Icons.Filled.Delete,
            Modifier
                .padding(top = 12.dp)
                .testTag(TaskDetailTags.TRASH),
            danger = true,
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

/** The task's title in at most two lines; longer ones end in "…" with a button to show it whole. Tap it to rename. */
@Composable
private fun TitleSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var whole by rememberSaveable(task.title) { mutableStateOf(false) }
    var cut by remember(task.title) { mutableStateOf(false) }
    Column {
        Text(
            task.title,
            style = helmType.title.copy(fontSize = 20.sp, lineHeight = 26.sp),
            color = palette.text,
            maxLines = if (whole) Int.MAX_VALUE else TITLE_LINES,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { if (!whole) cut = it.hasVisualOverflow },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = HelmDimens.touchTarget)
                .clip(HelmShapes.field)
                .clickable(enabled = editable, onClickLabel = stringResource(R.string.edit_title)) { editing = true }
                .padding(horizontal = 4.dp, vertical = 8.dp)
                .semantics { heading() }
                .testTag(TaskDetailTags.TITLE),
        )
        if (cut || whole) {
            TextAction(
                stringResource(if (whole) R.string.title_show_less else R.string.title_show_all),
                { whole = !whole },
                modifier = Modifier.testTag(TaskDetailTags.TITLE_MORE),
            )
        }
    }
    if (editing) {
        TextEditDialog(
            title = stringResource(R.string.edit_title),
            initial = task.title,
            maxLength = TaskRules.MAX_TITLE,
            onDismiss = { editing = false },
            onSave = {
                actions.rename(task.localId, it)
                editing = false
            },
        )
    }
}

@Composable
private fun StatusField(task: Task, editable: Boolean, actions: TaskDetailActions) {
    SegmentedChoice(
        TaskStatus.entries,
        task.status,
        name = stringResource(R.string.detail_status),
        label = { statusLabel(it) },
        tag = TaskDetailTags::status,
        enabled = editable,
        onSelect = { actions.move(task.localId, it) },
    )
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

/**
 * The due day and its changes in one row that wraps only when it does not fit: the day (red when it has passed) opens
 * the day picker, then add, change or remove the time, and a cross for no due day. Without a due day, one button
 * picks it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DueField(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val p = palette
    val overdue = HelmDates.isOverdue(task, today.toString())
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val due = dueLabel(task, today)
        if (due == null) {
            if (editable) {
                DetailAction(stringResource(R.string.pick_day), { pickingDay = true }, Icons.Filled.DateRange, Modifier.testTag(TaskDetailTags.DUE))
            } else {
                ValueChip(stringResource(R.string.detail_no_due), stringResource(R.string.detail_due), Icons.Filled.DateRange, p.textMuted,
                    modifier = Modifier.testTag(TaskDetailTags.DUE))
            }
        } else {
            ValueChip(
                due,
                stringResource(R.string.detail_due),
                Icons.Filled.DateRange,
                if (overdue) p.danger else p.text,
                background = if (overdue) p.dangerSoft else p.surfaceRaised,
                onClickLabel = stringResource(R.string.pick_day),
                onClick = if (editable) ({ pickingDay = true }) else null,
                modifier = Modifier.testTag(TaskDetailTags.DUE),
            )
            if (editable) {
                DetailAction(
                    stringResource(if (task.dueTime == null) R.string.add_time else R.string.change_time),
                    { pickingTime = true },
                    if (task.dueTime == null) Icons.Filled.Add else Icons.Filled.Edit,
                )
                if (task.dueTime != null) {
                    DetailAction(stringResource(R.string.remove_time), { actions.setDue(task.localId, task.dueDate, null) }, Icons.Filled.Close)
                }
                HeaderIconButton(
                    Icons.Filled.Close,
                    stringResource(R.string.remove_due),
                    onClick = { actions.setDue(task.localId, null, null) },
                    tint = p.textMuted,
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

/** The one project row: its dot and name, or "No project"; a tap opens the shared picker. */
@Composable
private fun ProjectField(task: Task, editable: Boolean) {
    val projects = LocalProjects.current
    val project = projects.projects.firstOrNull { it.localId == task.projectId }
    InlineValueRow(
        stringResource(R.string.project_label),
        project?.name ?: stringResource(R.string.project_no_project),
        placeholder = project == null,
        editLabel = stringResource(R.string.project_move),
        enabled = editable,
        onClick = { projects.pickTask(task) },
        leading = project?.let { { ProjectMark(it) } },
        modifier = Modifier.testTag("detail-project"),
    )
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
private fun LabelsField(task: Task, known: List<String>, editable: Boolean, actions: TaskDetailActions) {
    var adding by rememberSaveable { mutableStateOf(false) }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.testTag(TaskDetailTags.LABELS),
    ) {
        task.labels.forEach { label ->
            val removeText = stringResource(R.string.remove_label, label)
            LabelChip(
                label,
                enabled = editable,
                removeLabel = removeText,
                onRemove = { actions.setLabels(task.localId, task.labels - label) },
                modifier = if (editable) Modifier.semantics { contentDescription = removeText } else Modifier,
            )
        }
        if (editable) {
            DetailAction(stringResource(R.string.add_label), { adding = true }, Icons.Filled.Add)
        }
    }
    if (task.labels.isEmpty() && !editable) Placeholder(stringResource(R.string.no_labels))
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
    FoldingSection(
        stringResource(R.string.detail_links),
        tag = TaskDetailTags.LINKS_SECTION,
        initiallyExpanded = task.links.isNotEmpty(),
        summary = if (task.links.isEmpty()) stringResource(R.string.no_links) else task.links.size.toString(),
    ) {
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
                        Text(link.title ?: link.url, style = helmType.value, color = p.accent)
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
                DetailAction(stringResource(R.string.add_link), { adding = true }, Icons.Filled.Add, Modifier.padding(top = 8.dp))
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

/**
 * The note in the reading font with a small gap between its paragraphs, folded after about eight lines with a button
 * to show it whole. A tap on it opens the full-screen editor.
 */
@Composable
private fun NoteSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    val note = task.note
    var whole by rememberSaveable(note) { mutableStateOf(false) }
    var cut by remember(note) { mutableStateOf(false) }
    val p = palette
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .testTag(TaskDetailTags.NOTE)
            .clip(HelmShapes.field)
            .clickable(enabled = editable, onClickLabel = stringResource(R.string.edit_note), role = Role.Button) { editing = true }
            .padding(NOTE_INSET),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FieldLabel(stringResource(R.string.quick_add_note), Modifier.weight(1f))
            if (editable) Icon(Icons.Filled.Edit, contentDescription = null, tint = p.textMuted, modifier = Modifier.size(16.dp))
        }
        if (note == null) {
            Text(stringResource(R.string.note_empty), style = helmType.value, color = p.textMuted)
        } else {
            Text(
                paragraphs(note),
                style = helmType.value,
                color = p.text,
                maxLines = if (whole) Int.MAX_VALUE else NOTE_LINES,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (!whole) cut = it.hasVisualOverflow },
                // A screen reader gets the note as written, with its line breaks and whole while folded.
                modifier = Modifier.clearAndSetSemantics { text = AnnotatedString(note) },
            )
        }
    }
    if (cut || whole) {
        TextAction(
            stringResource(if (whole) R.string.title_show_less else R.string.note_show_all),
            { whole = !whole },
            modifier = Modifier.testTag(TaskDetailTags.NOTE_MORE),
        )
    }
    if (editing) {
        LongTextEditor(
            title = stringResource(R.string.edit_note),
            initial = note.orEmpty(),
            maxLength = TaskRules.MAX_NOTE,
            onDismiss = { editing = false },
            onSave = {
                actions.setNote(task.localId, it)
                editing = false
            },
        )
    }
}

/**
 * The note's lines as paragraphs with a gap a third of a line high between them: a paragraph of one zero-width space
 * that low stands for each line break (a paragraph style starts a new paragraph by itself).
 */
private fun paragraphs(text: String): AnnotatedString = buildAnnotatedString {
    text.split(LINE_BREAKS).forEachIndexed { index, line ->
        if (index > 0) withStyle(ParagraphStyle(lineHeight = PARAGRAPH_GAP)) { append(GAP_MARK) }
        append(line)
    }
}

private const val TITLE_LINES = 2

/** About eight lines of note before it folds; the gaps between paragraphs count as lines. */
private const val NOTE_LINES = 10
private val LINE_BREAKS = Regex("\n+")
private val PARAGRAPH_GAP = 8.sp
private const val GAP_MARK = "\u200B"
private val DETAIL_GAP = 8.dp
private val CARD_PADDING = 12.dp

/** Keeps the note's letters clear of the rounded corners of its tappable block; its card is that much tighter. */
private val NOTE_INSET = 6.dp

