package dev.helm.planner.ui.settings

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.ConnectionStatus

/**
 * The Settings list: Appearance, Notifications, Data (backup; with a server also export and calendar), Connection and About, each a
 * group of equal rows that show only a short current value. What a value means, warnings and the buttons that fix them live on the
 * row's page.
 */
@Composable
internal fun SettingsSections(state: SettingsUiState, actions: SettingsActions, open: (SettingsPane) -> Unit) {
    val settings = state.data.settings
    val appearance = state.appearance
    ListGroup(
        stringResource(R.string.settings_appearance),
        modifier = Modifier.testTag(AppearanceTags.GROUP),
        rows = listOf(
            {
                ListRow(stringResource(R.string.appearance_mode), AppearanceTags.MODE, icon = LineIcon.Contrast, value = stringResource(modeName(appearance.mode))) {
                    open(SettingsPane.THEME)
                }
            },
            {
                // The palette on screen now: the dark one in dark mode, the light one in light mode.
                ListRow(stringResource(R.string.appearance_colors), AppearanceTags.COLORS, icon = LineIcon.Palette, value = stringResource(paletteName(palette))) {
                    open(SettingsPane.PALETTE)
                }
            },
            {
                ListRow(stringResource(R.string.appearance_font), AppearanceTags.FONT, icon = LineIcon.Font, value = fontName(appearance.font)) {
                    open(SettingsPane.FONT)
                }
            },
            {
                val language = stringResource(languageName(state.language ?: AppLanguage.SYSTEM))
                ListRow(stringResource(R.string.settings_language), SettingsTags.LANGUAGE_ROW, icon = LineIcon.Globe, value = language) {
                    open(SettingsPane.LANGUAGE)
                }
            },
        ),
    )
    ListGroup(
        stringResource(R.string.settings_notifications),
        rows = listOf(
            {
                val value = stringResource(notificationsValue(state.notifications, state.exactAlarms))
                ListRow(stringResource(R.string.settings_notifications_row), SettingsTags.ROW_NOTIFICATIONS, icon = LineIcon.Bell, value = value) {
                    open(SettingsPane.NOTIFICATIONS)
                }
            },
            {
                ListRow(stringResource(R.string.settings_summary), SettingsTags.ROW_SUMMARY, icon = LineIcon.Sun, value = settings.summaryTime) {
                    open(SettingsPane.SUMMARY)
                }
            },
            {
                ListRow(stringResource(R.string.settings_reminders), SettingsTags.ROW_REMINDERS, icon = LineIcon.Clock, value = remindersValue(settings.reminderMinutes)) {
                    open(SettingsPane.REMINDERS)
                }
            },
        ),
    )
    // The server's export, its calendar address and agent connections need a server; on this phone only they are not offered.
    val connected = !settings.isLocal
    ListGroup(
        stringResource(R.string.settings_data),
        rows = buildList<@Composable () -> Unit> {
            add { ListRow(stringResource(R.string.settings_backup), SettingsTags.ROW_BACKUP, icon = LineIcon.Document) { open(SettingsPane.BACKUP) } }
            if (connected) {
                add { ListRow(stringResource(R.string.settings_export), SettingsTags.ROW_EXPORT, icon = LineIcon.Download) { open(SettingsPane.EXPORT) } }
                add { ListRow(stringResource(R.string.calendar_feed_title), SettingsTags.ROW_CALENDAR, icon = LineIcon.Calendar) { open(SettingsPane.CALENDAR) } }
            }
            if (state.data.sample) {
                add {
                    ListRow(
                        stringResource(R.string.sample_row),
                        SettingsTags.ROW_SAMPLE,
                        icon = LineIcon.List,
                        titleColor = palette.danger,
                        chevron = false,
                        onClick = actions::removeSample,
                    )
                }
            }
        },
    )
    ListGroup(
        stringResource(R.string.settings_connection),
        rows = buildList<@Composable () -> Unit> {
            add {
                val icon = if (connected) LineIcon.Cloud else LineIcon.Phone
                ListRow(stringResource(R.string.settings_backend), SettingsTags.ROW_SERVER, icon = icon, value = connectionValue(state.data.connection)) {
                    open(SettingsPane.SERVER)
                }
            }
            if (connected) {
                add {
                    ListRow(stringResource(R.string.connections_title), SettingsTags.ROW_CONNECTIONS, icon = LineIcon.Link) {
                        open(SettingsPane.CONNECTIONS)
                    }
                }
                add {
                    ListRow(stringResource(R.string.agents_title), SettingsTags.ROW_AGENTS, icon = LineIcon.Code) {
                        open(SettingsPane.AGENTS)
                    }
                }
            }
        },
    )
    ListGroup(
        stringResource(R.string.settings_about),
        rows = listOf(
            { ListRow(stringResource(R.string.about_license), SettingsTags.LICENSE, icon = LineIcon.Document, onClick = actions::openLicense) },
            { ListRow(stringResource(R.string.licenses_title), SettingsTags.LICENSES, icon = LineIcon.List) { open(SettingsPane.LICENSES) } },
            { ListRow(stringResource(R.string.settings_version_title), SettingsTags.VERSION, icon = LineIcon.Info, value = state.versionName) },
        ),
    )
    ListNote(stringResource(R.string.about_text))
}

/** On, off, or "needs fixing" when notifications may show but reminders could come late. */
@StringRes
internal fun notificationsValue(access: NotificationAccess, exactAlarms: Boolean): Int = when {
    access != NotificationAccess.ALLOWED -> R.string.settings_state_off
    !exactAlarms -> R.string.settings_state_fix
    else -> R.string.settings_state_on
}

/** The one reminder by its name, a count of several, or "none". */
@Composable
private fun remindersValue(minutes: List<Int>): String = when (minutes.size) {
    0 -> stringResource(R.string.settings_reminders_value_none)
    1 -> reminderLabel(minutes.first())
    else -> pluralStringResource(R.plurals.settings_reminders_count, minutes.size, minutes.size)
}

/** The connection in a word or two; a refused sign-in or an unreachable server is something to fix. */
@Composable
private fun connectionValue(connection: ConnectionStatus): String = when (connection) {
    ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> stringResource(R.string.settings_state_fix)
    else -> {
        val locale = LocalConfiguration.current.locales[0]
        stringResource(connectionText(connection)).replaceFirstChar { it.titlecase(locale) }
    }
}

@StringRes
internal fun languageName(language: AppLanguage): Int = when (language) {
    AppLanguage.SYSTEM -> R.string.language_system
    AppLanguage.POLISH -> R.string.language_polish
    AppLanguage.ENGLISH -> R.string.language_english
}
