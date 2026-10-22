package dev.helm.planner.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.HelmApplication
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.HelmDates
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real path on a device: the app's own engine arms AlarmManager, Android fires the alarm,
 * the receiver posts the notification, and its "Done" button completes the task in Room.
 *
 * Time is sped up by putting the task and the summary on the next whole minute (at least
 * 20 s away) instead of waiting for a real 05:00, so the test waits at most about 80 s.
 */
@RunWith(AndroidJUnit4::class)
class ReminderDeliveryTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val container = (context.applicationContext as HelmApplication).container
    private val notifications = context.getSystemService(NotificationManager::class.java)

    @Before
    fun allowNotificationsAndExactAlarms() {
        val automation = instrumentation.uiAutomation
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            automation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
        automation.executeShellCommand("appops set ${context.packageName} SCHEDULE_EXACT_ALARM allow").close()
        notifications.cancelAll()
    }

    @Test
    fun reminderAndSummaryFireOnTimeAndDoneCompletesTheTask() = runBlocking {
        val settings = container.settings.current()
        val zone = HelmDates.zone(settings.timezone)
        val due = Instant.now().plusSeconds(20).truncatedTo(ChronoUnit.MINUTES).plus(1, ChronoUnit.MINUTES).atZone(zone)
        val time = "%02d:%02d".format(due.hour, due.minute)
        container.settings.setReminderMinutes(listOf(0))
        container.settings.setSummaryTime(time)
        val task = container.repository.add("Call the accountant ${System.nanoTime()}", due.toLocalDate().toString(), time, null)
        DataStoreAlarmState(context).setLastSummaryDate("")
        container.reminders.reschedule()

        val reminder = waitFor(due.toInstant().toEpochMilli()) { it.tag == task.localId && it.id == AndroidNotifier.ID_REMINDER }
        val summary = waitFor(due.toInstant().toEpochMilli()) { it.tag == null && it.id == AndroidNotifier.ID_SUMMARY }
        assertEquals(task.title, reminder.notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals(AndroidNotifier.CHANNEL_REMINDERS, reminder.notification.channelId)
        assertEquals(AndroidNotifier.CHANNEL_SUMMARY, summary.notification.channelId)
        assertTrue("fired at ${reminder.postTime}, due $due", reminder.postTime >= due.toInstant().toEpochMilli())

        reminder.notification.actions.single().actionIntent.send()
        val doneBy = System.currentTimeMillis() + 10_000
        while (container.database.tasks().byLocalId(task.localId)?.status != TaskStatus.DONE) {
            assertTrue("task not completed from the notification", System.currentTimeMillis() < doneBy)
            delay(200)
        }
    }

    private suspend fun waitFor(dueAt: Long, match: (StatusBarNotification) -> Boolean): StatusBarNotification {
        val deadline = dueAt + 60_000
        while (System.currentTimeMillis() < deadline) {
            notifications.activeNotifications.firstOrNull(match)?.let { return it }
            delay(500)
        }
        throw AssertionError("no notification by ${Instant.ofEpochMilli(deadline)}")
    }
}
