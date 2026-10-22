package dev.helm.planner.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.helm.planner.AppContainer
import dev.helm.planner.HelmApplication
import kotlinx.coroutines.launch

/** Runs [block] off the main thread while Android keeps the receiver alive (goAsync). */
private fun BroadcastReceiver.handle(context: Context, block: suspend AppContainer.() -> Unit) {
    val container = (context.applicationContext as HelmApplication).container
    val pending = goAsync()
    container.backgroundScope.launch {
        try {
            container.block()
        } finally {
            pending.finish()
        }
    }
}

/** Helm's own alarms and the "Done" button of a reminder; not reachable from other apps. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            AndroidAlarmScheduler.ACTION_REMINDER -> handle(context) { reminders.onReminderAlarm() }
            AndroidAlarmScheduler.ACTION_SUMMARY -> handle(context) { reminders.onSummaryAlarm() }
            ACTION_COMPLETE -> {
                val taskLocalId = intent.getStringExtra(EXTRA_TASK) ?: return
                handle(context) {
                    // Room first, then the outbox sends it; the reminder alarm follows the data change.
                    repository.complete(taskLocalId)
                    notifier.cancelReminder(taskLocalId)
                }
            }
        }
    }

    companion object {
        const val ACTION_COMPLETE = "dev.helm.planner.action.COMPLETE"
        const val EXTRA_TASK = "taskLocalId"
    }
}

/**
 * Alarms do not survive a reboot or an app update, and a clock or time zone change or a new
 * exact-alarm permission changes when they should fire: arm them again. Only the system sends
 * these broadcasts, so the receiver is not exported (as WorkManager's own reschedule receiver).
 */
class SystemEventsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in RESCHEDULE_ACTIONS) handle(context) { reminders.reschedule() }
    }

    private companion object {
        val RESCHEDULE_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
        )
    }
}
