package dev.helm.planner.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.palette

object SettingsTags {
    const val SCREEN = "settings"

    // Rows of the Settings list, each opening its page.
    const val ROW_NOTIFICATIONS = "settings_row_notifications"
    const val ROW_SUMMARY = "settings_row_summary"
    const val ROW_REMINDERS = "settings_row_reminders"
    const val ROW_EXPORT = "settings_row_export"
    const val ROW_SERVER = "settings_row_server"
    const val ROW_CONNECTIONS = "settings_row_connections"
    const val ROW_CALENDAR = "settings_row_calendar"
    const val LANGUAGE_ROW = "settings_language_row"
    const val LICENSE = "settings_license"
    const val LICENSES = "settings_licenses"
    const val VERSION = "settings_version"

    // The pages and what is on them.
    const val NOTIFICATIONS_PAGE = "settings_notifications_page"
    const val SUMMARY_PAGE = "settings_summary_page"
    const val REMINDERS_PAGE = "settings_reminders_page"
    const val LANGUAGE_PAGE = "settings_language_page"
    const val EXPORT_PAGE = "settings_export_page"
    const val SERVER_PAGE = "settings_server_page"
    const val NOTIFICATIONS = "settings_notifications"
    const val NOTIFICATIONS_ROW = "settings_notifications_row"
    const val EXACT = "settings_exact"
    const val EXACT_ROW = "settings_exact_row"
    const val SUMMARY_TIME = "settings_summary_time"
    const val REMINDER = "settings_reminder_"
    const val LANGUAGE = "settings_language_"
    const val OFFLINE = "settings_offline"
    const val CONNECTION = "settings_connection"
    const val TIMEZONE = "settings_timezone"
    const val EXPORT_MARKDOWN = "settings_export_markdown"
    const val EXPORT_JSON = "settings_export_json"
    const val EXPORT_STATUS = "settings_export_status"
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
    fun back() {}
}

/** The Settings list ([MAIN]) and the pages its rows open. */
enum class SettingsPane { MAIN, THEME, PALETTE, FONT, LANGUAGE, NOTIFICATIONS, SUMMARY, REMINDERS, EXPORT, CALENDAR, SERVER, CONNECTIONS, LICENSES }

/**
 * Settings, the fifth screen of version 1, laid out as Mussh's: groups under upper-case labels, one row per setting
 * (outline icon, name, current value, "›"), and each row opens a page with the choice, what it means and, where
 * something is missing, the one action that fixes it. Back on a page returns to the list. [start] opens a page
 * directly (screenshots, tests). [connections] draws the Agent connections page and [calendar] the Calendar page;
 * both load their own data.
 */
@Composable
fun SettingsScreen(
    state: SettingsUiState,
    actions: SettingsActions,
    start: SettingsPane = SettingsPane.MAIN,
    connections: @Composable (onBack: () -> Unit) -> Unit = {},
    calendar: @Composable (onBack: () -> Unit) -> Unit = {},
) {
    var pane by rememberSaveable(start) { mutableStateOf(start) }
    BackHandler(enabled = pane != SettingsPane.MAIN) { pane = SettingsPane.MAIN }
    val toMain = { pane = SettingsPane.MAIN }
    val settings = state.data.settings
    when (pane) {
        SettingsPane.MAIN -> SettingsPage(stringResource(R.string.settings_title), actions::back, SettingsTags.SCREEN) {
            SettingsSections(state, actions) { pane = it }
        }
        SettingsPane.THEME -> SettingsPage(stringResource(R.string.appearance_mode), toMain, AppearanceTags.THEME_SCREEN) {
            ThemeOptions(state.appearance, actions::setAppearance)
        }
        SettingsPane.PALETTE -> PaletteScreen(state.appearance, actions::setAppearance, toMain)
        SettingsPane.FONT -> FontScreen(state.appearance, actions::setAppearance, toMain)
        SettingsPane.LANGUAGE -> SettingsPage(stringResource(R.string.settings_language), toMain, SettingsTags.LANGUAGE_PAGE) {
            LanguageOptions(state.language, actions::setLanguage)
        }
        SettingsPane.NOTIFICATIONS -> SettingsPage(stringResource(R.string.settings_notifications_row), toMain, SettingsTags.NOTIFICATIONS_PAGE) {
            NotificationsOptions(state.notifications, state.exactAlarms, actions)
        }
        SettingsPane.SUMMARY -> SettingsPage(stringResource(R.string.settings_summary), toMain, SettingsTags.SUMMARY_PAGE) {
            SummaryOptions(settings.summaryTime, actions::setSummaryTime)
        }
        SettingsPane.REMINDERS -> SettingsPage(stringResource(R.string.settings_reminders), toMain, SettingsTags.REMINDERS_PAGE) {
            RemindersOptions(settings.reminderMinutes, actions::setReminderMinutes)
        }
        SettingsPane.EXPORT -> SettingsPage(stringResource(R.string.settings_export), toMain, SettingsTags.EXPORT_PAGE) {
            ExportOptions(state.data.export, actions::export)
        }
        SettingsPane.SERVER -> SettingsPage(stringResource(R.string.settings_backend), toMain, SettingsTags.SERVER_PAGE) {
            ServerOptions(state.data, actions)
        }
        SettingsPane.CONNECTIONS -> connections(toMain)
        SettingsPane.CALENDAR -> calendar(toMain)
        SettingsPane.LICENSES -> LicensesScreen(onBack = toMain)
    }
}

/** Settings while their values are read: the header, so Back works, and a spinner. */
@Composable
fun SettingsLoading(onBack: () -> Unit) {
    val description = stringResource(R.string.settings_loading)
    SettingsType {
        Column(Modifier.fillMaxSize().background(palette.background).testTag(SettingsTags.SCREEN)) {
            ScreenHeader(stringResource(R.string.settings_title), onBack = onBack)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    color = palette.accent,
                    modifier = Modifier.size(32.dp).semantics { contentDescription = description },
                )
            }
        }
    }
}
