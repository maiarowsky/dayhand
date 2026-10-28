package dev.helm.planner.ui.today

import android.app.Application
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.daySections
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.ui.components.HEADER_TITLE
import dev.helm.planner.ui.theme.HelmTheme
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The arrows of Today: the day before and after with their own tasks, the way back, and the day kept. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp")
class TodayDaysTest {
    @get:Rule val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T10:00:00Z").toEpochMilli()
    private val tasks = listOf(
        Task("t1", title = "Water the plants", dueDate = "2026-10-22", createdAt = 1, updatedAt = 1),
        Task("t2", title = "Call the plumber", dueDate = "2026-10-23", createdAt = 2, updatedAt = 2),
        Task("t3", title = "Old errand", dueDate = "2026-10-21", createdAt = 3, updatedAt = 3),
    )
    private val shown = mutableListOf<Int>()
    private val added = mutableListOf<String?>()

    private fun show() {
        val offset = mutableIntStateOf(0)
        val actions = object : TodayActions {
            override fun showDay(offset: Int) {
                shown += offset
                offsetState.intValue = offset
            }

            override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) {
                added += dueDate
            }

            val offsetState = offset
        }
        compose.setContent {
            val state = TodayUiState(daySections(tasks, now, "UTC", offset.intValue), ConnectionStatus.LOCAL, 0, timezone = "UTC", dayOffset = offset.intValue)
            HelmTheme { TodayScreen(state, actions, now = { now }) }
        }
    }

    @Test fun theArrowsShowTheDayBeforeAndAfterWithItsOwnTasks() {
        show()
        compose.onNodeWithTag(HEADER_TITLE).assertDoesNotExist()
        compose.onNodeWithText("Today").assertIsDisplayed()
        compose.onNodeWithText("Water the plants").assertIsDisplayed()
        compose.onNodeWithTag(TodayTags.NEXT_DAY).performClick()
        compose.onNodeWithText("Tomorrow").assertIsDisplayed()
        compose.onNodeWithText("Call the plumber").assertIsDisplayed()
        compose.onNodeWithText("Water the plants").assertDoesNotExist()
        compose.onNodeWithTag(TodayTags.PREVIOUS_DAY).performClick()
        compose.onNodeWithTag(TodayTags.PREVIOUS_DAY).performClick()
        compose.onNodeWithText("Yesterday").assertIsDisplayed()
        compose.onNodeWithText("Old errand").assertIsDisplayed()
        compose.onNodeWithTag(TodayTags.PREVIOUS_DAY).performClick()
        // Further away the header names the weekday, with the full date under it.
        compose.onNodeWithTag(HEADER_TITLE).assertTextContains("Tuesday", substring = true)
        compose.onNodeWithText("Nothing planned for this day.").assertIsDisplayed()
        assertEquals(listOf(1, 0, -1, -2), shown)
    }

    @Test fun aTapOnTheTitleOfAnotherDayGoesBackToToday() {
        show()
        compose.onNodeWithTag(TodayTags.NEXT_DAY).performClick()
        compose.onNodeWithTag(TodayTags.NEXT_DAY).performClick()
        compose.onNodeWithTag(HEADER_TITLE).performClick()
        compose.onNodeWithText("Today").assertIsDisplayed()
        compose.onNodeWithText("Water the plants").assertIsDisplayed()
        assertEquals(0, shown.last())
    }

    @Test fun theArrowsAreNamedButtonsOfAtLeast48dp() {
        show()
        listOf("Previous day", "Next day").forEach {
            compose.onNodeWithContentDescription(it).assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        }
    }

    @Test fun aTaskAddedWhileLookingAtAnotherDayIsDueOnIt() {
        show()
        compose.onNodeWithTag(TodayTags.NEXT_DAY).performClick()
        compose.onNodeWithTag(TodayTags.FAB).performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput("Buy bread")
        compose.onNodeWithTag(QuickAddTags.SAVE).performClick()
        assertEquals(listOf<String?>("2026-10-23"), added)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun theDayShownIsKeptWhenTheScreenIsMadeAgain() = runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val context = ApplicationProvider.getApplicationContext<Application>()
        val db = Room.inMemoryDatabaseBuilder(context, HelmDatabase::class.java).allowMainThreadQueries().build()
        try {
            val repository = TaskRepository(db)
            val settings = SettingsStore(context)
            val live = LiveSync(settings, repository) { _, _ -> error("no server in this test") }
            val saved = SavedStateHandle()
            TodayViewModel(repository, settings, NetworkMonitor(context), live, savedState = saved).showDay(2)
            // After a rotation the same model answers; after the system ended the app, a new one reads the saved day.
            val again = TodayViewModel(repository, settings, NetworkMonitor(context), live, savedState = SavedStateHandle(saved.keys().associateWith { saved.get<Any>(it) }))
            val state = withTimeout(10_000) { again.state.filterNotNull().first() }
            assertEquals(2, state.dayOffset)
        } finally {
            db.close()
            Dispatchers.resetMain()
        }
    }
}
