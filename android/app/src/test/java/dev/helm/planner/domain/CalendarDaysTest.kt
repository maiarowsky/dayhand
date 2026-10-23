package dev.helm.planner.domain

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarDaysTest {
    private var created = 0L
    private fun task(id: String, due: String?, time: String? = null, status: TaskStatus = TaskStatus.TODO, block: Task.() -> Task = { this }) =
        Task(localId = id, title = id, dueDate = due, dueTime = time, status = status, createdAt = ++created, updatedAt = 0).block()

    private val today = "2026-10-22" // a Thursday
    private val monday = LocalDate.parse("2026-10-19")

    private fun week(tasks: List<Task>) = CalendarDays.days(tasks, monday, 7, today)

    @Test
    fun `weeks start on Monday`() {
        assertEquals(monday, CalendarDays.weekStart(LocalDate.parse("2026-10-22")))
        assertEquals(monday, CalendarDays.weekStart(monday))
        assertEquals(monday, CalendarDays.weekStart(LocalDate.parse("2026-10-25")))
    }

    @Test
    fun `seven days with today marked, timed and untimed tasks apart, sorted like Today`() {
        val days = week(
            listOf(
                task("late", "2026-10-22", "18:00"),
                task("early", "2026-10-22", "09:00"),
                task("all-day", "2026-10-22"),
                task("done-all-day", "2026-10-22", status = TaskStatus.DONE),
                task("tuesday", "2026-10-20"),
                task("next-week", "2026-10-26"),
                task("no-date", null),
                task("archived", "2026-10-22") { copy(archivedAt = 1) },
                task("trashed", "2026-10-22") { copy(deletedAt = 1) },
            ),
        )
        assertEquals((19..25).map { "2026-10-$it" }, days.map { it.date })
        assertEquals(listOf(false, false, false, true, false, false, false), days.map { it.isToday })
        val thursday = days[3]
        assertEquals(listOf("early", "late"), thursday.timed.map { it.task.localId })
        assertEquals(listOf("all-day", "done-all-day"), thursday.untimed.map { it.task.localId })
        assertTrue(thursday.untimed.last().done)
        assertEquals(listOf("tuesday"), days[1].untimed.map { it.task.localId })
    }

    @Test
    fun `overdue tasks are marked on their day and listed at the top of today`() {
        val tasks = listOf(task("monday", "2026-10-19"), task("done-monday", "2026-10-19", status = TaskStatus.DONE), task("last-week", "2026-10-12"))
        val days = week(tasks)
        assertTrue(days[0].untimed.first { it.task.localId == "monday" }.overdue)
        assertFalse(days[0].untimed.first { it.task.localId == "done-monday" }.overdue)
        assertEquals(listOf("last-week", "monday"), CalendarDays.overdueBefore(tasks, today, today).map { it.localId })
        assertTrue(CalendarDays.overdueBefore(tasks, "2026-10-23", today).isEmpty())
    }

    @Test
    fun `a repeating task shows on its later dates after today, and only its own date can be moved`() {
        val daily = task("daily", "2026-10-20", "07:30") { copy(repeat = RepeatRule(RepeatEvery.DAY)) }
        val days = week(listOf(daily))
        // Due Tuesday (overdue): Wednesday and Thursday would be skipped when it is done late, so the series goes on from Friday.
        assertEquals(listOf("2026-10-20", "2026-10-23", "2026-10-24", "2026-10-25"), days.flatMap { d -> d.timed.map { it.date } })
        val own = days[1].timed.single()
        assertFalse(own.repeat)
        assertTrue(own.movable)
        assertTrue(own.overdue)
        val later = days[4].timed.single()
        assertTrue(later.repeat)
        assertFalse(later.movable)
        assertEquals("07:30", later.time)
    }

    @Test
    fun `a series follows Recurrence, ends with count and starts before the week`() {
        val weekly = task("weekly", "2026-10-01") { copy(repeat = RepeatRule(RepeatEvery.WEEK, weekdays = listOf(2, 5), count = 8)) }
        // 1 Oct (Thu), 2, 6, 9, 13, 16, 20, 23 Oct: the 7th and 8th dates fall in this week, the 20th before today.
        val dates = week(listOf(weekly)).flatMap { d -> d.untimed.map { it.date to it.repeat } }
        assertEquals(listOf("2026-10-23" to true), dates)
        val done = task("done", "2026-10-23", status = TaskStatus.DONE) { copy(repeat = RepeatRule(RepeatEvery.DAY)) }
        assertEquals(listOf("2026-10-23"), week(listOf(done)).flatMap { d -> d.untimed.map { it.date } })
    }

    @Test
    fun `overlapping timed tasks share the width in lanes`() {
        val entries = listOf(
            task("a", today, "09:00"),
            task("b", today, "09:15"),
            task("c", today, "09:30"),
            task("d", today, "11:00"),
            task("e", today, "23:50"),
        ).map { CalendarEntry(it, today, it.dueTime, repeat = false, overdue = false, done = false) }
        val placed = CalendarDays.lanes(entries).associateBy { it.entry.task.localId }
        assertEquals(0 to 2, placed.getValue("a").let { it.lane to it.lanes })
        assertEquals(1 to 2, placed.getValue("b").let { it.lane to it.lanes })
        // c starts when a ends, so it takes a's lane back.
        assertEquals(0 to 2, placed.getValue("c").let { it.lane to it.lanes })
        assertEquals(0 to 1, placed.getValue("d").let { it.lane to it.lanes })
        assertEquals(23 * 60 + 50, placed.getValue("e").startMinute)
    }
}
