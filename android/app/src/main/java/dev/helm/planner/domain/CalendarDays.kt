package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters

/**
 * One task on one day of the calendar. [repeat] marks a later date of a repeating series: not a task of its own yet,
 * so tapping it opens the series and it cannot be moved. [overdue] and [done] are the task's state on that day.
 */
data class CalendarEntry(
    val task: Task,
    val date: String,
    val time: String?,
    val repeat: Boolean,
    val overdue: Boolean,
    val done: Boolean,
) {
    /** Only the task itself, on its own date and not done, can be moved to another day or time. */
    val movable: Boolean get() = !repeat && !done
    val key: String get() = "${task.localId}@$date"
}

/** A day of the calendar: its tasks without a time (in the band at the top) and with a time (on the hours). */
data class CalendarDay(val date: String, val isToday: Boolean, val untimed: List<CalendarEntry>, val timed: List<CalendarEntry>) {
    val hasTasks: Boolean get() = untimed.isNotEmpty() || timed.isNotEmpty()
}

/** A timed entry on the hour grid: [startMinute] of the day, in [lane] of [lanes] side by side. */
data class PlacedEntry(val entry: CalendarEntry, val startMinute: Int, val lane: Int, val lanes: Int)

/**
 * The week and day views, from the tasks in Room: the same rules as Today (`HelmDates`, `bySchedule`), repeating
 * tasks spread over their later dates by [Recurrence] (the backend's `lib/repeat.ts`), and the layout of tasks that
 * share an hour. A task with a time takes [EVENT_MINUTES] on the grid, as in the calendar feed (`lib/ical.ts`).
 */
object CalendarDays {
    const val EVENT_MINUTES = 30
    private const val MINUTES_PER_DAY = 24 * 60
    private const val MAX_REPEATS_PER_TASK = 62

    /** The Monday of [date]'s week (weeks start on Monday, as Dayhand's repeat rules do). */
    fun weekStart(date: LocalDate): LocalDate = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    /**
     * [count] days from [from]. Active tasks (not archived, not in the trash) with a day appear on it; done ones stay
     * there, marked done. An open repeating task also appears on the later dates of its series that are after today
     * and after its own date: completing it late skips the dates it missed, so earlier ones would never happen.
     */
    fun days(tasks: List<Task>, from: LocalDate, count: Int, today: String): List<CalendarDay> {
        val to = from.plusDays(count - 1L).toString()
        val start = from.toString()
        val byDate = entries(tasks, start, to, today).groupBy { it.date }
        return (0 until count).map { offset ->
            val date = from.plusDays(offset.toLong()).toString()
            val dayEntries = byDate[date].orEmpty().sortedWith(compareBy<CalendarEntry> { it.done }.thenBy { it.time ?: "" }.thenBy { it.task.createdAt })
            CalendarDay(
                date = date,
                isToday = date == today,
                untimed = dayEntries.filter { it.time == null },
                timed = dayEntries.filter { it.time != null }.sortedWith(compareBy({ it.time }, { it.task.createdAt })),
            )
        }
    }

    /** Open tasks due before today, for the top of today's day view (as on Today). */
    fun overdueBefore(tasks: List<Task>, day: String, today: String): List<Task> =
        if (day != today) emptyList() else tasks.filter { it.isActive && HelmDates.isOverdue(it, today) }.sortedWith(bySchedule)

    private fun entries(tasks: List<Task>, from: String, to: String, today: String): List<CalendarEntry> =
        tasks.filter { it.isActive && it.dueDate != null }.flatMap { task ->
            val due = task.dueDate!!
            val done = task.status == TaskStatus.DONE
            val own = if (due in from..to) {
                listOf(CalendarEntry(task, due, task.dueTime, repeat = false, overdue = HelmDates.isOverdue(task, today), done = done))
            } else {
                emptyList()
            }
            own + repeats(task, from, to, today)
        }

    private fun repeats(task: Task, from: String, to: String, today: String): List<CalendarEntry> {
        val rule = task.repeat ?: return emptyList()
        if (task.status == TaskStatus.DONE) return emptyList()
        val due = task.dueDate!!
        val after = maxOf(due, today)
        val first = maxOf(from, HelmDates.addDays(after, 1))
        if (first > to) return emptyList()
        return Recurrence.occurrences(rule, due, first, to, MAX_REPEATS_PER_TASK).map { date ->
            CalendarEntry(task, date, task.dueTime, repeat = true, overdue = false, done = false)
        }
    }

    /** Minute of the day of HH:MM. */
    fun minuteOf(time: String): Int = LocalTime.parse(time).let { it.hour * 60 + it.minute }

    /**
     * Places timed entries of one day: each takes [EVENT_MINUTES] from its time (to the end of the day at most);
     * entries that overlap share the width in lanes, each group of overlapping entries as many lanes as it needs.
     */
    fun lanes(timed: List<CalendarEntry>): List<PlacedEntry> {
        val sorted = timed.filter { it.time != null }.sortedWith(compareBy({ minuteOf(it.time!!) }, { it.task.createdAt }))
        val placed = mutableListOf<PlacedEntry>()
        var group = mutableListOf<Pair<CalendarEntry, Int>>()
        var laneEnds = mutableListOf<Int>()
        var groupEnd = -1
        fun closeGroup() {
            placed += group.map { (entry, lane) -> PlacedEntry(entry, minuteOf(entry.time!!), lane, laneEnds.size) }
            group = mutableListOf()
            laneEnds = mutableListOf()
        }
        for (entry in sorted) {
            val start = minuteOf(entry.time!!)
            val end = minOf(start + EVENT_MINUTES, MINUTES_PER_DAY)
            if (start >= groupEnd) closeGroup()
            val lane = laneEnds.indexOfFirst { it <= start }.takeIf { it >= 0 } ?: laneEnds.size.also { laneEnds += 0 }
            laneEnds[lane] = end
            group += entry to lane
            groupEnd = maxOf(groupEnd, end)
        }
        closeGroup()
        return placed
    }
}
