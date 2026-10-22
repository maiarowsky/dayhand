package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
import dev.helm.planner.ui.connect.ServerTags
import dev.helm.planner.ui.settings.ExportFailure
import dev.helm.planner.ui.settings.ExportStatus
import dev.helm.planner.ui.settings.NotificationAccess
import dev.helm.planner.ui.settings.SettingsActions
import dev.helm.planner.ui.settings.SettingsData
import dev.helm.planner.ui.settings.SettingsScreen
import dev.helm.planner.ui.settings.SettingsTags
import dev.helm.planner.ui.settings.SettingsUiState
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private class Recorder : SettingsActions {
        val calls = mutableListOf<String>()
        override fun setReminderMinutes(minutes: List<Int>) { calls += "reminders:$minutes" }
        override fun setLanguage(language: AppLanguage) { calls += "language:$language" }
        override fun allowNotifications() { calls += "notifications" }
        override fun allowExactAlarms() { calls += "exact" }
        override fun export(format: ExportFormat) { calls += "export:$format" }
        override fun openLicense() { calls += "license" }
        override fun openConnect() { calls += "connect" }
        override fun disconnect() { calls += "disconnect" }
    }

    private fun state(
        connection: ConnectionStatus = ConnectionStatus.SYNCED,
        pending: Int = 0,
        notifications: NotificationAccess = NotificationAccess.ALLOWED,
        exact: Boolean = true,
        export: ExportStatus = ExportStatus.Idle,
        minutes: List<Int> = listOf(0),
        backend: BackendConfig? = BackendConfig("http://10.0.2.2:3210", DEVICE),
        pairingLost: Boolean = false,
    ) = SettingsUiState(
        data = SettingsData(
            settings = AppSettings(
                backend = backend,
                offlineMode = false,
                timezone = "Europe/Warsaw",
                summaryTime = "05:00",
                reminderMinutes = minutes,
                pairingLost = pairingLost,
            ),
            connection = connection,
            pendingChanges = pending,
            export = export,
        ),
        versionName = "0.2.0",
        notifications = notifications,
        exactAlarms = exact,
        language = AppLanguage.SYSTEM,
    )

    private fun show(state: SettingsUiState, actions: SettingsActions = Recorder()) {
        compose.setContent { HelmTheme { SettingsScreen(state, actions) } }
    }

    @Test
    fun summaryTimeAndDefaultRemindersAreShownAndChanged() {
        val actions = Recorder()
        show(state(minutes = listOf(0, 45)), actions)
        compose.onNodeWithTag(SettingsTags.SUMMARY_TIME).assertTextContains("05:00", substring = true).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(SettingsTags.REMINDER + 0).assertIsSelected().assertHeightIsAtLeast(48.dp)
        // A value set elsewhere (e.g. by the agent) is shown and can be removed.
        compose.onNodeWithTag(SettingsTags.REMINDER + 45).performScrollTo().assertIsSelected().performClick()
        compose.onNodeWithTag(SettingsTags.REMINDER + 30).performScrollTo().performClick()
        assertEquals(listOf("reminders:[0]", "reminders:[0, 45, 30]"), actions.calls)
    }

    @Test
    fun summaryTimeOpensTheClock() {
        show(state())
        compose.onNodeWithTag(SettingsTags.SUMMARY_TIME).performClick()
        compose.onNodeWithText(text(R.string.ok)).assertIsDisplayed()
    }

    @Test
    fun missingPermissionsOfferToAllowThem() {
        val actions = Recorder()
        show(state(notifications = NotificationAccess.ASK, exact = false), actions)
        compose.onNodeWithText(text(R.string.settings_notifications_off)).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS)
            .assertTextContains(text(R.string.settings_notifications_allow))
            .assertHeightIsAtLeast(48.dp)
            .performClick()
        compose.onNodeWithTag(SettingsTags.EXACT).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("notifications", "exact"), actions.calls)
    }

    @Test
    fun blockedNotificationsLeadToTheSystemSettings() {
        show(state(notifications = NotificationAccess.BLOCKED))
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS).assertTextContains(text(R.string.settings_open_system))
    }

    @Test
    fun connectionStatusShowsWaitingChanges() {
        show(state(connection = ConnectionStatus.OFFLINE, pending = 3))
        compose.onNodeWithTag(SettingsTags.CONNECTION)
            .performScrollTo()
            .assertTextContains(text(R.string.connection_label, text(R.string.connection_offline)))
            .assertTextContains(context.resources.getQuantityString(R.plurals.connection_pending, 3, 3))
    }

    @Test
    fun languageIsPickedFromRadioRows() {
        val actions = Recorder()
        show(state(), actions)
        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.SYSTEM.name).performScrollTo().assertIsSelected()
        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.POLISH.name).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("language:POLISH"), actions.calls)
    }

    @Test
    fun exportButtonsAndResult() {
        val actions = Recorder()
        show(state(export = ExportStatus.Failed(ExportFailure.UNREACHABLE)), actions)
        compose.onNodeWithTag(SettingsTags.EXPORT_MARKDOWN).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(SettingsTags.EXPORT_JSON).performScrollTo().performClick()
        compose.onNodeWithTag(SettingsTags.EXPORT_STATUS).assertTextContains(text(R.string.export_failed))
        assertEquals(listOf("export:MARKDOWN", "export:JSON"), actions.calls)
    }

    @Test
    fun aboutShowsVersionAndLicense() {
        val actions = Recorder()
        show(state(), actions)
        compose.onNodeWithText(text(R.string.settings_version, "0.2.0")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.LICENSE).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("license"), actions.calls)
    }

    @Test
    fun offlineSwitchReflectsTheSetting() {
        show(state())
        compose.onNodeWithTag(SettingsTags.OFFLINE).performScrollTo().assertIsOff()
        compose.onNodeWithTag(SettingsTags.OFFLINE).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun pairedPhoneShowsServerAndDisconnectsAfterConfirming() {
        val actions = Recorder()
        show(state(), actions)
        compose.onNodeWithText(text(R.string.server_connected_to, "10.0.2.2"), substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.server_device, "Pixel 9")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(ServerTags.CONNECT).assertDoesNotExist()
        compose.onNodeWithTag(ServerTags.DISCONNECT).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        // The dialog names the device id for revoking it on the server too.
        compose.onNodeWithText("hlm revoke jd7device", substring = true).assertIsDisplayed()
        compose.onNodeWithTag(ServerTags.DISCONNECT_CONFIRM).performClick()
        assertEquals(listOf("disconnect"), actions.calls)
    }

    @Test
    fun withoutServerTheConnectButtonOpensPairing() {
        val actions = Recorder()
        show(state(backend = null, connection = ConnectionStatus.NOT_CONFIGURED), actions)
        compose.onNodeWithText(text(R.string.server_not_connected)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(ServerTags.DISCONNECT).assertDoesNotExist()
        compose.onNodeWithTag(ServerTags.CONNECT).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("connect"), actions.calls)
    }

    @Test
    fun aRevokedPhoneSaysTheServerSignedItOut() {
        show(state(backend = null, connection = ConnectionStatus.UNAUTHORIZED, pairingLost = true))
        compose.onNodeWithText(text(R.string.server_signed_out)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.CONNECTION)
            .assertTextContains(text(R.string.connection_unauthorized), substring = true)
    }

    private companion object {
        val DEVICE = Credential.Device("http://10.0.2.2:3211", "jd7device", "Pixel 9", "helmdev_secret.secret")
    }
}
