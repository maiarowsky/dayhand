package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TodaySectionsTest {
    private fun utc(isoMinute: String) = Instant.parse("$isoMinute:00Z").toEpochMilli()

    private var created = 0L
    private fun task(id: String, due: String?, time: String? = null, status: TaskStatus = TaskStatus.TODO, block: Task.() -> Task = { this }) =
        Task(localId = id, title = id, dueDate = due, dueTime = time, status = status, createdAt = ++created, updatedAt = 0).block()

    private val at = utc("2026-10-22T10:00")

    @Test
    fun `sections in order with backend sorting`() {
        val tasks = listOf(
            task("old", "2026-10-19"),
            task("yesterday-late", "2026-10-21", "18:00"),
            task("yesterday-untimed", "2026-10-21"),
            task("untimed", "2026-10-22"),
            task("at-13", "2026-10-22", "13:15"),
            task("at-09", "2026-10-22", "09:00"),
            task("tomorrow", "2026-10-23"),
            task("no-date", null),
        )
        val s = todaySections(tasks, at, "Europe/London")
        assertEquals("2026-10-22", s.date)
        assertEquals(listOf("old", "yesterday-late", "yesterday-untimed"), s.overdue.map { it.localId })
        assertEquals(listOf("at-09", "at-13", "untimed"), s.today.map { it.localId })
        assertNull(s.now)
        assertTrue(s.done.isEmpty())
        assertFalse(s.isEmpty)
    }

    @Test
    fun `the now task is shown once, in its own section, even when overdue`() {
        val tasks = listOf(
            task("now", "2026-10-20", status = TaskStatus.DOING) { copy(isNow = true, resumeNote = "page 3") },
            task("other", "2026-10-20"),
            task("today", "2026-10-22", status = TaskStatus.DOING),
        )
        val s = todaySections(tasks, at, "Europe/London")
        assertEquals("now", s.now?.localId)
        assertEquals(listOf("other"), s.overdue.map { it.localId })
        assertEquals(listOf("today"), s.today.map { it.localId })
    }

    @Test
    fun `done today only, newest first, archived and other days left out`() {
        val tasks = listOf(
            task("done-early", "2026-10-22", status = TaskStatus.DONE) { copy(completedAt = utc("2026-10-22T07:00")) },
            task("done-late", "2026-10-20", status = TaskStatus.DONE) { copy(completedAt = utc("2026-10-22T09:00")) },
            task("done-yesterday", "2026-10-21", status = TaskStatus.DONE) { copy(completedAt = utc("2026-10-21T12:00")) },
            task("archived", "2026-10-20") { copy(archivedAt = 1) },
            task("archived-today", "2026-10-22") { copy(archivedAt = 1) },
        )
        val s = todaySections(tasks, at, "Europe/London")
        assertEquals(listOf("done-late", "done-early"), s.done.map { it.localId })
        assertTrue(s.overdue.isEmpty())
        assertTrue(s.today.isEmpty())
        assertTrue("only done tasks counts as an empty plan", s.isEmpty)
    }

    @Test
    fun `midnight in the user's zone moves today's tasks to overdue`() {
        val tasks = listOf(task("a", "2026-10-22"))
        val before = todaySections(tasks, utc("2026-10-22T21:59"), "Europe/Warsaw")
        val after = todaySections(tasks, utc("2026-10-22T22:00"), "Europe/Warsaw")
        assertEquals(listOf("a"), before.today.map { it.localId })
        assertTrue(before.overdue.isEmpty())
        assertEquals("2026-10-23", after.date)
        assertEquals(listOf("a"), after.overdue.map { it.localId })
        assertTrue(after.today.isEmpty())
    }

    @Test
    fun `done is counted by the completion day in the user's zone`() {
        // 22:30 UTC on 21 Oct is 00:30 on 22 Oct in Warsaw, but 18:30 on 21 Oct in New York.
        val done = task("d", "2026-10-21", status = TaskStatus.DONE) { copy(completedAt = utc("2026-10-21T22:30")) }
        assertEquals(listOf("d"), todaySections(listOf(done), at, "Europe/Warsaw").done.map { it.localId })
        assertTrue(todaySections(listOf(done), at, "America/New_York").done.isEmpty())
    }

    @Test
    fun `empty plan`() {
        val s = todaySections(emptyList(), at, "Europe/London")
        assertTrue(s.isEmpty)
    }

    @Test
    fun `tasks in the trash are neither overdue, now, today nor done`() {
        val trashed = listOf(
            task("late", "2026-10-20") { copy(deletedAt = 1) },
            task("now", "2026-10-22", status = TaskStatus.DOING) { copy(isNow = true, deletedAt = 1) },
            task("today", "2026-10-22") { copy(deletedAt = 1) },
            task("done", "2026-10-22", status = TaskStatus.DONE) { copy(completedAt = at, deletedAt = 1) },
        )
        val s = todaySections(trashed, at, "Europe/London")
        assertTrue(s.isEmpty)
        assertTrue(s.done.isEmpty())
        assertFalse(HelmDates.isOverdue(trashed.first(), "2026-10-22"))
    }

    @Test
    fun `another day shows its open tasks and what was done on it, never overdue or now`() {
        val tasks = listOf(
            task("overdue", "2026-10-19"),
            task("now", "2026-10-23") { copy(isNow = true) },
            task("tomorrow-late", "2026-10-23", "18:00"),
            task("tomorrow-early", "2026-10-23", "08:00"),
            task("today", "2026-10-22"),
            task("done-yesterday", "2026-10-21", status = TaskStatus.DONE) { copy(completedAt = utc("2026-10-21T15:00")) },
        )
        val tomorrow = daySections(tasks, at, "Europe/London", 1)
        assertEquals("2026-10-23", tomorrow.date)
        assertTrue(tomorrow.overdue.isEmpty())
        assertNull(tomorrow.now)
        assertEquals(listOf("tomorrow-early", "tomorrow-late", "now"), tomorrow.today.map { it.localId })
        val yesterday = daySections(tasks, at, "Europe/London", -1)
        assertEquals("2026-10-21", yesterday.date)
        assertTrue(yesterday.today.isEmpty())
        assertEquals(listOf("done-yesterday"), yesterday.done.map { it.localId })
        assertTrue(yesterday.isEmpty)
        assertEquals(todaySections(tasks, at, "Europe/London"), daySections(tasks, at, "Europe/London", 0))
    }
}
