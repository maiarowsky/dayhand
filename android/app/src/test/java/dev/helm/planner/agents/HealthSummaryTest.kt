package dev.helm.planner.agents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthSummaryTest {
    private val quiet = PlanHealth(
        agentsPaused = false, overdue = 0, dueToday = 0, inProgress = 0, expiredClaims = 0, blocked = 0,
        awaitingApproval = 0, pendingApprovals = 0, proposals = 0, completedToday = 0, withoutProof = 0, oldestOpenDays = null,
    )

    @Test
    fun `a quiet plan says nothing and asks for nothing`() {
        val items = HealthSummary.items(quiet.copy(oldestOpenDays = HealthSummary.OLD_DAYS - 1))
        assertEquals(emptyList<HealthItem>(), items)
        assertEquals(HealthTone.CALM, HealthSummary.tone(items))
        assertFalse(HealthSummary.needsOwner(items))
    }

    @Test
    fun `only what is there, the most pressing first`() {
        val items = HealthSummary.items(quiet.copy(dueToday = 2, pendingApprovals = 1, overdue = 3, oldestOpenDays = 30, completedToday = 1))
        assertEquals(
            listOf(
                HealthItem(HealthKind.OVERDUE, 3),
                HealthItem(HealthKind.APPROVALS, 1),
                HealthItem(HealthKind.DUE_TODAY, 2),
                HealthItem(HealthKind.DONE_TODAY, 1),
                HealthItem(HealthKind.OLDEST_OPEN, 30),
            ),
            items,
        )
        assertEquals(HealthTone.ACT, HealthSummary.tone(items))
        assertTrue(HealthSummary.needsOwner(items))
    }

    @Test
    fun `the tone follows what needs the owner`() {
        assertEquals(HealthTone.ACT, HealthSummary.tone(HealthSummary.items(quiet.copy(agentsPaused = true))))
        assertEquals(HealthTone.LOOK, HealthSummary.tone(HealthSummary.items(quiet.copy(withoutProof = 1, dueToday = 1))))
        assertEquals(HealthTone.CALM, HealthSummary.tone(HealthSummary.items(quiet.copy(inProgress = 2))))
        assertFalse(HealthSummary.needsOwner(HealthSummary.items(quiet.copy(blocked = 1))))
        assertTrue(HealthSummary.needsOwner(HealthSummary.items(quiet.copy(proposals = 1))))
    }

    @Test
    fun `each pending request is shown once, and only while it waits`() {
        fun request(id: String, status: ApprovalStatus = ApprovalStatus.PENDING) = ApprovalRequest(
            id, null, null, "Do $id", null, listOf(ApprovalOption("o1", "Yes", null)), true, status, 0, 0, "claude", null, null,
        )
        val first = ApprovalAlerts.check(listOf(request("a"), request("b")), seen = emptySet())
        assertEquals(listOf("a", "b"), first.notify.map { it.id })
        val second = ApprovalAlerts.check(listOf(request("b"), request("c"), request("d", ApprovalStatus.DECIDED)), first.seen)
        assertEquals(listOf("c"), second.notify.map { it.id })
        // "a" was decided: it is forgotten, so the remembered set does not grow.
        assertEquals(setOf("b", "c"), second.seen)
    }
}
