package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * The agent work on a task as the phone shows it (backend 0.10.0, docs/agent-work.md): who has claimed it and
 * until when, how many acceptance criteria are met, the tasks it waits for and why it is blocked. All of it is
 * read-only on the phone except the claim, which the owner can end ("End the claim", `app:release`); the owner's own
 * changes always go through, whatever an agent has claimed.
 */
object AgentWork {
    /** A live claim: [name] of the key or connection working on the task, [until] as HH:MM in the user's zone. */
    data class Claim(val name: String, val until: String)

    /** Where a task in `dependsOn` stands; one in the trash or no longer on the phone does not hold the task back. */
    enum class DependencyState { OPEN, DONE, IN_TRASH, MISSING }

    /** One task this task waits for: its number and title ([ref] and [title] are null when it is [DependencyState.MISSING]). */
    data class Dependency(val ref: Long?, val title: String?, val state: DependencyState)

    /** Why a task on Today or the board cannot go on: its blocked [reason], and the [waitingOn] tasks not done yet. */
    data class Blocked(val reason: String?, val waitingOn: Int)

    private val CLOCK = DateTimeFormatter.ofPattern("HH:mm")

    /** The claim while it lasts; null when nobody holds the task, the claim has expired or the task is done. */
    fun activeClaim(task: Task, nowMs: Long, timezone: String?): Claim? {
        val name = task.claimName ?: return null
        val expiresAt = task.claimExpiresAt ?: return null
        if (expiresAt <= nowMs || task.status == TaskStatus.DONE) return null
        return Claim(name, CLOCK.format(Instant.ofEpochMilli(expiresAt).atZone(HelmDates.zone(timezone))))
    }

    /** Met criteria and all criteria, e.g. 1 of 3. */
    fun criteriaMet(task: Task): Pair<Int, Int> = task.acceptance.count { it.met } to task.acceptance.size

    /** The tasks [task] waits for, in the server's order, looked up among the phone's tasks by server id. */
    fun dependencies(task: Task, byServerId: Map<String, Task>): List<Dependency> = task.dependsOn.map { id ->
        val other = byServerId[id] ?: return@map Dependency(null, null, DependencyState.MISSING)
        val state = when {
            other.inTrash -> DependencyState.IN_TRASH
            other.status == TaskStatus.DONE -> DependencyState.DONE
            else -> DependencyState.OPEN
        }
        Dependency(other.ref, other.title, state)
    }

    /**
     * Why an open task is held back, as the plan health report counts it (`reasonsOf` in `backend/convex/lib/health.ts`):
     * a blocked reason, or a dependency that is not done (one in the trash or purged does not count). Null when nothing
     * holds it back or the task is done.
     */
    fun blocked(task: Task, byServerId: Map<String, Task>): Blocked? {
        if (task.status == TaskStatus.DONE) return null
        val waitingOn = dependencies(task, byServerId).count { it.state == DependencyState.OPEN }
        if (task.blockedReason == null && waitingOn == 0) return null
        return Blocked(task.blockedReason, waitingOn)
    }

    /** [blocked] for every task in [tasks] that is held back, by local id. */
    fun blockedTasks(tasks: List<Task>): Map<String, Blocked> {
        val byServerId = tasks.filter { it.serverId != null }.associateBy { it.serverId!! }
        return tasks.mapNotNull { task -> blocked(task, byServerId)?.let { task.localId to it } }.toMap()
    }
}
