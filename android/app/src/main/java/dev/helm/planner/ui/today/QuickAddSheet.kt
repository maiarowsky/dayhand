package dev.helm.planner.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.QuickAdd
import dev.helm.planner.domain.QuickAddInput
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.common.minuteTicks
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectPickerSheet
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.LocalTime

object QuickAddTags {
    const val TITLE = "quick_add_title"
    const val SAVE = "quick_add_save"
    const val WHEN = "quick_add_when"
    const val KEEP = "quick_add_keep"
}

/**
 * One title field and one tap to save; day (today by default), time and note are behind
 * "More options". The keyboard's Done key saves too.
 *
 * A date phrase at the end of the title ("Call the accountant fri 2pm") sets the day and time, read in [timezone] at
 * [now] ([QuickAdd], the grammar of `dayhand`); a grey line under the field says what was understood, and **Keep in
 * title** keeps the words as text. A day or time picked under "More options" wins over the phrase.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickAddSheet(
    timezone: String,
    onDismiss: () -> Unit,
    onSave: (title: String, dueDate: String, dueTime: String?, note: String?, projectLocalId: String?) -> Unit,
    now: () -> Long = System::currentTimeMillis,
    defaultProjectId: String? = null,
) {
    val projects = LocalProjects.current.projects
    var projectId by rememberSaveable { mutableStateOf(defaultProjectId) }
    var pickedProject by rememberSaveable { mutableStateOf(false) }
    var pickingProject by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var day by rememberSaveable { mutableStateOf<String?>(null) }
    var time by rememberSaveable { mutableStateOf<String?>(null) }
    // A day or time picked under "More options" wins over a phrase in the title.
    var picked by rememberSaveable { mutableStateOf(false) }
    // "Keep in title", until the title changes again.
    var keep by rememberSaveable { mutableStateOf(false) }
    var note by rememberSaveable { mutableStateOf("") }
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    var referenceTime by remember(now) { mutableLongStateOf(now()) }
    LaunchedEffect(now) { minuteTicks(now).collect { referenceTime = it } }
    val today = LocalDate.parse(HelmDates.localDate(referenceTime, timezone))
    val selectedDay = day ?: today.toString()
    val parsed = QuickAdd.parse(title, referenceTime, timezone, projects)
    val selectedProject = if (pickedProject) projectId else parsed.projectLocalId ?: projectId
    val canSave = title.isNotBlank() && (selectedProject == null || projects.any { it.localId == selectedProject && it.selectable })
    val input = parsed.takeIf { it.`when` != null && !picked }
    val read = input?.takeIf { !keep }
    val save = {
        val submittedAt = now()
        referenceTime = submittedAt
        val submitted = QuickAdd.parse(title, submittedAt, timezone, projects, readDate = !keep && !picked)
        val trimmedNote = note.trim().ifEmpty { null }
        val due = submitted.`when`
        val project = if (pickedProject) projectId else submitted.projectLocalId ?: projectId
        if (canSave && submitted.title.isNotBlank()) {
            onSave(submitted.title, due?.date ?: day ?: HelmDates.localDate(submittedAt, timezone), due?.time ?: time, trimmedNote, project)
        }
    }

    val p = palette
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = p.surface,
        contentColor = p.text,
        shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = p.border) },
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = HelmDimens.screenMargin)
                .padding(bottom = 24.dp)
                .imePadding()
                .verticalScroll(rememberScrollState()),
        ) {
            Text(projects.firstOrNull { it.localId == defaultProjectId }?.let { stringResource(R.string.project_add_to, it.name) }
                ?: stringResource(R.string.quick_add_title), style = helmType.screenTitle, color = p.text)
            HelmTextField(
                value = title,
                onValueChange = {
                    if (it.length <= TaskRepository.MAX_TITLE) {
                        if (it != title) keep = false
                        title = it
                    }
                },
                label = stringResource(R.string.quick_add_field),
                placeholder = stringResource(R.string.quick_add_example),
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
                modifier = Modifier
                    .focusRequester(focus)
                    .testTag(QuickAddTags.TITLE),
            )
            if (canSave) {
                WhenLine(today, read, picked, selectedDay, time)
                projects.firstOrNull { it.localId == selectedProject }?.let {
                    Text(stringResource(R.string.project_preview, it.name), style = helmType.small, color = p.textMuted,
                        modifier = Modifier.testTag("quick-add-project-preview"))
                }
                parsed.unknownProject?.let { Text(stringResource(R.string.project_unknown, it), style = helmType.small, color = p.textMuted) }
                if (input != null) {
                    SwitchRow(
                        stringResource(R.string.quick_add_keep_in_title),
                        checked = keep,
                        onChange = { keep = it },
                        subtitle = stringResource(R.string.quick_add_keep_in_title_hint),
                        modifier = Modifier.testTag(QuickAddTags.KEEP),
                    )
                }
            }
            // Save sits right under the title (and what it understood) so the keyboard never hides it.
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextAction(
                    stringResource(if (expanded) R.string.quick_add_less else R.string.quick_add_more),
                    onClick = { expanded = !expanded },
                    color = p.secondary,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                PrimaryButton(
                    stringResource(R.string.quick_add_save),
                    onClick = save,
                    enabled = canSave,
                    fillWidth = false,
                    modifier = Modifier.testTag(QuickAddTags.SAVE),
                )
            }
            if (expanded) {
                ListRow(stringResource(R.string.project_label), "quick-add-project", value = projects.firstOrNull { it.localId == selectedProject }?.name
                    ?: stringResource(R.string.project_no_project), onClick = { pickingProject = true })
                MoreOptions(
                    today = today,
                    day = selectedDay,
                    time = time,
                    note = note,
                    onDay = {
                        day = it
                        picked = true
                    },
                    onPickDay = { pickingDay = true },
                    onPickTime = { pickingTime = true },
                    onClearTime = {
                        time = null
                        picked = true
                    },
                    onNote = { note = it },
                )
            }
        }
    }
    if (pickingProject) ProjectPickerSheet(selectedProject, onDismiss = { pickingProject = false }, onPick = {
        projectId = it
        pickedProject = true
    })
    LaunchedEffect(Unit) { focus.requestFocus() }
    if (pickingDay) {
        DayPickerDialog(LocalDate.parse(selectedDay), onDismiss = { pickingDay = false }) {
            day = it.toString()
            picked = true
            pickingDay = false
        }
    }
    if (pickingTime) {
        TimePickerDialog(time?.let(LocalTime::parse) ?: LocalTime.of(9, 0), onDismiss = { pickingTime = false }) {
            time = it
            picked = true
            pickingTime = false
        }
    }
}

/**
 * What the task will get, under the title: "Friday 30 Oct, 14:00 · from “fri 2pm”", "No date phrase: today", or the
 * day and time picked under "More options". Read out when it changes.
 */
@Composable
private fun WhenLine(today: LocalDate, read: QuickAddInput?, picked: Boolean, day: String, time: String?) {
    val due = read?.`when`
    val text = when {
        read != null && due != null -> stringResource(R.string.quick_add_from_phrase, whenLabel(due.date, due.time, today), read.phrase.orEmpty())
        picked -> stringResource(R.string.quick_add_from_options, whenLabel(day, time, today))
        else -> stringResource(R.string.quick_add_no_phrase)
    }
    Text(
        text,
        style = helmType.small,
        color = palette.textMuted,
        modifier = Modifier
            .testTag(QuickAddTags.WHEN)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** "Friday 30 Oct, 14:00" in the app's language, with the year when it is not this year's. */
@Composable
private fun whenLabel(date: String, time: String?, today: LocalDate): String {
    val locale = appLocale()
    val d = LocalDate.parse(date)
    val day = d.format(dateFormat(if (d.year == today.year) "EEEEdMMM" else "yMMMEEEEd", locale))
        .replaceFirstChar { it.titlecase(locale) }
    return time?.let { stringResource(R.string.day_and_time, day, it) } ?: day
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoreOptions(
    today: LocalDate,
    day: String,
    time: String?,
    note: String,
    onDay: (String) -> Unit,
    onPickDay: () -> Unit,
    onPickTime: () -> Unit,
    onClearTime: () -> Unit,
    onNote: (String) -> Unit,
) {
    val tomorrow = today.plusDays(1).toString()
    val other = day != today.toString() && day != tomorrow
    val muted = palette.textMuted
    SectionLabel(stringResource(R.string.quick_add_day), color = muted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HelmChip(stringResource(R.string.quick_add_today), selected = day == today.toString(), onClick = { onDay(today.toString()) })
        HelmChip(stringResource(R.string.quick_add_tomorrow), selected = day == tomorrow, onClick = { onDay(tomorrow) })
        HelmChip(
            if (other) LocalDate.parse(day).format(dateFormat("EEEdMMM", appLocale()))
            else stringResource(R.string.move_to_day),
            selected = other,
            onClick = onPickDay,
        )
    }
    SectionLabel(stringResource(R.string.quick_add_time), color = muted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HelmChip(stringResource(R.string.quick_add_no_time), selected = time == null, onClick = onClearTime)
        HelmChip(time ?: stringResource(R.string.quick_add_time), selected = time != null, onClick = onPickTime)
    }
    HelmTextField(
        value = note,
        onValueChange = { if (it.length <= TaskRepository.MAX_NOTE) onNote(it) },
        label = stringResource(R.string.quick_add_note),
        minLines = 2,
    )
}
