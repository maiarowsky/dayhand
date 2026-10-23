package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
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
 * Screenshots of the whole Settings screen, top to bottom, for the before/after comparison of its look. The first run
 * is the owner's phone (notifications refused, no exact alarms), the second one with everything allowed.
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

    private fun tour(prefix: String, state: SettingsUiState) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config) { SettingsScreen(state, object : SettingsActions {}) } }
        compose.waitForIdle()
        shoot(compose.activity, config, "$prefix-1-top")
        listOf(
            "2-reminders" to SettingsTags.REMINDER + 120,
            "3-language" to SettingsTags.LANGUAGE + AppLanguage.ENGLISH.name,
            "4-server" to SettingsTags.OFFLINE,
            "5-about" to SettingsTags.LICENSES,
        ).forEach { (name, tag) ->
            compose.onNodeWithTag(tag).performScrollTo()
            compose.waitForIdle()
            shoot(compose.activity, config, "$prefix-$name")
        }
    }

    @Test
    fun permissionsMissing() = tour("30-settings", state(NotificationAccess.BLOCKED, exactAlarms = false))

    @Test
    fun allAllowed() = tour("31-settings-allowed", state(NotificationAccess.ALLOWED, exactAlarms = true))
}
