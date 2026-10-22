package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** One ring: a timed task, [minutesBefore] minutes before its due time, at instant [at] (Unix ms). */
data class Reminder(
    val taskLocalId: String,
    val title: String,
    val dueDate: String,
    val dueTime: String,
    val minutesBefore: Int,
    val at: Long,
)

/** The morning notification: how much is on today, how much is overdue and where to start. */
data class MorningSummary(val today: Int, val overdue: Int, val startWith: String?)

/**
 * When the phone rings. Everything is computed on the phone from Room, in the user's time zone
 * from the server settings (the same zone that decides "today"), so no server is needed.
 *
 * Only open, timed tasks ring. Overdue tasks never ring: they wait at the top of Today.
 */
object ReminderRules {
    /** Backend defaults (`DEFAULT_SETTINGS` in `backend/convex/lib/core.ts`). */
    const val DEFAULT_SUMMARY_TIME = "05:00"
    val DEFAULT_REMINDER_MINUTES = listOf(0)

    /**
     * A reminder that fires later than this (Doze, a phone that was off) is dropped instead of
     * ringing late. Doze lets an app's allow-while-idle alarms through about once every 9 minutes.
     */
    const val LATE_LIMIT_MS = 15 * 60_000L

    private const val MINUTE_MS = 60_000L

    /** The due instant of a timed task; a time skipped by a clock change moves forward by the gap. */
    fun dueAt(task: Task, timezone: String?): Long? {
        val date = task.dueDate ?: return null
        val time = task.dueTime ?: return null
        return try {
            LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(HelmDates.zone(timezone)).toInstant().toEpochMilli()
        } catch (_: DateTimeException) {
            null
        }
    }

    /**
     * Every reminder of the open timed tasks, earliest first. A reminder whose moment had already
     * passed when the task was last changed is left out: setting a task for 13:15 at 13:10 does
     * not ring the 30-minute reminder.
     */
    fun reminders(tasks: List<Task>, minutesBefore: List<Int>, timezone: String?): List<Reminder> =
        tasks
            .filter { it.status != TaskStatus.DONE && it.archivedAt == null }
            .flatMap { task ->
                val due = dueAt(task, timezone) ?: return@flatMap emptyList()
                minutesBefore.distinct().map { minutes ->
                    Reminder(task.localId, task.title, task.dueDate!!, task.dueTime!!, minutes, due - minutes * MINUTE_MS)
                }.filter { it.at > task.updatedAt }
            }
            .sortedWith(compareBy({ it.at }, { it.taskLocalId }))

    /** When the reminder alarm should fire next: the first reminder not handled yet and not too late. */
    fun nextAlarm(reminders: List<Reminder>, now: Long, handledUntil: Long): Long? {
        val after = maxOf(handledUntil, now - LATE_LIMIT_MS)
        return reminders.firstOrNull { it.at > after }?.at
    }

    /**
     * What to show when the alarm fires at [now]: reminders since the last check that are not too
     * late and whose task is not overdue, the latest one per task.
     */
    fun due(reminders: List<Reminder>, now: Long, handledUntil: Long, timezone: String?): List<Reminder> {
        val today = HelmDates.localDate(now, timezone)
        return reminders
            .filter { it.at > handledUntil && it.at <= now && now - it.at <= LATE_LIMIT_MS && it.dueDate >= today }
            .groupBy { it.taskLocalId }
            .map { (_, forTask) -> forTask.maxBy { it.at } }
            .sortedBy { it.at }
    }

    /** The next moment strictly after [now] when the clock in [timezone] shows [summaryTime]. */
    fun nextSummaryAt(now: Long, summaryTime: String, timezone: String?): Long {
        val zone = HelmDates.zone(timezone)
        val time = try {
            LocalTime.parse(summaryTime)
        } catch (_: DateTimeException) {
            LocalTime.parse(DEFAULT_SUMMARY_TIME)
        }
        var day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        while (true) {
            val at = day.atTime(time).atZone(zone).toInstant().toEpochMilli()
            if (at > now) return at
            day = day.plusDays(1)
        }
    }
}

/** The morning summary from the same sections as the Today screen; the "now" task counts as today's. */
fun morningSummary(tasks: List<Task>, nowMs: Long, timezone: String?): MorningSummary {
    val sections = todaySections(tasks, nowMs, timezone)
    val start = sections.now ?: sections.overdue.firstOrNull() ?: sections.today.firstOrNull()
    return MorningSummary(
        today = sections.today.size + (if (sections.now != null) 1 else 0),
        overdue = sections.overdue.size,
        startWith = start?.title,
    )
}
