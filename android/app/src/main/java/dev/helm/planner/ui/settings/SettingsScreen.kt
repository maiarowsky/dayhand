package dev.helm.planner.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.palette

object SettingsTags {
    const val SCREEN = "settings"
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
    const val LICENSES = "settings_licenses"
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
    val appearance: Appearance = Appearance(),
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
    fun setAppearance(appearance: Appearance) {}
    fun openColors() {}
    fun openFont() {}
    fun openLicenses() {}
    fun back() {}
}

/**
 * Settings, the fifth screen of version 1: notifications, appearance, morning summary, default reminders,
 * language, server and connection, export, about. Each section is a labelled card, as in Mussh.
 */
@Composable
fun SettingsScreen(state: SettingsUiState, actions: SettingsActions) {
    Column(Modifier.fillMaxSize().background(palette.background).testTag(SettingsTags.SCREEN)) {
        ScreenHeader(stringResource(R.string.settings_title), onBack = actions::back)
        Column(
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap),
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = HelmDimens.screenMargin),
        ) {
            NotificationsSection(state.notifications, state.exactAlarms, actions)
            AppearanceGroup(state.appearance, actions::setAppearance, actions::openColors, actions::openFont)
            SummarySection(state.data.settings.summaryTime, actions::setSummaryTime)
            RemindersSection(state.data.settings.reminderMinutes, actions::setReminderMinutes)
            LanguageSection(state.language, actions::setLanguage)
            ServerSection(state.data, actions)
            ExportSection(state.data.export, actions::export)
            AboutSection(state.versionName, actions)
            Spacer(Modifier.height(24.dp))
        }
    }
}
