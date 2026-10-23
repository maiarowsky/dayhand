package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
import dev.helm.planner.ui.settings.AppearanceTags
import dev.helm.planner.ui.settings.ExportStatus
import dev.helm.planner.ui.settings.NotificationAccess
import dev.helm.planner.ui.settings.SettingsActions
import dev.helm.planner.ui.settings.SettingsData
import dev.helm.planner.ui.settings.SettingsScreen
import dev.helm.planner.ui.settings.SettingsTags
import dev.helm.planner.ui.settings.SettingsUiState
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Screenshots of the Settings list, top to bottom, and of its pages, for the before/after comparison of its look. The
 * first run is the owner's phone (notifications refused, no exact alarms), the second one with everything allowed.
 */
@RunWith(AndroidJUnit4::class)
class SettingsTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun state(notifications: NotificationAccess, exactAlarms: Boolean) = SettingsUiState(
        data = SettingsData(
            settings = AppSettings(
                backend = BackendConfig(
                    "https://helm.example.convex.site",
                    Credential.Device("https://helm.example.convex.site", "jd7device", "Pixel 9 Pro XL", "helmdev_secret.secret"),
                ),
                offlineMode = false,
                timezone = "Europe/Warsaw",
                summaryTime = "05:00",
                reminderMinutes = listOf(0, 5),
            ),
            connection = ConnectionStatus.SYNCED,
            pendingChanges = 0,
            export = ExportStatus.Idle,
        ),
        versionName = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty(),
        notifications = notifications,
        exactAlarms = exactAlarms,
        language = AppLanguage.SYSTEM,
        appearance = Appearance(
            mode = if (config.dark) ThemeMode.Dark else ThemeMode.Light,
            darkPalette = Palettes.darkById(config.darkPalette),
            lightPalette = Palettes.lightById(config.lightPalette),
            font = HelmFont.byId(config.font),
        ),
    )

    /** The list from top to bottom and, with [pages], every page its rows open, reached by tapping the row. */
    private fun tour(prefix: String, state: SettingsUiState, pages: List<Pair<String, String>>) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config) { SettingsScreen(state, object : SettingsActions {}) } }
        compose.waitForIdle()
        shoot(compose.activity, config, "$prefix-1-top")
        compose.onNodeWithTag(SettingsTags.VERSION).performScrollTo()
        compose.waitForIdle()
        shoot(compose.activity, config, "$prefix-2-bottom")
        pages.forEachIndexed { i, (name, row) ->
            compose.onNodeWithTag(row).performScrollTo().performClick()
            compose.waitForIdle()
            shoot(compose.activity, config, "$prefix-${i + 3}-$name")
            compose.onNodeWithTag("back").performClick()
            compose.waitForIdle()
        }
    }

    @Test
    fun permissionsMissing() = tour(
        "30-settings",
        state(NotificationAccess.BLOCKED, exactAlarms = false),
        listOf("notifications" to SettingsTags.ROW_NOTIFICATIONS),
    )

    @Test
    fun allAllowed() = tour(
        "31-settings-allowed",
        state(NotificationAccess.ALLOWED, exactAlarms = true),
        listOf(
            "theme" to AppearanceTags.MODE,
            "palette" to AppearanceTags.COLORS,
            "font" to AppearanceTags.FONT,
            "language" to SettingsTags.LANGUAGE_ROW,
            "notifications" to SettingsTags.ROW_NOTIFICATIONS,
            "summary" to SettingsTags.ROW_SUMMARY,
            "reminders" to SettingsTags.ROW_REMINDERS,
            "export" to SettingsTags.ROW_EXPORT,
            "server" to SettingsTags.ROW_SERVER,
            "licenses" to SettingsTags.LICENSES,
        ),
    )
}
