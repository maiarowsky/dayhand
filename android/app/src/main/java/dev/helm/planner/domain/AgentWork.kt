package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * The agent work on a task as the phone shows it (backend 0.10.0, docs/agent-work.md): who has claimed it and
 * until when, and how many acceptance criteria are met. Everything here is read-only on the phone; the owner's own
 * changes always go through, whatever an agent has claimed.
 */
object AgentWork {
    /** A live claim: [name] of the key or connection working on the task, [until] as HH:MM in the user's zone. */
    data class Claim(val name: String, val until: String)

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
}
