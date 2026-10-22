package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderRulesTest {
    private val warsaw = "Europe/Warsaw"
    private fun utc(isoMinute: String) = Instant.parse("$isoMinute:00Z").toEpochMilli()

    private fun task(id: String, date: String?, time: String?, block: Task.() -> Task = { this }) =
        Task(localId = id, title = "Task $id", dueDate = date, dueTime = time, createdAt = 0, updatedAt = 0).block()

    @Test
    fun `due time is read in the user's zone, not the phone's`() {
        // 13:15 on 22 Oct in Warsaw (CEST, UTC+2) is 11:15 UTC.
        assertEquals(utc("2026-10-22T11:15"), ReminderRules.dueAt(task("a", "2026-10-22", "13:15"), warsaw))
        assertEquals(utc("2026-10-22T12:15"), ReminderRules.dueAt(task("a", "2026-10-22", "13:15"), "Europe/London"))
        assertNull(ReminderRules.dueAt(task("a", "2026-10-22", null), warsaw))
    }

    @Test
    fun `a time skipped by the spring clock change moves forward by the gap`() {
        // 02:30 on 29 Mar 2026 does not exist in Warsaw (02:00 CET jumps to 03:00 CEST): it rings at 03:30.
        assertEquals(utc("2026-03-29T01:30"), ReminderRules.dueAt(task("a", "2026-03-29", "02:30"), warsaw))
    }

    @Test
    fun `every timed open task rings once per configured offset, earliest first`() {
        val tasks = listOf(
            task("a", "2026-10-22", "13:15"),
            task("b", "2026-10-22", "09:00"),
            task("untimed", "2026-10-22", null),
            task("nodate", null, null),
            task("done", "2026-10-22", "10:00") { copy(status = TaskStatus.DONE, completedAt = 1) },
            task("archived", "2026-10-22", "10:00") { copy(archivedAt = 1) },
        )
        val reminders = ReminderRules.reminders(tasks, listOf(0, 30), warsaw)
        assertEquals(
            listOf("b@30", "b@0", "a@30", "a@0"),
            reminders.map { "${it.taskLocalId}@${it.minutesBefore}" },
        )
        assertEquals(utc("2026-10-22T06:30"), reminders.first().at)
    }

    @Test
    fun `no offsets means no reminders`() {
        assertTrue(ReminderRules.reminders(listOf(task("a", "2026-10-22", "13:15")), emptyList(), warsaw).isEmpty())
    }

    @Test
    fun `a reminder whose moment had passed when the task was set does not ring`() {
        // Set at 11:10 UTC for 13:15 Warsaw (11:15 UTC): the 10-minute reminder (11:05) is already gone.
        val task = task("a", "2026-10-22", "13:15") { copy(updatedAt = utc("2026-10-22T11:10")) }
        assertEquals(listOf(0), ReminderRules.reminders(listOf(task), listOf(0, 10), warsaw).map { it.minutesBefore })
    }

    @Test
    fun `next alarm is the first reminder after what was handled and not too late`() {
        val reminders = ReminderRules.reminders(
            listOf(task("a", "2026-10-22", "09:00"), task("b", "2026-10-22", "13:15")),
            listOf(0),
            warsaw,
        )
        val nine = utc("2026-10-22T07:00")
        val quarterPastOne = utc("2026-10-22T11:15")
        // Nothing handled yet, 08:00 Warsaw: the 09:00 reminder.
        assertEquals(nine, ReminderRules.nextAlarm(reminders, now = utc("2026-10-22T06:00"), handledUntil = 0))
        // 09:00 was handled: the next one.
        assertEquals(quarterPastOne, ReminderRules.nextAlarm(reminders, now = nine, handledUntil = nine))
        // 09:05, not handled (alarm late): still 09:00, it rings at once.
        assertEquals(nine, ReminderRules.nextAlarm(reminders, now = nine + 5 * MINUTE, handledUntil = 0))
        // 09:20: 09:00 is too late to ring now.
        assertEquals(quarterPastOne, ReminderRules.nextAlarm(reminders, now = nine + 20 * MINUTE, handledUntil = 0))
        // Everything handled.
        assertNull(ReminderRules.nextAlarm(reminders, now = quarterPastOne, handledUntil = quarterPastOne))
    }

    @Test
    fun `due reminders are those since the last check, one per task, never overdue ones`() {
        val tasks = listOf(
            task("a", "2026-10-22", "09:00"),
            task("b", "2026-10-22", "09:05"),
            task("c", "2026-10-22", "13:15"),
            // 23:55 yesterday in Warsaw: overdue today, must not ring after midnight.
            task("late", "2026-10-21", "23:55"),
        )
        val reminders = ReminderRules.reminders(tasks, listOf(0, 5), warsaw)
        val now = utc("2026-10-22T07:06") // 09:06 Warsaw
        val due = ReminderRules.due(reminders, now = now, handledUntil = utc("2026-10-22T06:30"), timezone = warsaw)
        // a@5 (08:55) and a@0 (09:00) collapse into a@0; b@5 (09:00) and b@0 (09:05) into b@0.
        assertEquals(listOf("a@0", "b@0"), due.map { "${it.taskLocalId}@${it.minutesBefore}" })

        val afterMidnight = utc("2026-10-21T22:02") // 00:02 on 22 Oct in Warsaw
        assertTrue(ReminderRules.due(reminders, afterMidnight, handledUntil = 0, timezone = warsaw).isEmpty())
    }

    @Test
    fun `summary is the next occurrence of its time in the user's zone`() {
        // 04:59 Warsaw -> 05:00 the same day.
        assertEquals(utc("2026-10-22T03:00"), ReminderRules.nextSummaryAt(utc("2026-10-22T02:59"), "05:00", warsaw))
        // Exactly 05:00 -> tomorrow (strictly after now).
        assertEquals(utc("2026-10-23T03:00"), ReminderRules.nextSummaryAt(utc("2026-10-22T03:00"), "05:00", warsaw))
        // 05:30 CEST on 24 Oct -> 05:00 CET on 25 Oct, after the autumn clock change (UTC+1).
        assertEquals(utc("2026-10-25T04:00"), ReminderRules.nextSummaryAt(utc("2026-10-24T03:30"), "05:00", warsaw))
    }

    @Test
    fun `morning summary counts today and overdue and says where to start`() {
        val now = utc("2026-10-22T03:00")
        val tasks = listOf(
            task("t1", "2026-10-22", "09:00"),
            task("t2", "2026-10-22", null),
            task("o1", "2026-10-20", null),
            task("tomorrow", "2026-10-23", null),
        )
        assertEquals(MorningSummary(today = 2, overdue = 1, startWith = "Task o1"), morningSummary(tasks, now, warsaw))

        val withNow = tasks + task("n", "2026-10-22", null) { copy(isNow = true, status = TaskStatus.DOING) }
        assertEquals(MorningSummary(today = 3, overdue = 1, startWith = "Task n"), morningSummary(withNow, now, warsaw))

        assertEquals(MorningSummary(today = 0, overdue = 0, startWith = null), morningSummary(emptyList(), now, warsaw))
    }

    private companion object {
        const val MINUTE = 60_000L
    }
}
