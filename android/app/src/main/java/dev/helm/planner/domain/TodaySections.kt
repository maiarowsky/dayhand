package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.LocalDate

/** The Today screen, top to bottom. The "now" task is shown once, in its own section. */
data class TodaySections(
    val date: String,
    val overdue: List<Task>,
    val now: Task?,
    val today: List<Task>,
    val done: List<Task>,
) {
    /** Nothing left to do today (done tasks alone still count as an empty plan). */
    val isEmpty: Boolean get() = overdue.isEmpty() && now == null && today.isEmpty()
}

/** Timed tasks first by time, then untimed by creation (backend `bySchedule`). */
internal val bySchedule = Comparator<Task> { a, b ->
    val dateOrder = (a.dueDate ?: "").compareTo(b.dueDate ?: "")
    when {
        dateOrder != 0 -> dateOrder
        a.dueTime != null && b.dueTime != null -> a.dueTime.compareTo(b.dueTime)
        a.dueTime != null -> -1
        b.dueTime != null -> 1
        else -> a.createdAt.compareTo(b.createdAt)
    }
}

/**
 * The Today screen [offset] days from today: today's own sections, or for another day the open tasks due on it and
 * the ones done on it. Overdue tasks and the "now" task belong to today only.
 */
fun daySections(tasks: List<Task>, nowMs: Long, timezone: String?, offset: Int): TodaySections {
    if (offset == 0) return todaySections(tasks, nowMs, timezone)
    val day = LocalDate.parse(HelmDates.localDate(nowMs, timezone)).plusDays(offset.toLong()).toString()
    val active = tasks.filter { it.isActive }
    return TodaySections(
        date = day,
        overdue = emptyList(),
        now = null,
        today = active.filter { it.status != TaskStatus.DONE && it.dueDate == day }.sortedWith(bySchedule),
        done = doneOn(active, day, timezone),
    )
}

private fun doneOn(active: List<Task>, day: String, timezone: String?) = active
    .filter { it.status == TaskStatus.DONE && it.completedAt != null }
    .filter { HelmDates.localDate(it.completedAt!!, timezone) == day }
    .sortedByDescending { it.completedAt }

/** Splits the local tasks into the Today sections for instant [nowMs] in [timezone]. */
fun todaySections(tasks: List<Task>, nowMs: Long, timezone: String?): TodaySections {
    val today = HelmDates.localDate(nowMs, timezone)
    val active = tasks.filter { it.isActive }
    val nowTask = active.firstOrNull { it.isNow && it.status != TaskStatus.DONE }
    val open = active.filter { it.status != TaskStatus.DONE && it.localId != nowTask?.localId }
    return TodaySections(
        date = today,
        overdue = open.filter { HelmDates.isOverdue(it, today) }.sortedWith(bySchedule),
        now = nowTask,
        today = open.filter { it.dueDate == today }.sortedWith(bySchedule),
        done = doneOn(active, today, timezone),
    )
}
