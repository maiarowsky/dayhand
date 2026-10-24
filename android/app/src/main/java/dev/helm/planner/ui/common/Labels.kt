package dev.helm.planner.ui.common

import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.notify.AndroidNotifier
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** The app's language; unlike `Locale.getDefault()` it recomposes when the language changes. */
@Composable
fun appLocale(): Locale = LocalConfiguration.current.locales[0]

/**
 * A formatter for the fields of [skeleton] ("EEEdMMM", "yMMMMEEEEd", ...) in the order and punctuation [locale] writes
 * them: "Mon, Oct 19", "Mo., 19. Okt.", "10月19日(月)".
 */
fun dateFormat(skeleton: String, locale: Locale): DateTimeFormatter =
    DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

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
    else -> date.format(dateFormat(if (date.year == today.year) "EEEdMMM" else "yMMMEEEd", appLocale()))
}

/** The due day and time of a task, e.g. "tomorrow, 09:00", or null without a due day. */
@Composable
fun dueLabel(task: Task, today: LocalDate): String? {
    val day = task.dueDate?.let { dayLabel(LocalDate.parse(it), today) } ?: return null
    return task.dueTime?.let { stringResource(R.string.day_and_time, day, it) } ?: day
}

/** "Every day", "Every 2 weeks: Mon, Thu", "Every month: last day, until 30 Jun 2027", ... */
@Composable
fun repeatLabel(rule: RepeatRule): String {
    val plural = when (rule.every) {
        RepeatEvery.DAY -> R.plurals.repeat_days
        RepeatEvery.WEEK -> R.plurals.repeat_weeks
        RepeatEvery.MONTH -> R.plurals.repeat_months
        RepeatEvery.YEAR -> R.plurals.repeat_years
    }
    val every = pluralStringResource(plural, rule.interval, rule.interval)
    val locale = appLocale()
    val details = listOfNotNull(
        rule.weekdays?.sorted()?.joinToString(", ") { weekdayName(it, locale) },
        if (rule.every == RepeatEvery.MONTH) monthPatternLabel(rule, long = false) else null,
        if (rule.fromCompletion) stringResource(R.string.repeat_label_from_completion) else null,
        rule.until?.let { stringResource(R.string.repeat_label_until, LocalDate.parse(it).format(dateFormat("yMMMd", locale))) },
        rule.count?.let { pluralStringResource(R.plurals.repeat_label_count, it, it) },
    )
    return if (details.isEmpty()) every else stringResource(R.string.repeat_on_days, every, details.joinToString(", "))
}

/**
 * The day a monthly rule picks: "the last day", "the 2nd Tuesday", "day 31" ([long], for the editor's choices), or
 * "last day", "2nd Tue" for a summary; null for a plain monthly rule (the due date's day).
 */
@Composable
fun monthPatternLabel(rule: RepeatRule, long: Boolean): String? {
    val locale = appLocale()
    rule.monthDay?.let { day ->
        return when {
            day == -1 -> stringResource(if (long) R.string.repeat_month_last_day else R.string.repeat_label_last_day)
            else -> stringResource(if (long) R.string.repeat_month_same_day else R.string.repeat_month_day, day)
        }
    }
    val (nth, weekday) = rule.weekdayOfMonth ?: return null
    val name = DayOfWeek.of(weekday).getDisplayName(if (long) TextStyle.FULL else TextStyle.SHORT, locale)
    return when {
        nth == -1 -> stringArrayResource(if (long) R.array.repeat_last_weekday else R.array.repeat_last_weekday_short)[weekday - 1]
        nth > 0 -> stringResource(if (long) R.string.repeat_month_nth else R.string.repeat_label_nth, stringArrayResource(R.array.repeat_ordinals)[nth - 1], name)
        else -> stringResource(R.string.repeat_month_nth_from_end, -nth, name)
    }
}

/** "15 min before", "At the due time", "09:00 on the due day", "18:00, the day before". */
@Composable
fun reminderLabel(reminder: TaskReminder): String {
    val resources = LocalResources.current
    reminder.minutesBefore?.let { minutes ->
        return if (minutes == 0) {
            stringResource(R.string.reminder_at_due)
        } else {
            stringResource(R.string.reminder_before, AndroidNotifier.durationLabel(resources, minutes))
        }
    }
    val time = reminder.time.orEmpty()
    val days = reminder.daysBefore ?: 0
    return if (days == 0) stringResource(R.string.reminder_time_on_day, time) else pluralStringResource(R.plurals.reminder_time_before, days, days, time)
}

/** Short name of ISO weekday [day] (1 = Monday) in [locale], the app's language. */
fun weekdayName(day: Int, locale: Locale): String = DayOfWeek.of(day).getDisplayName(TextStyle.SHORT, locale)
