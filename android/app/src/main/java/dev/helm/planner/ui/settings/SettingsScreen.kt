package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.settings.AppLanguage

object SettingsTags {
    const val OFFLINE = "settings_offline"
    const val CONNECTION = "settings_connection"
    const val NOTIFICATIONS = "settings_notifications"
    const val EXACT = "settings_exact"
    const val SUMMARY_TIME = "settings_summary_time"
    const val REMINDER = "settings_reminder_"
    const val LANGUAGE = "settings_language_"
    const val EXPORT_MARKDOWN = "settings_export_markdown"
    const val EXPORT_JSON = "settings_export_json"
    const val EXPORT_STATUS = "settings_export_status"
    const val LICENSE = "settings_license"
}

/** Whether Helm may show notifications, and what the button does when it may not. */
enum class NotificationAccess {
    ALLOWED,

    /** Android can still show its permission dialog. */
    ASK,

    /** The user said no or blocked Helm; only the system settings can change it. */
    BLOCKED,
}

data class SettingsUiState(
    val data: SettingsData,
    val versionName: String,
    val notifications: NotificationAccess,
    /** Exact alarms allowed (always true before Android 12). */
    val exactAlarms: Boolean,
    /** Null where the phone has no per-app language (before Android 13). */
    val language: AppLanguage?,
)

interface SettingsActions {
    fun openConnect() {}
    fun disconnect() {}
    fun setOfflineMode(enabled: Boolean) {}
    fun setSummaryTime(time: String) {}
    fun setReminderMinutes(minutes: List<Int>) {}
    fun setLanguage(language: AppLanguage) {}
    fun allowNotifications() {}
    fun allowExactAlarms() {}
    fun export(format: ExportFormat) {}
    fun openLicense() {}
    fun back() {}
}

/**
 * Settings, the fifth screen of version 1: notifications, morning summary, default reminders,
 * language, server and connection, export, about.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(state: SettingsUiState, actions: SettingsActions) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = actions::back, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            NotificationsSection(state.notifications, state.exactAlarms, actions)
            HorizontalDivider()
            SummarySection(state.data.settings.summaryTime, actions::setSummaryTime)
            HorizontalDivider()
            RemindersSection(state.data.settings.reminderMinutes, actions::setReminderMinutes)
            HorizontalDivider()
            LanguageSection(state.language, actions::setLanguage)
            HorizontalDivider()
            ServerSection(state.data, actions)
            HorizontalDivider()
            ExportSection(state.data.export, actions::export)
            HorizontalDivider()
            AboutSection(state.versionName, actions::openLicense)
        }
    }
}
