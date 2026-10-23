package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.TodaySections
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
import dev.helm.planner.ui.connect.ConnectActions
import dev.helm.planner.ui.connect.ConnectPhase
import dev.helm.planner.ui.connect.ConnectScreen
import dev.helm.planner.ui.connect.ConnectUiState
import dev.helm.planner.ui.settings.ExportStatus
import dev.helm.planner.ui.settings.NotificationAccess
import dev.helm.planner.ui.settings.SettingsActions
import dev.helm.planner.ui.settings.SettingsData
import dev.helm.planner.ui.settings.SettingsScreen
import dev.helm.planner.ui.settings.SettingsTags
import dev.helm.planner.ui.settings.SettingsUiState
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.QuickAddTags
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayTags
import dev.helm.planner.ui.today.TodayUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Screenshots of every screen with fixed sample data, for the before/after comparison in the task report. It asserts
 * nothing; run it on purpose with the tour arguments (see [TourConfig]). Sample data is Polish, like the owner's phone.
 */
@RunWith(AndroidJUnit4::class)
class ScreenTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun show(content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config, content) }
        compose.waitForIdle()
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    private fun task(id: String, title: String, due: String?, time: String? = null, block: Task.() -> Task = { this }) =
        Task(localId = id, title = title, dueDate = due, dueTime = time, createdAt = 0, updatedAt = 0).block()

    private val full = TodayUiState(
        TodaySections(
            "2026-10-22",
            overdue = listOf(task("o1", "Podlać kwiaty", "2026-10-21")),
            now = task("n", "Zaplanować tydzień", "2026-10-22") {
                copy(isNow = true, status = TaskStatus.DOING, resumeNote = "Szkic w docs/tydzien.md, dalej: budżet")
            },
            today = listOf(
                task("t1", "Zadzwonić do dentysty", "2026-10-22", "09:30"),
                task("t2", "Przejrzeć pull request", "2026-10-22"),
                task("t3", "Kupić chleb", "2026-10-22"),
            ),
            done = listOf(task("d1", "Poranny bieg", "2026-10-22") { copy(status = TaskStatus.DONE, completedAt = 1) }),
        ),
        ConnectionStatus.OFFLINE,
        2,
    )

    @Test
    fun today() {
        show { TodayScreen(full, object : TodayActions {}) }
        shot("01-today")
        // A lazy list composes only what is on screen, so scroll the list itself to the header first.
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasTestTag(TodayTags.DONE))
        compose.onNodeWithTag(TodayTags.DONE).performClick()
        shot("02-today-done-open")
    }

    @Test
    fun todayEmpty() {
        val empty = TodayUiState(TodaySections("2026-10-22", emptyList(), null, emptyList(), emptyList()), ConnectionStatus.NOT_CONFIGURED, 0)
        show { TodayScreen(empty, object : TodayActions {}) }
        shot("03-today-empty")
    }

    @Test
    fun quickAdd() {
        show { TodayScreen(full, object : TodayActions {}) }
        compose.onNodeWithTag(TodayTags.FAB).performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput("Odebrać paczkę")
        compose.onNodeWithText(context.getString(R.string.quick_add_more)).performClick()
        shot("04-quick-add")
    }

    @Test
    fun resumeDialog() {
        show { TodayScreen(full, object : TodayActions {}) }
        compose.onNodeWithText("Szkic w docs/tydzien.md, dalej: budżet").performClick()
        shot("05-dialog-resume")
    }

    private fun settingsState() = SettingsUiState(
        data = SettingsData(
            settings = AppSettings(
                backend = BackendConfig("https://helm.example.convex.site", Credential.Device("https://helm.example.convex.site", "jd7device", "Pixel 7", "helmdev_secret.secret")),
                offlineMode = false,
                timezone = "Europe/Warsaw",
                summaryTime = "05:00",
                reminderMinutes = listOf(0, 15),
            ),
            connection = ConnectionStatus.SYNCED,
            pendingChanges = 0,
            export = ExportStatus.Idle,
        ),
        versionName = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty(),
        notifications = NotificationAccess.ASK,
        exactAlarms = true,
        language = AppLanguage.SYSTEM,
    )

    @Test
    fun settings() {
        show { SettingsScreen(settingsState(), object : SettingsActions {}) }
        shot("06-settings")
        compose.onNodeWithTag(SettingsTags.VERSION).performScrollTo()
        shot("07-settings-about")
        compose.onNodeWithTag(SettingsTags.ROW_SERVER).performScrollTo().performClick()
        shot("08-settings-server")
    }

    @Test
    fun connect() {
        val failed = ConnectPhase.Failed(ConnectError.INVALID_CODE)
        show { ConnectScreen(ConnectUiState("https://helm.example.convex.site", "ABCD-EFGH-JKMN", failed, firstRun = true), object : ConnectActions {}) }
        shot("09-connect")
    }
}
