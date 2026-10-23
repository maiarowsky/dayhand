package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatFrom
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.WeekdayOfMonth
import dev.helm.planner.domain.Recurrence
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.common.monthPatternLabel
import dev.helm.planner.ui.common.weekdayName
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.helmRadioColors
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.DayPickerDialog
import java.time.LocalDate

/**
 * How a monthly rule picks its day, as a key that survives rotation: `same` (the due date's day), `last`, `day:31`,
 * `nth:2:2` (the 2nd Tuesday) or `nth:-1:5` (the last Friday).
 */
internal object MonthKey {
    const val SAME = "same"
    const val LAST = "last"

    fun of(rule: RepeatRule?): String = when {
        rule?.monthDay == -1 -> LAST
        rule?.monthDay != null -> "day:${rule.monthDay}"
        rule?.weekdayOfMonth != null -> "nth:${rule.weekdayOfMonth.nth}:${rule.weekdayOfMonth.weekday}"
        else -> SAME
    }

    /** The choices for a task due on [due]: its day, the last day, its nth weekday and, in the last week, the last one. */
    fun options(due: LocalDate, initial: RepeatRule?): List<String> = buildList {
        add(SAME)
        add(LAST)
        add("nth:${Recurrence.nthOfMonth(due)}:${due.dayOfWeek.value}")
        if (Recurrence.isLastOfMonth(due)) add("nth:-1:${due.dayOfWeek.value}")
        val current = of(initial)
        if (initial?.every == RepeatEvery.MONTH && current !in this) add(current)
    }

    fun apply(key: String, rule: RepeatRule): RepeatRule {
        val parts = key.split(":")
        return when (parts[0]) {
            LAST -> rule.copy(monthDay = -1)
            "day" -> rule.copy(monthDay = parts[1].toInt())
            "nth" -> rule.copy(weekdayOfMonth = WeekdayOfMonth(parts[1].toInt(), parts[2].toInt()))
            else -> rule
        }
    }
}

private object Ends {
    const val NEVER = "never"
    const val UNTIL = "until"
    const val COUNT = "count"

    fun of(rule: RepeatRule?) = when {
        rule?.until != null -> UNTIL
        rule?.count != null -> COUNT
        else -> NEVER
    }
}

/**
 * Repeat: never, or every N days / weeks (on chosen weekdays) / months (on the due date's day, the last day or an nth
 * weekday) / years; counted from the due date or from completion; ending never, on a day or after a number of times.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RepeatDialog(initial: RepeatRule?, due: LocalDate, today: LocalDate, onDismiss: () -> Unit, onSave: (RepeatRule?) -> Unit) {
    var every by rememberSaveable { mutableStateOf(initial?.every) }
    var interval by rememberSaveable { mutableStateOf((initial?.interval ?: 1).toString()) }
    var weekdays by rememberSaveable { mutableStateOf(initial?.weekdays.orEmpty()) }
    var month by rememberSaveable { mutableStateOf(MonthKey.of(initial)) }
    var fromCompletion by rememberSaveable { mutableStateOf(initial?.fromCompletion == true) }
    var ends by rememberSaveable { mutableStateOf(Ends.of(initial)) }
    var until by rememberSaveable { mutableStateOf(initial?.until) }
    var count by rememberSaveable { mutableStateOf((initial?.count ?: 10).toString()) }
    var pickingUntil by rememberSaveable { mutableStateOf(false) }
    val rule = every?.let { unit ->
        val base = RepeatRule(
            every = unit,
            interval = interval.toIntOrNull() ?: 0,
            weekdays = weekdays.sorted().takeIf { unit == RepeatEvery.WEEK && it.isNotEmpty() },
            from = RepeatFrom.COMPLETION.takeIf { fromCompletion },
            until = until.takeIf { ends == Ends.UNTIL },
            count = (count.toIntOrNull() ?: 0).takeIf { ends == Ends.COUNT },
        )
        if (unit == RepeatEvery.MONTH) MonthKey.apply(month, base) else base
    }
    val valid = rule == null || (TaskRules.isValid(rule) && (ends != Ends.UNTIL || until != null))
    HelmDialog(
        title = stringResource(R.string.edit_repeat),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.save),
        onConfirm = { onSave(rule) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = valid,
        confirmTag = EditorTags.SAVE,
    ) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            (listOf(null) + RepeatEvery.entries).forEach { unit ->
                RadioRow(stringResource(everyLabel(unit)), every == unit, EditorTags.every(unit)) { every = unit }
            }
            val unit = every ?: return@Column
            HelmTextField(
                value = interval,
                onValueChange = { value -> if (value.length <= 3 && value.all(Char::isDigit)) interval = value },
                label = stringResource(R.string.repeat_interval),
                singleLine = true,
                isError = (interval.toIntOrNull() ?: 0) !in 1..TaskRules.MAX_REPEAT_INTERVAL,
                supportingText = if ((interval.toIntOrNull() ?: 0) !in 1..TaskRules.MAX_REPEAT_INTERVAL) {
                    stringResource(R.string.repeat_interval_invalid, TaskRules.MAX_REPEAT_INTERVAL)
                } else {
                    null
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier
                    .padding(top = 8.dp)
                    .testTag(EditorTags.INTERVAL),
            )
            if (unit == RepeatEvery.WEEK) {
                GroupLabel(stringResource(R.string.repeat_on))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    (1..7).forEach { day ->
                        HelmChip(
                            weekdayName(day, appLocale()),
                            selected = day in weekdays,
                            onClick = { weekdays = if (day in weekdays) weekdays - day else weekdays + day },
                            multiple = true,
                            modifier = Modifier.testTag(EditorTags.weekday(day)),
                        )
                    }
                }
            }
            if (unit == RepeatEvery.MONTH) {
                GroupLabel(stringResource(R.string.repeat_on_month))
                MonthKey.options(due, initial).forEach { key ->
                    RadioRow(monthOptionLabel(key, due), month == key, EditorTags.month(key)) { month = key }
                }
            }
            GroupLabel(stringResource(R.string.repeat_from))
            RadioRow(stringResource(R.string.repeat_from_due), !fromCompletion, EditorTags.FROM_DUE) { fromCompletion = false }
            RadioRow(stringResource(R.string.repeat_from_completion), fromCompletion, EditorTags.FROM_COMPLETION) { fromCompletion = true }
            GroupLabel(stringResource(R.string.repeat_ends))
            RadioRow(stringResource(R.string.repeat_ends_never), ends == Ends.NEVER, EditorTags.END_NEVER) { ends = Ends.NEVER }
            val untilText = until?.let { stringResource(R.string.repeat_ends_on, dayLabel(LocalDate.parse(it), today)) }
            RadioRow(untilText ?: stringResource(R.string.repeat_ends_until), ends == Ends.UNTIL, EditorTags.END_UNTIL) {
                ends = Ends.UNTIL
                pickingUntil = true
            }
            RadioRow(stringResource(R.string.repeat_ends_count), ends == Ends.COUNT, EditorTags.END_COUNT) { ends = Ends.COUNT }
            if (ends == Ends.COUNT) {
                val countValid = (count.toIntOrNull() ?: 0) in 1..TaskRules.MAX_REPEAT_COUNT
                HelmTextField(
                    value = count,
                    onValueChange = { value -> if (value.length <= 4 && value.all(Char::isDigit)) count = value },
                    label = stringResource(R.string.repeat_count),
                    singleLine = true,
                    isError = !countValid,
                    supportingText = if (!countValid) stringResource(R.string.repeat_interval_invalid, TaskRules.MAX_REPEAT_COUNT) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.testTag(EditorTags.COUNT),
                )
            }
            if (pickingUntil) {
                DayPickerDialog(
                    initial = until?.let(LocalDate::parse) ?: maxOf(due, today).plusMonths(1),
                    onDismiss = {
                        pickingUntil = false
                        if (until == null) ends = Ends.NEVER
                    },
                    onPick = {
                        pickingUntil = false
                        until = it.toString()
                    },
                )
            }
        }
    }
}

@Composable
private fun monthOptionLabel(key: String, due: LocalDate): String = when (key) {
    MonthKey.SAME -> stringResource(R.string.repeat_month_same_day, due.dayOfMonth)
    else -> monthPatternLabel(MonthKey.apply(key, RepeatRule(RepeatEvery.MONTH)), long = true).orEmpty()
}

/** A muted heading over a group of choices in an editor dialog. */
@Composable
internal fun GroupLabel(text: String) {
    Text(text, style = helmType.smallStrong, color = palette.textMuted, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
}

/** One choice of a group in an editor dialog: a radio button and its text, with an optional muted [note] under it. */
@Composable
internal fun RadioRow(text: String, selected: Boolean, tag: String, note: String? = null, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .testTag(tag),
    ) {
        RadioButton(selected = selected, onClick = null, colors = helmRadioColors())
        Column(Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp)) {
            Text(text, style = helmType.body, color = palette.text)
            note?.let { Text(it, style = helmType.small, color = palette.textMuted) }
        }
    }
}

private fun everyLabel(every: RepeatEvery?) = when (every) {
    null -> R.string.repeat_none
    RepeatEvery.DAY -> R.string.repeat_unit_day
    RepeatEvery.WEEK -> R.string.repeat_unit_week
    RepeatEvery.MONTH -> R.string.repeat_unit_month
    RepeatEvery.YEAR -> R.string.repeat_unit_year
}
