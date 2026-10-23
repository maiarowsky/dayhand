package dev.helm.planner.domain

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatFrom
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.WeekdayOfMonth
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

    @Test
    fun `month patterns, until and count follow validateRepeat`() {
        val month = RepeatRule(RepeatEvery.MONTH)
        assertTrue(TaskRules.isValid(month.copy(monthDay = -1, from = RepeatFrom.COMPLETION, until = "2027-01-01")))
        assertTrue(TaskRules.isValid(month.copy(weekdayOfMonth = WeekdayOfMonth(-1, 5), count = 12)))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.WEEK, monthDay = 3)))
        assertFalse(TaskRules.isValid(month.copy(monthDay = 0)))
        assertFalse(TaskRules.isValid(month.copy(monthDay = -2)))
        assertFalse(TaskRules.isValid(month.copy(monthDay = 32)))
        assertFalse(TaskRules.isValid(month.copy(monthDay = 1, weekdayOfMonth = WeekdayOfMonth(1, 1))))
        assertFalse(TaskRules.isValid(month.copy(weekdayOfMonth = WeekdayOfMonth(0, 1))))
        assertFalse(TaskRules.isValid(month.copy(weekdayOfMonth = WeekdayOfMonth(6, 1))))
        assertFalse(TaskRules.isValid(month.copy(weekdayOfMonth = WeekdayOfMonth(1, 8))))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, until = "2026-12-31", count = 3)))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, until = "2026-02-30")))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, count = 0)))
        assertFalse(TaskRules.isValid(RepeatRule(RepeatEvery.DAY, count = 1001)))
    }

    @Test
    fun `checklist items are trimmed, empty ones dropped, ids unique and at most 100`() {
        assertEquals(listOf(ChecklistItem("a", "Milk")), TaskRules.checklist(listOf(ChecklistItem("a", " Milk "), ChecklistItem("b", "  "))))
        assertNull(TaskRules.checklist(listOf(ChecklistItem("a", "x"), ChecklistItem("a", "y"))))
        assertNull(TaskRules.checklist(listOf(ChecklistItem("a", "x".repeat(501)))))
        assertNull(TaskRules.checklist((1..101).map { ChecklistItem("c$it", "Item $it") }))
        assertEquals(100, TaskRules.checklist((1..100).map { ChecklistItem("c$it", "Item $it") })!!.size)
    }

    @Test
    fun `reminders follow checkReminders`() {
        assertEquals(listOf(TaskReminder.before(15)), TaskRules.reminders(listOf(TaskReminder.before(15), TaskReminder.before(15))))
        assertEquals(emptyList<TaskReminder>(), TaskRules.reminders(emptyList()))
        assertNull(TaskRules.reminders((1..6).map(TaskReminder::before)))
        assertTrue(TaskRules.isValid(TaskReminder.before(0)))
        assertTrue(TaskRules.isValid(TaskReminder.before(7 * 24 * 60)))
        assertFalse(TaskRules.isValid(TaskReminder.before(7 * 24 * 60 + 1)))
        assertFalse(TaskRules.isValid(TaskReminder.before(-1)))
        assertTrue(TaskRules.isValid(TaskReminder.at("18:00", 1)))
        assertTrue(TaskRules.isValid(TaskReminder.at("09:00", 30)))
        assertFalse(TaskRules.isValid(TaskReminder.at("09:00", 31)))
        assertFalse(TaskRules.isValid(TaskReminder.at("24:00")))
        assertFalse(TaskRules.isValid(TaskReminder.at("9:00")))
        assertFalse(TaskRules.isValid(TaskReminder(minutesBefore = 5, time = "09:00")))
        assertFalse(TaskRules.isValid(TaskReminder()))
    }
}
