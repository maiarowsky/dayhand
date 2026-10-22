package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as `backend/tests/dates.test.ts`, so phone and server agree on "today". */
class HelmDatesTest {
    private fun utc(isoMinute: String) = Instant.parse("$isoMinute:00Z").toEpochMilli()

    @Test
    fun `London midnight in summer time (BST, UTC+1)`() {
        assertEquals("2026-10-22", HelmDates.localDate(utc("2026-10-22T22:59"), "Europe/London"))
        assertEquals("2026-10-23", HelmDates.localDate(utc("2026-10-22T23:00"), "Europe/London"))
    }

    @Test
    fun `London midnight in winter time (GMT, UTC+0)`() {
        assertEquals("2026-12-01", HelmDates.localDate(utc("2026-12-01T23:59"), "Europe/London"))
        assertEquals("2026-12-02", HelmDates.localDate(utc("2026-12-02T00:00"), "Europe/London"))
    }

    @Test
    fun `Warsaw and New York`() {
        assertEquals("2026-10-22", HelmDates.localDate(utc("2026-10-22T21:59"), "Europe/Warsaw"))
        assertEquals("2026-10-23", HelmDates.localDate(utc("2026-10-22T22:00"), "Europe/Warsaw"))
        assertEquals("2026-10-22", HelmDates.localDate(utc("2026-10-23T03:00"), "America/New_York"))
    }

    @Test
    fun `last second before midnight and midnight itself`() {
        val midnight = utc("2026-10-22T22:00") // 00:00 on 23 Oct in Warsaw (CEST)
        assertEquals("2026-10-22", HelmDates.localDate(midnight - 1, "Europe/Warsaw"))
        assertEquals("2026-10-23", HelmDates.localDate(midnight, "Europe/Warsaw"))
    }

    @Test
    fun `day when clocks go back still has one midnight`() {
        // Warsaw leaves summer time on 25 Oct 2026 at 03:00 local; the next midnight is 23:00 UTC.
        assertEquals("2026-10-25", HelmDates.localDate(utc("2026-10-25T22:59"), "Europe/Warsaw"))
        assertEquals("2026-10-26", HelmDates.localDate(utc("2026-10-25T23:00"), "Europe/Warsaw"))
        assertEquals(utc("2026-10-25T23:00"), HelmDates.nextMidnight(utc("2026-10-25T12:00"), "Europe/Warsaw"))
    }

    @Test
    fun `unknown or missing zone falls back to the backend default`() {
        assertEquals("2026-10-23", HelmDates.localDate(utc("2026-10-22T23:00"), "Mars/Base"))
        assertEquals("2026-10-23", HelmDates.localDate(utc("2026-10-22T23:00"), null))
    }

    @Test
    fun `next midnight`() {
        assertEquals(utc("2026-10-22T23:00"), HelmDates.nextMidnight(utc("2026-10-22T10:00"), "Europe/London"))
        assertEquals(utc("2026-10-23T23:00"), HelmDates.nextMidnight(utc("2026-10-22T23:00"), "Europe/London"))
    }

    @Test
    fun `overdue rules match the backend`() {
        val base = Task(localId = "a", title = "t", dueDate = "2026-10-21", createdAt = 0, updatedAt = 0)
        assertTrue(HelmDates.isOverdue(base, "2026-10-22"))
        assertFalse(HelmDates.isOverdue(base, "2026-10-21"))
        assertFalse(HelmDates.isOverdue(base.copy(status = TaskStatus.DONE), "2026-10-22"))
        assertFalse(HelmDates.isOverdue(base.copy(archivedAt = 1), "2026-10-22"))
        assertFalse(HelmDates.isOverdue(base.copy(dueDate = null), "2026-10-22"))
        assertTrue(HelmDates.isOverdue(base.copy(status = TaskStatus.DOING), "2026-10-22"))
    }

    @Test
    fun `add days crosses month and year`() {
        assertEquals("2027-01-01", HelmDates.addDays("2026-12-31", 1))
        assertEquals("2026-02-28", HelmDates.addDays("2026-03-01", -1))
    }
}
