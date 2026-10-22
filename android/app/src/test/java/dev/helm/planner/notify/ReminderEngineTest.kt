package dev.helm.planner.notify

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.MorningSummary
import dev.helm.planner.domain.Reminder
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderEngineTest {
    private fun utc(isoMinute: String) = Instant.parse("$isoMinute:00Z").toEpochMilli()

    private fun task(id: String, date: String?, time: String?, block: Task.() -> Task = { this }) =
        Task(localId = id, title = "Task $id", dueDate = date, dueTime = time, createdAt = 0, updatedAt = 0).block()

    private class FakeAlarms : AlarmScheduler {
        val set = mutableMapOf<AlarmKind, Long>()
        override fun set(kind: AlarmKind, at: Long) { set[kind] = at }
        override fun cancel(kind: AlarmKind) { set.remove(kind) }
    }

    private class FakeNotifier : ReminderNotifier {
        val reminders = mutableListOf<Reminder>()
        val summaries = mutableListOf<MorningSummary>()
        override fun showReminders(reminders: List<Reminder>) { this.reminders += reminders }
        override fun showSummary(summary: MorningSummary) { summaries += summary }
    }

    private class FakeState : AlarmState {
        var handled: Long? = null
        var summaryDate: String? = null
        override suspend fun handledUntil() = handled
        override suspend fun setHandledUntil(at: Long) { handled = at }
        override suspend fun lastSummaryDate() = summaryDate
        override suspend fun setLastSummaryDate(date: String) { summaryDate = date }
    }

    private var now = utc("2026-10-22T06:00") // 08:00 in Warsaw
    private var tasks = listOf(task("a", "2026-10-22", "09:00"), task("b", "2026-10-22", "13:15"))
    private var settings = ReminderSettings(timezone = "Europe/Warsaw", summaryTime = "05:00", reminderMinutes = listOf(0))
    private val alarms = FakeAlarms()
    private val notifier = FakeNotifier()
    private val state = FakeState()
    private val engine = ReminderEngine(
        tasks = { tasks },
        settings = { settings },
        state = state,
        alarms = alarms,
        notifier = notifier,
        clock = { now },
    )

    @Test
    fun `first schedule starts from now and arms the next reminder and summary`() = runTest {
        engine.reschedule()
        assertEquals(now, state.handled)
        assertEquals(utc("2026-10-22T07:00"), alarms.set[AlarmKind.REMINDER])
        assertEquals(utc("2026-10-23T03:00"), alarms.set[AlarmKind.SUMMARY])
    }

    @Test
    fun `a firing reminder notifies, is not repeated and arms the next one`() = runTest {
        engine.reschedule()
        now = utc("2026-10-22T07:00")
        engine.onReminderAlarm()
        assertEquals(listOf("a"), notifier.reminders.map { it.taskLocalId })
        assertEquals(utc("2026-10-22T11:15"), alarms.set[AlarmKind.REMINDER])

        // Rescheduling after a data change does not ring 09:00 again.
        engine.reschedule()
        assertEquals(utc("2026-10-22T11:15"), alarms.set[AlarmKind.REMINDER])
        engine.onReminderAlarm()
        assertEquals(1, notifier.reminders.size)
    }

    @Test
    fun `completing the only timed task cancels the reminder alarm`() = runTest {
        engine.reschedule()
        tasks = tasks.map { it.copy(status = TaskStatus.DONE, completedAt = now) }
        engine.reschedule()
        assertNull(alarms.set[AlarmKind.REMINDER])
        assertTrue(alarms.set.containsKey(AlarmKind.SUMMARY))
    }

    @Test
    fun `a phone off past a reminder does not ring it late after the restart`() = runTest {
        engine.reschedule()
        now = utc("2026-10-22T08:00") // 10:00 in Warsaw, an hour after "a"
        engine.reschedule() // what the boot receiver does
        assertEquals(utc("2026-10-22T11:15"), alarms.set[AlarmKind.REMINDER])
        engine.onReminderAlarm()
        assertTrue(notifier.reminders.isEmpty())
    }

    @Test
    fun `changing the default reminders moves the alarm`() = runTest {
        engine.reschedule()
        settings = settings.copy(reminderMinutes = listOf(30))
        engine.reschedule()
        assertEquals(utc("2026-10-22T06:30"), alarms.set[AlarmKind.REMINDER])
        settings = settings.copy(reminderMinutes = emptyList())
        engine.reschedule()
        assertNull(alarms.set[AlarmKind.REMINDER])
    }

    @Test
    fun `summary shows today's counts once a day and arms tomorrow`() = runTest {
        tasks = tasks + task("o", "2026-10-20", null)
        now = utc("2026-10-22T03:00") // 05:00 in Warsaw
        engine.onSummaryAlarm()
        assertEquals(listOf(MorningSummary(today = 2, overdue = 1, startWith = "Task o")), notifier.summaries)
        assertEquals("2026-10-22", state.summaryDate)
        assertEquals(utc("2026-10-23T03:00"), alarms.set[AlarmKind.SUMMARY])

        // The clock was set back and the alarm fired again the same day: no second summary.
        engine.onSummaryAlarm()
        assertEquals(1, notifier.summaries.size)
    }

    @Test
    fun `a new summary time and zone move the summary alarm`() = runTest {
        engine.reschedule()
        settings = settings.copy(summaryTime = "06:30", timezone = "Europe/London")
        engine.reschedule()
        // 06:30 in London (BST, UTC+1) on 23 Oct, since 06:30 BST today (05:30 UTC) is before now (06:00 UTC).
        assertEquals(utc("2026-10-23T05:30"), alarms.set[AlarmKind.SUMMARY])
    }
}
