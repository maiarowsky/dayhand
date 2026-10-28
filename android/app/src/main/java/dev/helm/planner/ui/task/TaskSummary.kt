package dev.helm.planner.ui.task

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.common.repeatLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.HelmMenu
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectMark
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.DayPickerDialog
import dev.helm.planner.ui.today.ResumeNoteDialog
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.LocalDate
import java.time.LocalTime

/**
 * Everything above the note in one card, so the note starts high on the first screen: the status, the due day with its
 * time and the project as chips in one row (wrapping only when they do not fit), then one folded row that lists the
 * rest ("More: Now · Every week · Default: at the due time · Checklist 1 of 3 done"). Unfolded, that row holds
 * work on it now and where it stopped, the proof of completion, repeat, reminders, the checklist and the links.
 */
@Composable
internal fun TaskSummary(state: TaskDetailUiState.Ready, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    val task = state.task
    HelmCard(Modifier.testTag(TaskDetailTags.SUMMARY), contentPadding = SUMMARY_PADDING) {
        StatusDueAndProject(task, today, editable, actions)
        MoreFold(state, today, editable, actions)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusDueAndProject(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        StatusChip(task, editable, actions)
        DueChip(task, today, editable, actions)
        ProjectChip(task, editable)
    }
}

/**
 * The status as one chip ("To do ▾"); a tap opens the three statuses, the current one ticked. A screen reader hears
 * "Status: To do" and that a tap changes it; each status in the menu is a radio button.
 */
@Composable
private fun StatusChip(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var open by remember { mutableStateOf(false) }
    val p = palette
    val done = task.status == TaskStatus.DONE
    Box {
        SummaryChip(
            value = statusLabel(task.status),
            name = stringResource(R.string.detail_status),
            color = if (done) p.text else p.accent,
            background = if (done) p.surfaceRaised else p.accentSoft,
            clickLabel = stringResource(R.string.change_status),
            onClick = if (editable) ({ open = true }) else null,
            modifier = Modifier.testTag(TaskDetailTags.STATUS),
            trailing = if (editable) Icons.Filled.KeyboardArrowDown else null,
        )
        HelmMenu(expanded = open, onDismiss = { open = false }) {
            TaskStatus.entries.forEach { status ->
                val chosen = status == task.status
                DropdownMenuItem(
                    text = { Text(statusLabel(status), style = helmType.body, color = p.text) },
                    leadingIcon = { Icon(Icons.Filled.Check, contentDescription = null, tint = if (chosen) p.accent else Color.Transparent) },
                    onClick = {
                        open = false
                        if (!chosen) actions.move(task.localId, status)
                    },
                    modifier = Modifier
                        .heightIn(min = HelmDimens.touchTarget)
                        .semantics {
                            role = Role.RadioButton
                            selected = chosen
                        }
                        .testTag(TaskDetailTags.status(status)),
                )
            }
        }
    }
}

/**
 * The due day and its time as one chip ("yesterday, 14:00 ▾", red when it has passed) whose menu picks another day,
 * adds, changes or removes the time, or takes the due day away. Without a due day, one button picks it.
 */
@Composable
private fun DueChip(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    var menu by remember { mutableStateOf(false) }
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val p = palette
    val day = task.dueDate?.let(LocalDate::parse)
    val due = dueLabel(task, today)
    if (due == null) {
        if (editable) {
            DetailAction(stringResource(R.string.pick_day), { pickingDay = true }, Icons.Filled.DateRange, Modifier.testTag(TaskDetailTags.DUE))
        } else {
            SummaryChip(stringResource(R.string.detail_no_due), stringResource(R.string.detail_due), p.textMuted, p.surfaceRaised,
                modifier = Modifier.testTag(TaskDetailTags.DUE))
        }
    } else {
        val overdue = HelmDates.isOverdue(task, today.toString())
        Box {
            SummaryChip(
                value = due,
                name = stringResource(R.string.detail_due),
                color = if (overdue) p.danger else p.text,
                background = if (overdue) p.dangerSoft else p.surfaceRaised,
                clickLabel = stringResource(R.string.change_due),
                onClick = if (editable) ({ menu = true }) else null,
                modifier = Modifier.testTag(TaskDetailTags.DUE),
                trailing = if (editable) Icons.Filled.KeyboardArrowDown else null,
            )
            HelmMenu(expanded = menu, onDismiss = { menu = false }) {
                DueMenuItem(R.string.pick_day, TaskDetailTags.DUE_DAY) { menu = false; pickingDay = true }
                DueMenuItem(if (task.dueTime == null) R.string.add_time else R.string.change_time, TaskDetailTags.TIME) { menu = false; pickingTime = true }
                if (task.dueTime != null) {
                    DueMenuItem(R.string.remove_time, TaskDetailTags.TIME_CLEAR) { menu = false; actions.setDue(task.localId, task.dueDate, null) }
                }
                DueMenuItem(R.string.remove_due, TaskDetailTags.DUE_CLEAR) { menu = false; actions.setDue(task.localId, null, null) }
            }
        }
    }
    if (pickingDay) {
        DayPickerDialog(
            initial = day ?: today,
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
private fun DueMenuItem(@StringRes text: Int, tag: String, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(stringResource(text), style = helmType.body, color = palette.text) },
        onClick = onClick,
        modifier = Modifier.heightIn(min = HelmDimens.touchTarget).testTag(tag),
    )
}

/**
 * A value as a chip that opens its editor: the value and, when it opens a menu, an arrow after it.
 * A screen reader hears "[name]: value" and what a tap does. At least 48 dp high.
 */
@Composable
private fun SummaryChip(
    value: String,
    name: String,
    color: Color,
    background: Color,
    modifier: Modifier = Modifier,
    clickLabel: String? = null,
    onClick: (() -> Unit)? = null,
    trailing: androidx.compose.ui.graphics.vector.ImageVector? = null,
    leading: (@Composable () -> Unit)? = null,
) {
    val described = "$name: $value"
    Row(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .background(background)
            .then(if (onClick != null) Modifier.clickable(onClickLabel = clickLabel, role = Role.Button, onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) { contentDescription = described }
            .padding(start = 12.dp, end = if (trailing != null) 6.dp else 12.dp, top = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading?.invoke()
        Text(value, style = helmType.valueSmall, color = color)
        trailing?.let { Icon(it, contentDescription = null, tint = color, modifier = Modifier.size(18.dp)) }
    }
}

/** The project as a chip after the due day (its dot and name, or "No project"); a tap opens the shared picker. */
@Composable
private fun ProjectChip(task: Task, editable: Boolean) {
    val projects = LocalProjects.current
    val project = projects.projects.firstOrNull { it.localId == task.projectId }
    val p = palette
    SummaryChip(
        value = project?.name ?: stringResource(R.string.project_no_project),
        name = stringResource(R.string.project_label),
        color = if (project == null) p.textMuted else p.text,
        background = p.surfaceRaised,
        clickLabel = stringResource(R.string.project_move),
        onClick = if (editable) ({ projects.pickTask(task) }) else null,
        modifier = Modifier.testTag(TaskDetailTags.PROJECT),
        trailing = if (editable) Icons.Filled.KeyboardArrowDown else null,
        leading = project?.let { { ProjectMark(it) } },
    )
}

/**
 * The rest of the task's fields behind one row: its header names them with their values in one or two lines, so most
 * of the time nothing needs to unfold. The header is one button for a screen reader, with its state.
 */
@Composable
private fun MoreFold(state: TaskDetailUiState.Ready, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val task = state.task
    val p = palette
    val stateText = stringResource(if (expanded) R.string.section_expanded else R.string.section_collapsed)
    val summary = moreSummary(state)
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = HelmDimens.touchTarget)
                .clip(HelmShapes.field)
                .clickable { expanded = !expanded }
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    stateDescription = stateText
                    heading()
                }
                .padding(vertical = 4.dp)
                .testTag(TaskDetailTags.MORE),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // "More: Every week · Checklist 1 of 3 done", the name in the muted colour, in at most two lines.
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = p.textMuted, fontWeight = FontWeight.SemiBold)) { append(stringResource(R.string.detail_more)) }
                    append(": ")
                    append(summary)
                },
                style = helmType.small,
                color = p.text,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 4.dp),
            )
            Icon(
                if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = p.textMuted,
                modifier = Modifier.padding(horizontal = 12.dp).size(HelmDimens.iconSize),
            )
        }
        if (expanded) {
            Column(Modifier.testTag(TaskDetailTags.MORE_CONTENT), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FieldDivider()
                NowFields(task, editable, actions)
                task.proof?.let { ProofLine(it) }
                RepeatRow(task, today, editable, actions)
                RemindersRow(task, state.defaultReminders, editable, actions)
                FieldDivider()
                ChecklistField(task, editable, actions)
                FieldDivider()
                LinksField(task, editable, actions)
            }
        }
    }
}

/** "Now · Every week · Default: at the due time · Checklist 1 of 3 done · Links 2 · Proof of completion". */
@Composable
private fun moreSummary(state: TaskDetailUiState.Ready): String {
    val task = state.task
    return listOfNotNull(
        if (task.isNow) stringResource(R.string.section_now) else null,
        task.repeat?.let { repeatLabel(it) } ?: stringResource(R.string.repeat_none),
        remindersSummary(task.reminders, state.defaultReminders),
        task.checklist.takeIf { it.isNotEmpty() }?.let { checklistTitle(it) },
        task.links.takeIf { it.isNotEmpty() }?.let { "${stringResource(R.string.detail_links)} ${it.size}" },
        task.proof?.let { stringResource(R.string.detail_proof) },
    ).joinToString(" · ")
}

/** "Work on it now", and where the work stopped while it is the now task. */
@Composable
private fun NowFields(task: Task, editable: Boolean, actions: TaskDetailActions) {
    if (task.status != TaskStatus.DONE) {
        SwitchRow(
            stringResource(R.string.set_now),
            checked = task.isNow,
            onChange = { on -> if (on) actions.setNow(task.localId) else actions.clearNow() },
            enabled = editable,
            modifier = Modifier.testTag(TaskDetailTags.NOW),
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

@Composable
private fun RepeatRow(task: Task, today: LocalDate, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    InlineValueRow(
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

/** The links under their name, each opening in the browser, with a cross to remove it and a button to add one. */
@Composable
private fun LinksField(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var adding by rememberSaveable { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val p = palette
    Column(Modifier.testTag(TaskDetailTags.LINKS)) {
        FieldLabel(stringResource(R.string.detail_links))
        task.links.forEach { link ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = HelmDimens.touchTarget)
                        .clickable(onClickLabel = stringResource(R.string.open_link)) { uriHandler.openUri(link.url) }
                        .padding(vertical = 8.dp),
                ) {
                    Text(link.title ?: link.url, style = helmType.valueSmall, color = p.accent)
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
        if (task.links.isEmpty() && !editable) Placeholder(stringResource(R.string.no_links))
        if (editable && task.links.size < TaskRules.MAX_LINKS) {
            DetailAction(stringResource(R.string.add_link), { adding = true }, Icons.Filled.Add)
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

/** The card's inner margin: the chips' own padding keeps their text off its rounded corners. */
private val SUMMARY_PADDING = 10.dp
