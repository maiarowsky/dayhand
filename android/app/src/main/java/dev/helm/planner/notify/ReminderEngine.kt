package dev.helm.planner.notify

import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.MorningSummary
import dev.helm.planner.domain.Reminder
import dev.helm.planner.domain.ReminderRules
import dev.helm.planner.domain.morningSummary
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The two alarms Dayhand keeps: the next reminder and the next morning summary. */
enum class AlarmKind { REMINDER, SUMMARY }

/** AlarmManager, seen from the engine; [set] replaces the alarm of the same kind. */
interface AlarmScheduler {
    fun set(kind: AlarmKind, at: Long)
    fun cancel(kind: AlarmKind)
}

interface ReminderNotifier {
    fun showReminders(reminders: List<Reminder>)
    fun showSummary(summary: MorningSummary)
}

/** What the engine must remember between alarms, so nothing rings twice. */
interface AlarmState {
    /** Reminders up to this instant were handled (shown or dropped). */
    suspend fun handledUntil(): Long?
    suspend fun setHandledUntil(at: Long)

    /** The day (YYYY-MM-DD, user's zone) of the last morning summary shown. */
    suspend fun lastSummaryDate(): String?
    suspend fun setLastSummaryDate(date: String)
}

/** The settings that decide when the phone rings; they come from the server settings. */
data class ReminderSettings(val timezone: String, val summaryTime: String, val reminderMinutes: List<Int>)

/**
 * Keeps exactly one reminder alarm (the next reminder) and one summary alarm armed. When an
 * alarm fires it shows what is due and arms the next one, so the phone never holds more than
 * two alarms and needs no foreground service. [reschedule] is safe to call at any time: after
 * a change of tasks or settings, at start, after a reboot or a clock change.
 */
class ReminderEngine(
    private val tasks: suspend () -> List<Task>,
    private val settings: suspend () -> ReminderSettings,
    private val state: AlarmState,
    private val alarms: AlarmScheduler,
    private val notifier: ReminderNotifier,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    // An alarm and a data change can arrive together; one at a time keeps the state consistent.
    private val mutex = Mutex()

    suspend fun reschedule() = mutex.withLock { rescheduleLocked() }

    suspend fun onReminderAlarm() = mutex.withLock {
        val now = clock()
        val s = settings()
        val handled = state.handledUntil() ?: now
        val due = ReminderRules.due(reminders(s), now, handled, s.timezone)
        if (due.isNotEmpty()) notifier.showReminders(due)
        state.setHandledUntil(maxOf(handled, now))
        rescheduleLocked()
    }

    suspend fun onSummaryAlarm() = mutex.withLock {
        val now = clock()
        val s = settings()
        val today = HelmDates.localDate(now, s.timezone)
        if (state.lastSummaryDate() != today) {
            notifier.showSummary(morningSummary(tasks(), now, s.timezone))
            state.setLastSummaryDate(today)
        }
        rescheduleLocked()
    }

    private suspend fun rescheduleLocked() {
        val now = clock()
        val s = settings()
        // The first time ever, nothing before now counts.
        val handled = state.handledUntil() ?: now.also { state.setHandledUntil(it) }
        val next = ReminderRules.nextAlarm(reminders(s), now, handled)
        if (next == null) alarms.cancel(AlarmKind.REMINDER) else alarms.set(AlarmKind.REMINDER, next)
        alarms.set(AlarmKind.SUMMARY, ReminderRules.nextSummaryAt(now, s.summaryTime, s.timezone))
    }

    private suspend fun reminders(s: ReminderSettings): List<Reminder> =
        ReminderRules.reminders(tasks(), s.reminderMinutes, s.timezone)
}
