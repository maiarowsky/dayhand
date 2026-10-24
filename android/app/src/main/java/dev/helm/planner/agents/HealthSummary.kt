package dev.helm.planner.agents

/** One fact of the plan health card, by how much it asks for a look. */
enum class HealthKind { PAUSED, OVERDUE, EXPIRED_CLAIMS, APPROVALS, BLOCKED, PROPOSALS, WITHOUT_PROOF, DUE_TODAY, IN_PROGRESS, DONE_TODAY, OLDEST_OPEN }

data class HealthItem(val kind: HealthKind, val count: Int)

enum class HealthTone { CALM, LOOK, ACT }

/** The plan health report as the card above Today says it: only what is there, the most pressing first. */
object HealthSummary {
    /** An open task this old is worth a word on the card. */
    const val OLD_DAYS = 14

    fun items(health: PlanHealth): List<HealthItem> = buildList {
        if (health.agentsPaused) add(HealthItem(HealthKind.PAUSED, 1))
        add(HealthItem(HealthKind.OVERDUE, health.overdue))
        add(HealthItem(HealthKind.EXPIRED_CLAIMS, health.expiredClaims))
        add(HealthItem(HealthKind.APPROVALS, health.pendingApprovals))
        add(HealthItem(HealthKind.BLOCKED, health.blocked))
        add(HealthItem(HealthKind.PROPOSALS, health.proposals))
        add(HealthItem(HealthKind.WITHOUT_PROOF, health.withoutProof))
        add(HealthItem(HealthKind.DUE_TODAY, health.dueToday))
        add(HealthItem(HealthKind.IN_PROGRESS, health.inProgress))
        add(HealthItem(HealthKind.DONE_TODAY, health.completedToday))
        health.oldestOpenDays?.takeIf { it >= OLD_DAYS }?.let { add(HealthItem(HealthKind.OLDEST_OPEN, it)) }
    }.filter { it.count > 0 }

    /** Red when agents are paused or something is late, amber when the owner is asked for something. */
    fun tone(items: List<HealthItem>): HealthTone {
        val kinds = items.map { it.kind }.toSet()
        return when {
            kinds.any { it in setOf(HealthKind.PAUSED, HealthKind.OVERDUE, HealthKind.EXPIRED_CLAIMS) } -> HealthTone.ACT
            kinds.any { it in setOf(HealthKind.APPROVALS, HealthKind.BLOCKED, HealthKind.PROPOSALS, HealthKind.WITHOUT_PROOF) } -> HealthTone.LOOK
            else -> HealthTone.CALM
        }
    }

    /** Whether the card leads to Agents, where the owner decides requests and proposals. */
    fun needsOwner(items: List<HealthItem>): Boolean = items.any { it.kind in setOf(HealthKind.PAUSED, HealthKind.APPROVALS, HealthKind.PROPOSALS) }
}
