package dev.helm.planner.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Board column names, also used for the status of a task. */
@Composable
fun statusLabel(status: TaskStatus): String = stringResource(
    when (status) {
        TaskStatus.TODO -> R.string.column_todo
        TaskStatus.DOING -> R.string.column_doing
        TaskStatus.DONE -> R.string.column_done
    },
)

/** "today", "tomorrow", "yesterday" or a short date such as "Mon, 19 Oct" (with the year when not this year). */
@Composable
fun dayLabel(date: LocalDate, today: LocalDate): String = when (date) {
    today -> stringResource(R.string.day_today)
    today.plusDays(1) -> stringResource(R.string.day_tomorrow)
    today.minusDays(1) -> stringResource(R.string.yesterday)
    else -> date.format(DateTimeFormatter.ofPattern(if (date.year == today.year) "EEE, d MMM" else "EEE, d MMM yyyy", Locale.getDefault()))
}

/** The due day and time of a task, e.g. "tomorrow, 09:00", or null without a due day. */
@Composable
fun dueLabel(task: Task, today: LocalDate): String? {
    val day = task.dueDate?.let { dayLabel(LocalDate.parse(it), today) } ?: return null
    return task.dueTime?.let { stringResource(R.string.day_and_time, day, it) } ?: day
}

/** "Every day", "Every 2 weeks: Mon, Thu", ... */
@Composable
fun repeatLabel(rule: RepeatRule): String {
    val plural = when (rule.every) {
        RepeatEvery.DAY -> R.plurals.repeat_days
        RepeatEvery.WEEK -> R.plurals.repeat_weeks
        RepeatEvery.MONTH -> R.plurals.repeat_months
        RepeatEvery.YEAR -> R.plurals.repeat_years
    }
    val every = pluralStringResource(plural, rule.interval, rule.interval)
    val days = rule.weekdays?.sorted()?.joinToString(", ") { weekdayName(it) } ?: return every
    return stringResource(R.string.repeat_on_days, every, days)
}

/** Short name of ISO weekday [day] (1 = Monday) in the app's language. */
fun weekdayName(day: Int): String = DayOfWeek.of(day).getDisplayName(TextStyle.SHORT, Locale.getDefault())
