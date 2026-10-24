package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.reminderLabel
import dev.helm.planner.ui.components.ChoiceRow
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.settings.REMINDER_OPTIONS
import dev.helm.planner.ui.settings.reminderLabel as minutesLabel
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.LocalTime

private object Mode {
    const val DEFAULT = "default"
    const val NONE = "none"
    const val CUSTOM = "custom"

    fun of(reminders: List<TaskReminder>?) = when {
        reminders == null -> DEFAULT
        reminders.isEmpty() -> NONE
        else -> CUSTOM
    }
}

/** The task's reminders as a row in the Due card: the defaults from Settings, none, or its own. */
@Composable
internal fun RemindersRow(task: Task, defaults: List<Int>, editable: Boolean, actions: TaskDetailActions) {
    var editing by rememberSaveable { mutableStateOf(false) }
    ValueRow(
        label = stringResource(R.string.detail_reminders),
        value = remindersSummary(task.reminders, defaults),
        placeholder = task.reminders == null,
        editLabel = stringResource(R.string.edit_reminders),
        enabled = editable,
        onClick = { editing = true },
        modifier = Modifier.testTag(TaskDetailTags.REMINDERS),
    )
    if (editing) {
        RemindersDialog(
            initial = task.reminders,
            defaults = defaults,
            timed = task.dueTime != null,
            onDismiss = { editing = false },
            onSave = {
                actions.setReminders(task.localId, it)
                editing = false
            },
        )
    }
}

/** "Default: at the due time", "None", "15 min before, 18:00, the day before". */
@Composable
internal fun remindersSummary(reminders: List<TaskReminder>?, defaults: List<Int>): String = when {
    reminders == null -> stringResource(R.string.reminders_default_value, defaultsText(defaults))
    reminders.isEmpty() -> stringResource(R.string.reminders_none)
    else -> reminders.map { reminderLabel(it) }.joinToString(", ")
}

@Composable
private fun defaultsText(defaults: List<Int>): String =
    if (defaults.isEmpty()) stringResource(R.string.reminders_none_lower) else defaults.sorted().map { minutesLabel(it) }.joinToString(", ")

/**
 * Reminders of one task: as in Settings, none, or its own: minutes before the due time (only a timed task rings
 * them) and times of day on the due day or the day before. Times set elsewhere further ahead are kept and shown.
 */
@Composable
fun RemindersDialog(initial: List<TaskReminder>?, defaults: List<Int>, timed: Boolean, onDismiss: () -> Unit, onSave: (List<TaskReminder>?) -> Unit) {
    var mode by rememberSaveable { mutableStateOf(Mode.of(initial)) }
    var minutes by rememberSaveable { mutableStateOf(initial?.mapNotNull { it.minutesBefore } ?: defaults) }
    // "HH:MM" or "HH:MM|days" (days before the due day).
    var times by rememberSaveable { mutableStateOf(initial.orEmpty().mapNotNull { r -> r.time?.let { "$it|${r.daysBefore ?: 0}" } }) }
    var picking by rememberSaveable { mutableStateOf<Int?>(null) }
    val custom = minutes.sorted().map(TaskReminder::before) + times.map { entry ->
        val (time, days) = entry.split("|")
        TaskReminder.at(time, days.toInt())
    }
    val chosen = when (mode) {
        Mode.DEFAULT -> null
        Mode.NONE -> emptyList()
        else -> custom
    }
    val valid = chosen == null || TaskRules.reminders(chosen) != null
    HelmDialog(
        title = stringResource(R.string.edit_reminders),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.save),
        onConfirm = { onSave(chosen) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = valid,
        confirmTag = EditorTags.SAVE,
    ) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            RadioRow(
                stringResource(R.string.reminders_mode_default),
                mode == Mode.DEFAULT,
                EditorTags.REMINDERS_DEFAULT,
                note = defaultsText(defaults),
            ) { mode = Mode.DEFAULT }
            RadioRow(stringResource(R.string.reminders_mode_none), mode == Mode.NONE, EditorTags.REMINDERS_NONE) { mode = Mode.NONE }
            RadioRow(stringResource(R.string.reminders_mode_custom), mode == Mode.CUSTOM, EditorTags.REMINDERS_CUSTOM) { mode = Mode.CUSTOM }
            if (mode != Mode.CUSTOM) return@Column
            GroupLabel(stringResource(R.string.reminders_before_title))
            if (!timed) Text(stringResource(R.string.reminders_needs_time), style = helmType.small, color = palette.textMuted)
            (REMINDER_OPTIONS + minutes).distinct().sorted().forEach { option ->
                val selected = option in minutes
                ChoiceRow(
                    minutesLabel(option),
                    selected = selected,
                    tag = EditorTags.before(option),
                    onSelect = { minutes = if (selected) minutes - option else minutes + option },
                    multiple = true,
                )
            }
            GroupLabel(stringResource(R.string.reminders_times_title))
            times.forEachIndexed { index, entry ->
                val (time, days) = entry.split("|")
                val label = reminderLabel(TaskReminder.at(time, days.toInt()))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = HelmDimens.touchTarget)) {
                    Text(label, style = helmType.body, color = palette.text, modifier = Modifier.weight(1f))
                    HeaderIconButton(
                        Icons.Filled.Close,
                        stringResource(R.string.reminder_remove, label),
                        onClick = { times = times.filterIndexed { i, _ -> i != index } },
                        tint = palette.textMuted,
                    )
                }
            }
            TextAction(stringResource(R.string.reminders_add_on_day), { picking = 0 }, modifier = Modifier.testTag(EditorTags.REMINDER_ON_DAY))
            TextAction(stringResource(R.string.reminders_add_day_before), { picking = 1 }, modifier = Modifier.testTag(EditorTags.REMINDER_DAY_BEFORE))
            if (!valid) Text(pluralStringResource(R.plurals.reminders_too_many, TaskRules.MAX_REMINDERS, TaskRules.MAX_REMINDERS), style = helmType.small, color = palette.danger)
        }
    }
    picking?.let { days ->
        TimePickerDialog(
            initial = LocalTime.of(if (days == 0) 9 else 18, 0),
            onDismiss = { picking = null },
            onPick = { time ->
                picking = null
                val entry = "$time|$days"
                if (entry !in times) times = times + entry
            },
        )
    }
}
