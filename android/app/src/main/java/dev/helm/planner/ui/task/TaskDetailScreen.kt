package dev.helm.planner.ui.task

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

object TaskDetailTags {
    const val TITLE = "detail-title"
    const val TITLE_MORE = "detail-title-more"
    const val SUMMARY = "detail-summary"
    const val STATUS = "detail-status"
    const val PROJECT = "detail-project"
    const val MORE = "detail-more"
    const val MORE_CONTENT = "detail-more-content"
    const val NOW = "detail-now"
    const val NOTE = "detail-note"
    const val NOTE_MORE = "detail-note-more"
    const val DUE = "detail-due"
    const val DUE_DAY = "detail-due-day"
    const val DUE_CLEAR = "detail-due-clear"
    const val TIME = "detail-time"
    const val TIME_CLEAR = "detail-time-clear"
    const val REPEAT = "detail-repeat"
    const val REMINDERS = "detail-reminders"
    const val LINKS = "detail-links"
    const val TRASH = "detail-trash"
    const val TRASH_BANNER = "detail-trash-banner"
    const val RESTORE = "detail-restore"
    const val HISTORY = "detail-history"
    const val HISTORY_MORE = "detail-history-more"
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
 * Top to bottom: the title (two lines, unfolded on request), one card with everything read before the note
 * ([TaskSummary]), the note (folded after about eight lines), the change history right under it, an agent's work,
 * and the trash.
 */
@Composable
private fun DetailBody(state: TaskDetailUiState.Ready, actions: TaskDetailActions) {
    val task = state.task
    val today = LocalDate.parse(state.today)
    val editable = !task.inTrash
    if (task.inTrash || task.archivedAt != null) RestoreBanner(task, today, state.timezone, actions)
    TitleSection(task, editable, actions)
    TaskSummary(state, today, editable, actions)
    HelmCard(contentPadding = CARD_PADDING - NOTE_INSET) { NoteSection(task, editable, actions) }
    HistorySection(state)
    AgentWorkSection(task, state.dependencies, System.currentTimeMillis(), state.timezone, editable, actions)
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

