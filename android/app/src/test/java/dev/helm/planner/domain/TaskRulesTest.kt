package dev.helm.planner.domain

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same limits as `backend/convex/lib/core.ts` and `repeat.ts`. */
class TaskRulesTest {
    @Test
    fun `titles are trimmed and must be 1 to 500 characters`() {
        assertEquals("Call", TaskRules.title("  Call "))
        assertNull(TaskRules.title("   "))
        assertEquals(500, TaskRules.title("x".repeat(500))!!.length)
        assertNull(TaskRules.title("x".repeat(501)))
    }

    @Test
    fun `labels are trimmed, deduplicated and limited like on the server`() {
        assertEquals(listOf("home", "work"), TaskRules.labels(listOf(" home", "work", "home ", " ")))
        assertNull(TaskRules.labels(listOf("x".repeat(51))))
        assertNull(TaskRules.labels((1..21).map { "l$it" }))
        assertEquals(20, TaskRules.labels((1..20).map { "l$it" })!!.size)
    }

    @Test
    fun `links must be absolute http or https addresses`() {
        assertTrue(TaskRules.isLinkUrl("https://example.com/a?b=1"))
        assertTrue(TaskRules.isLinkUrl("http://10.0.2.2:3210"))
        assertFalse(TaskRules.isLinkUrl("example.com"))
        assertFalse(TaskRules.isLinkUrl("ftp://example.com"))
        assertFalse(TaskRules.isLinkUrl("javascript:alert(1)"))
        assertFalse(TaskRules.isLinkUrl("https://"))
        assertFalse(TaskRules.isLinkUrl("https://example.com/" + "a".repeat(2_048)))
        assertEquals(TaskLink("https://a.pl", "Docs"), TaskRules.link(" https://a.pl ", " Docs "))
        assertEquals(TaskLink("https://a.pl"), TaskRules.link("https://a.pl", "  "))
        assertNull(TaskRules.link("a.pl", "Docs"))
    }

    @Test
    fun `repeat rules follow validateRepeat`() {
        assertTrue(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, 1)))
        assertTrue(TaskRules.isValid(RepeatRule(RepeatEvery.WEEK, 2, listOf(1, 3))))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, 0)))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.YEAR, 367)))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.MONTH, 1, listOf(1))))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.WEEK, 1, emptyList())))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 1))))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.WEEK, 1, listOf(8))))
    }
}
