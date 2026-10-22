package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus

/**
 * The board: to do / in progress / done. The "now" task is the highlighted one in progress,
 * shown first in its column. Done holds the most recently completed tasks, as the backend's
 * `board` view does.
 */
data class BoardColumns(
    val date: String,
    val todo: List<Task>,
    val doing: List<Task>,
    val done: List<Task>,
) {
    val now: Task? get() = doing.firstOrNull()?.takeIf { it.isNow }

    fun column(status: TaskStatus): List<Task> = when (status) {
        TaskStatus.TODO -> todo
        TaskStatus.DOING -> doing
        TaskStatus.DONE -> done
    }
}

/** Splits the active local tasks into the board's columns for instant [nowMs] in [timezone]. */
fun boardColumns(tasks: List<Task>, nowMs: Long, timezone: String?, doneLimit: Int = DONE_LIMIT): BoardColumns {
    val active = tasks.filter { it.isActive }
    return BoardColumns(
        date = HelmDates.localDate(nowMs, timezone),
        todo = active.filter { it.status == TaskStatus.TODO }.sortedWith(bySchedule),
        doing = active.filter { it.status == TaskStatus.DOING }.sortedWith(compareByDescending<Task> { it.isNow }.then(bySchedule)),
        done = active
            .filter { it.status == TaskStatus.DONE }
            .sortedByDescending { it.completedAt ?: it.updatedAt }
            .take(doneLimit),
    )
}

/** The backend's `board` default (`DEFAULT_DONE_LIMIT`). */
const val DONE_LIMIT = 50
