package dev.helm.planner.ui

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
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
import dev.helm.planner.ui.settings.AppearanceTags
import dev.helm.planner.ui.settings.ExportFailure
import dev.helm.planner.ui.settings.ExportStatus
import dev.helm.planner.ui.settings.NotificationAccess
import dev.helm.planner.ui.settings.SettingsActions
import dev.helm.planner.ui.settings.SettingsData
import dev.helm.planner.ui.settings.SettingsLoading
import dev.helm.planner.ui.settings.SettingsPane
import dev.helm.planner.ui.settings.SettingsScreen
import dev.helm.planner.ui.settings.SettingsTags
import dev.helm.planner.ui.settings.SettingsUiState
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

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

    private fun show(state: SettingsUiState, actions: SettingsActions = Recorder(), start: SettingsPane = SettingsPane.MAIN) {
        compose.setContent { HelmTheme { SettingsScreen(state, actions, start) } }
    }

    /** The value at the end of a row of the Settings list. */
    private fun value(row: String) = compose.onNodeWithTag("$row-value", useUnmergedTree = true)

    /** Taps a row of the Settings list and checks that its page opened. */
    private fun open(row: String, page: String) {
        compose.onNodeWithTag(row).performScrollTo().performClick()
        compose.onNodeWithTag(page).assertIsDisplayed()
    }

    @Test
    fun everyRowOpensItsPageAndBackReturnsToTheList() {
        show(state())
        listOf(
            AppearanceTags.MODE to AppearanceTags.THEME_SCREEN,
            AppearanceTags.COLORS to AppearanceTags.PALETTE_SCREEN,
            AppearanceTags.FONT to AppearanceTags.FONT_SCREEN,
            SettingsTags.LANGUAGE_ROW to SettingsTags.LANGUAGE_PAGE,
            SettingsTags.ROW_NOTIFICATIONS to SettingsTags.NOTIFICATIONS_PAGE,
            SettingsTags.ROW_SUMMARY to SettingsTags.SUMMARY_PAGE,
            SettingsTags.ROW_REMINDERS to SettingsTags.REMINDERS_PAGE,
            SettingsTags.ROW_EXPORT to SettingsTags.EXPORT_PAGE,
            SettingsTags.ROW_SERVER to SettingsTags.SERVER_PAGE,
            SettingsTags.LICENSES to "licenses",
        ).forEach { (row, page) ->
            open(row, page)
            compose.onNodeWithTag("back").performClick()
            compose.onNodeWithTag(SettingsTags.SCREEN).assertIsDisplayed()
            compose.onNodeWithTag(page).assertDoesNotExist()
        }
    }

    @Test
    fun systemBackOnAPageReturnsToTheListAndOnTheListLeaves() {
        val actions = object : SettingsActions {
            var left = false
            override fun back() { left = true }
        }
        show(state(), actions)
        open(SettingsTags.ROW_SERVER, SettingsTags.SERVER_PAGE)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithTag(SettingsTags.SCREEN).assertIsDisplayed()
        assertFalse(actions.left)
        compose.onNodeWithTag("back").performClick()
        assertTrue(actions.left)
    }

    @Test
    fun theListShowsOnlyShortValues() {
        show(state(notifications = NotificationAccess.BLOCKED, minutes = listOf(0, 45)))
        value(SettingsTags.ROW_NOTIFICATIONS).assertTextEquals(text(R.string.settings_state_off))
        value(SettingsTags.ROW_SUMMARY).assertTextEquals("05:00")
        value(SettingsTags.ROW_REMINDERS)
            .assertTextEquals(context.resources.getQuantityString(R.plurals.settings_reminders_count, 2, 2))
        value(SettingsTags.ROW_SERVER).performScrollTo()
            .assertTextEquals(text(R.string.connection_synced).replaceFirstChar { it.titlecase() })
        value(SettingsTags.VERSION).performScrollTo().assertTextEquals("0.2.0")
        // What a missing permission means and the button that fixes it are on the page, not on the list.
        compose.onNodeWithText(text(R.string.settings_notifications_off)).assertDoesNotExist()
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS).assertDoesNotExist()
    }

    @Test
    fun rowsHaveOneHeight() {
        show(state())
        listOf(AppearanceTags.MODE, AppearanceTags.COLORS, SettingsTags.ROW_NOTIFICATIONS, SettingsTags.ROW_SUMMARY, SettingsTags.ROW_REMINDERS)
            .map { compose.onNodeWithTag(it).performScrollTo().fetchSemanticsNode().size.height }
            .let { heights -> assertEquals("rows $heights", 1, heights.distinct().size) }
    }

    @Test
    fun aRowThatNeedsAttentionSaysSo() {
        show(state(exact = false))
        value(SettingsTags.ROW_NOTIFICATIONS).assertTextEquals(text(R.string.settings_state_fix))
    }

    @Test
    fun summaryTimeAndDefaultRemindersAreShownAndChanged() {
        val actions = Recorder()
        show(state(minutes = listOf(0, 45)), actions)
        open(SettingsTags.ROW_SUMMARY, SettingsTags.SUMMARY_PAGE)
        compose.onNodeWithTag(SettingsTags.SUMMARY_TIME).assertTextContains("05:00", substring = true).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("back").performClick()
        open(SettingsTags.ROW_REMINDERS, SettingsTags.REMINDERS_PAGE)
        compose.onNodeWithTag(SettingsTags.REMINDER + 0).assertIsSelected().assertHeightIsAtLeast(48.dp)
        // A value set elsewhere (e.g. by the agent) is shown and can be removed.
        compose.onNodeWithTag(SettingsTags.REMINDER + 45).performScrollTo().assertIsSelected().performClick()
        compose.onNodeWithTag(SettingsTags.REMINDER + 30).performScrollTo().assertIsNotSelected().performClick()
        assertEquals(listOf("reminders:[0]", "reminders:[0, 45, 30]"), actions.calls)
    }

    @Test
    fun summaryTimeOpensTheClock() {
        show(state(), start = SettingsPane.SUMMARY)
        compose.onNodeWithTag(SettingsTags.SUMMARY_TIME).performClick()
        compose.onNodeWithText(text(R.string.ok)).assertIsDisplayed()
    }

    @Test
    fun missingPermissionsOfferToAllowThem() {
        val actions = Recorder()
        show(state(notifications = NotificationAccess.ASK, exact = false), actions)
        open(SettingsTags.ROW_NOTIFICATIONS, SettingsTags.NOTIFICATIONS_PAGE)
        compose.onNodeWithText(text(R.string.settings_notifications_off)).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS)
            .assertTextContains(text(R.string.settings_notifications_allow))
            .assertHeightIsAtLeast(48.dp)
            .performClick()
        compose.onNodeWithTag(SettingsTags.EXACT).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("notifications", "exact"), actions.calls)
    }

    @Test
    fun permissionsShowTheirStateOnTheirPage() {
        show(state(notifications = NotificationAccess.BLOCKED, exact = true), start = SettingsPane.NOTIFICATIONS)
        value(SettingsTags.NOTIFICATIONS_ROW).assertTextEquals(text(R.string.settings_state_off))
        value(SettingsTags.EXACT_ROW).assertTextEquals(text(R.string.settings_state_on))
        // Name and state are read as one item; what the state means is under the card.
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS_ROW).assertTextContains(text(R.string.settings_notifications_title))
        compose.onNodeWithText(text(R.string.settings_notifications_off)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.settings_exact_on)).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.EXACT).assertDoesNotExist()
    }

    @Test
    fun whileLoadingTheHeaderAndASpinnerShow() {
        var back = false
        compose.setContent { HelmTheme { SettingsLoading(onBack = { back = true }) } }
        compose.onNodeWithContentDescription(text(R.string.settings_loading)).assertIsDisplayed()
        compose.onNodeWithTag("back").performClick()
        assertTrue(back)
    }

    @Test
    fun blockedNotificationsLeadToTheSystemSettings() {
        show(state(notifications = NotificationAccess.BLOCKED), start = SettingsPane.NOTIFICATIONS)
        compose.onNodeWithTag(SettingsTags.NOTIFICATIONS).assertTextContains(text(R.string.settings_open_system))
    }

    @Test
    fun connectionStatusShowsWaitingChanges() {
        show(state(connection = ConnectionStatus.OFFLINE, pending = 3), start = SettingsPane.SERVER)
        compose.onNodeWithTag(SettingsTags.CONNECTION)
            .assertTextContains(text(R.string.connection_label, text(R.string.connection_offline)))
            .assertTextContains(context.resources.getQuantityString(R.plurals.connection_pending, 3, 3))
    }

    @Test
    fun languageIsPickedFromRadioRows() {
        val actions = Recorder()
        show(state(), actions)
        open(SettingsTags.LANGUAGE_ROW, SettingsTags.LANGUAGE_PAGE)
        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.SYSTEM.name).assertIsSelected()
        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.POLISH.name).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("language:POLISH"), actions.calls)
    }

    @Test
    fun exportButtonsAndResult() {
        val actions = Recorder()
        show(state(export = ExportStatus.Failed(ExportFailure.UNREACHABLE)), actions)
        open(SettingsTags.ROW_EXPORT, SettingsTags.EXPORT_PAGE)
        compose.onNodeWithTag(SettingsTags.EXPORT_MARKDOWN).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(SettingsTags.EXPORT_JSON).performClick()
        compose.onNodeWithTag(SettingsTags.EXPORT_STATUS).assertTextContains(text(R.string.export_failed))
        assertEquals(listOf("export:MARKDOWN", "export:JSON"), actions.calls)
    }

    @Test
    fun exportRowsWaitWhileAnExportRuns() {
        show(state(export = ExportStatus.Working), start = SettingsPane.EXPORT)
        compose.onNodeWithTag(SettingsTags.EXPORT_MARKDOWN).assertIsNotEnabled()
        compose.onNodeWithTag(SettingsTags.EXPORT_JSON).assertIsNotEnabled()
        compose.onNodeWithTag(SettingsTags.EXPORT_STATUS).assertTextContains(text(R.string.export_working))
    }

    @Test
    fun aboutShowsVersionAndLicense() {
        val actions = Recorder()
        show(state(), actions)
        compose.onNodeWithTag(SettingsTags.VERSION).performScrollTo().assertTextContains("0.2.0")
        compose.onNodeWithTag(SettingsTags.LICENSE).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("license"), actions.calls)
    }

    @Test
    fun offlineSwitchReflectsTheSetting() {
        show(state(), start = SettingsPane.SERVER)
        compose.onNodeWithTag(SettingsTags.OFFLINE).performScrollTo().assertIsOff()
        compose.onNodeWithTag(SettingsTags.OFFLINE).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun pairedPhoneShowsServerAndDisconnectsAfterConfirming() {
        val actions = Recorder()
        show(state(), actions)
        open(SettingsTags.ROW_SERVER, SettingsTags.SERVER_PAGE)
        compose.onNodeWithText(text(R.string.server_connected_to, "10.0.2.2"), substring = true).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.server_device, "Pixel 9")).assertIsDisplayed()
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
        show(state(backend = null, connection = ConnectionStatus.NOT_CONFIGURED), actions, start = SettingsPane.SERVER)
        compose.onNodeWithText(text(R.string.server_not_connected)).assertIsDisplayed()
        compose.onNodeWithTag(ServerTags.DISCONNECT).assertDoesNotExist()
        compose.onNodeWithTag(ServerTags.CONNECT).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("connect"), actions.calls)
    }

    @Test
    fun aRevokedPhoneSaysTheServerSignedItOut() {
        show(state(backend = null, connection = ConnectionStatus.UNAUTHORIZED, pairingLost = true))
        value(SettingsTags.ROW_SERVER).performScrollTo().assertTextEquals(text(R.string.settings_state_fix))
        open(SettingsTags.ROW_SERVER, SettingsTags.SERVER_PAGE)
        compose.onNodeWithText(text(R.string.server_signed_out)).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.CONNECTION)
            .assertTextContains(text(R.string.connection_unauthorized), substring = true)
    }

    @Test
    fun aFontRowShowsItsLicenseText() {
        show(state(), start = SettingsPane.LICENSES)
        compose.onNodeWithText("SIL OPEN FONT LICENSE", substring = true).assertDoesNotExist()
        compose.onNodeWithTag("license-Inter").performClick()
        compose.onNodeWithText("SIL OPEN FONT LICENSE", substring = true).assertExists()
        compose.onNodeWithTag("license-Inter").performClick()
        compose.onNodeWithText("SIL OPEN FONT LICENSE", substring = true).assertDoesNotExist()
    }

    private companion object {
        val DEVICE = Credential.Device("http://10.0.2.2:3211", "jd7device", "Pixel 9", "helmdev_secret.secret")
    }
}
