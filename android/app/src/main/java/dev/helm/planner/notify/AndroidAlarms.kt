package dev.helm.planner.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

/**
 * The engine's alarms on AlarmManager. Exact and allowed in Doze when the user lets Helm set
 * exact alarms (Android 12+ asks for that); otherwise an inexact alarm, which Android may
 * deliver a few minutes late. Settings shows which of the two is in use.
 */
class AndroidAlarmScheduler(private val context: Context) : AlarmScheduler {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)

    override fun set(kind: AlarmKind, at: Long) {
        val operation = pendingIntent(kind)
        if (canScheduleExact(context)) {
            try {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
                return
            } catch (_: SecurityException) {
                // The permission was withdrawn between the check and the call: fall back below.
            }
        }
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
    }

    override fun cancel(kind: AlarmKind) = alarmManager.cancel(pendingIntent(kind))

    private fun pendingIntent(kind: AlarmKind): PendingIntent = PendingIntent.getBroadcast(
        context,
        kind.ordinal,
        Intent(context, AlarmReceiver::class.java).setAction(actionFor(kind)),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    companion object {
        const val ACTION_REMINDER = "dev.helm.planner.action.REMINDER"
        const val ACTION_SUMMARY = "dev.helm.planner.action.SUMMARY"

        fun actionFor(kind: AlarmKind) = when (kind) {
            AlarmKind.REMINDER -> ACTION_REMINDER
            AlarmKind.SUMMARY -> ACTION_SUMMARY
        }

        /** Android 12+ lets the user (and Android 14+ by default) withhold exact alarms. */
        fun canScheduleExact(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }
}

private val Context.alarmState by preferencesDataStore(name = "helm_alarms")

class DataStoreAlarmState(context: Context) : AlarmState {
    private val dataStore = context.applicationContext.alarmState

    override suspend fun handledUntil(): Long? = dataStore.data.first()[KEY_HANDLED_UNTIL]

    override suspend fun setHandledUntil(at: Long) {
        dataStore.edit { it[KEY_HANDLED_UNTIL] = at }
    }

    override suspend fun lastSummaryDate(): String? = dataStore.data.first()[KEY_SUMMARY_DATE]

    override suspend fun setLastSummaryDate(date: String) {
        dataStore.edit { it[KEY_SUMMARY_DATE] = date }
    }

    private companion object {
        val KEY_HANDLED_UNTIL = longPreferencesKey("reminders_handled_until")
        val KEY_SUMMARY_DATE = stringPreferencesKey("last_summary_date")
    }
}
