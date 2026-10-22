package dev.helm.planner.notify

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.content.res.Resources
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.ContextCompat
import dev.helm.planner.MainActivity
import dev.helm.planner.R
import dev.helm.planner.domain.MorningSummary
import dev.helm.planner.domain.Reminder
import dev.helm.planner.ui.theme.AppearanceStore

/**
 * Reminders and the morning summary as notifications, in two channels so each can be turned
 * off or silenced on its own in the system settings. The summary channel is quiet by default:
 * it arrives at 05:00 and should be waiting, not wake anyone.
 */
class AndroidNotifier(private val context: Context) : ReminderNotifier {
    private val manager = NotificationManagerCompat.from(context)

    fun createChannels() {
        val system = context.getSystemService(NotificationManager::class.java)
        system.createNotificationChannel(
            NotificationChannel(CHANNEL_REMINDERS, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = context.getString(R.string.channel_reminders_description) },
        )
        system.createNotificationChannel(
            NotificationChannel(CHANNEL_SUMMARY, context.getString(R.string.channel_summary), NotificationManager.IMPORTANCE_LOW)
                .apply { description = context.getString(R.string.channel_summary_description) },
        )
    }

    // canPost() checks the permission; notifySafely() catches its withdrawal in between.
    @SuppressLint("MissingPermission")
    override fun showReminders(reminders: List<Reminder>) {
        if (!canPost(context)) return
        for (reminder in reminders) {
            val notification = NotificationCompat.Builder(context, CHANNEL_REMINDERS)
                .setSmallIcon(R.drawable.ic_stat_helm)
                .setColor(accent())
                .setContentTitle(reminder.title)
                .setContentText(reminderText(context.resources, reminder))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setWhen(reminder.at)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(openApp())
                .addAction(0, context.getString(R.string.reminder_done), completeIntent(reminder.taskLocalId))
                .build()
            notifySafely { manager.notify(reminder.taskLocalId, ID_REMINDER, notification) }
        }
    }

    @SuppressLint("MissingPermission")
    override fun showSummary(summary: MorningSummary) {
        if (!canPost(context)) return
        val text = summary.startWith?.let { context.getString(R.string.summary_start_with, it) }
        val notification = NotificationCompat.Builder(context, CHANNEL_SUMMARY)
            .setSmallIcon(R.drawable.ic_stat_helm)
            .setColor(accent())
            .setContentTitle(summaryTitle(context.resources, summary))
            .apply { if (text != null) setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)) }
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build()
        notifySafely { manager.notify(ID_SUMMARY, notification) }
    }

    /**
     * The icon tint: the accent of the chosen palette for the shade's own light or dark look (the system draws the
     * shade by its mode, not Helm's), so it keeps its contrast there.
     */
    private fun accent(): Int {
        val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val appearance = AppearanceStore(context).appearance.value
        return (if (night) appearance.darkPalette else appearance.lightPalette).accent.toArgb()
    }

    fun cancelReminder(taskLocalId: String) = manager.cancel(taskLocalId, ID_REMINDER)

    /** Callers check [canPost] first; the permission can still be withdrawn in between, which is not a crash. */
    private fun notifySafely(post: () -> Unit) {
        try {
            post()
        } catch (_: SecurityException) {
        }
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun completeIntent(taskLocalId: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, AlarmReceiver::class.java)
            .setAction(AlarmReceiver.ACTION_COMPLETE)
            // A distinct data URI gives every task its own PendingIntent.
            .setData(Uri.fromParts("helm", taskLocalId, null))
            .putExtra(AlarmReceiver.EXTRA_TASK, taskLocalId),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    companion object {
        const val CHANNEL_REMINDERS = "reminders"
        const val CHANNEL_SUMMARY = "summary"
        const val ID_REMINDER = 1
        const val ID_SUMMARY = 2

        /** Android 13+ needs the POST_NOTIFICATIONS permission; the user can also block the app. */
        fun canPost(context: Context): Boolean =
            NotificationManagerCompat.from(context).areNotificationsEnabled() &&
                (
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                        PackageManager.PERMISSION_GRANTED
                    )

        fun reminderText(resources: Resources, reminder: Reminder): String =
            if (reminder.minutesBefore == 0) {
                resources.getString(R.string.reminder_now, reminder.dueTime)
            } else {
                resources.getString(R.string.reminder_soon, reminder.dueTime, durationLabel(resources, reminder.minutesBefore))
            }

        fun summaryTitle(resources: Resources, summary: MorningSummary): String {
            val tasks = resources.getQuantityString(R.plurals.summary_tasks, summary.today, summary.today)
            return when {
                summary.today == 0 && summary.overdue == 0 -> resources.getString(R.string.summary_nothing)
                summary.overdue == 0 -> resources.getString(R.string.summary_title, tasks)
                else -> resources.getString(
                    R.string.summary_title_overdue,
                    tasks,
                    resources.getQuantityString(R.plurals.summary_overdue, summary.overdue, summary.overdue),
                )
            }
        }

        /** 10 min, 2 h, 1 h 30 min, 1 day: how long before the due time. */
        fun durationLabel(resources: Resources, minutes: Int): String = when {
            minutes >= DAY && minutes % DAY == 0 -> resources.getQuantityString(R.plurals.duration_days, minutes / DAY, minutes / DAY)
            minutes < HOUR -> resources.getString(R.string.duration_minutes, minutes)
            minutes % HOUR == 0 -> resources.getString(R.string.duration_hours, minutes / HOUR)
            else -> resources.getString(R.string.duration_hours_minutes, minutes / HOUR, minutes % HOUR)
        }

        private const val HOUR = 60
        private const val DAY = 24 * HOUR
    }
}
