package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus

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
private val bySchedule = Comparator<Task> { a, b ->
    val dateOrder = (a.dueDate ?: "").compareTo(b.dueDate ?: "")
    when {
        dateOrder != 0 -> dateOrder
        a.dueTime != null && b.dueTime != null -> a.dueTime.compareTo(b.dueTime)
        a.dueTime != null -> -1
        b.dueTime != null -> 1
        else -> a.createdAt.compareTo(b.createdAt)
    }
}

/** Splits the local tasks into the Today sections for instant [nowMs] in [timezone]. */
fun todaySections(tasks: List<Task>, nowMs: Long, timezone: String?): TodaySections {
    val today = HelmDates.localDate(nowMs, timezone)
    val active = tasks.filter { it.archivedAt == null }
    val nowTask = active.firstOrNull { it.isNow && it.status != TaskStatus.DONE }
    val open = active.filter { it.status != TaskStatus.DONE && it.localId != nowTask?.localId }
    return TodaySections(
        date = today,
        overdue = open.filter { HelmDates.isOverdue(it, today) }.sortedWith(bySchedule),
        now = nowTask,
        today = open.filter { it.dueDate == today }.sortedWith(bySchedule),
        done = active
            .filter { it.status == TaskStatus.DONE && it.completedAt != null }
            .filter { HelmDates.localDate(it.completedAt!!, timezone) == today }
            .sortedByDescending { it.completedAt },
    )
}
