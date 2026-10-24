package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.todaySections
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.QuickAddTags
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayTags
import dev.helm.planner.ui.today.TodayUiState
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Quick add with a date phrase, from typing to the row in Today: the real repository on an in-memory Room database,
 * on Thursday 22 October 2026 at 10:00 in London.
 */
@RunWith(AndroidJUnit4::class)
class QuickAddPhraseTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private var now = Instant.parse("2026-10-22T09:00:00Z").toEpochMilli()
    private val zone = "Europe/London"
    private lateinit var db: HelmDatabase
    private lateinit var repository: TaskRepository
    private var ids = 0

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        repository = TaskRepository(db, clock = { now }, newId = { "id${++ids}" })
    }

    @After
    fun tearDown() = db.close()

    private val actions = object : TodayActions {
        override fun add(title: String, dueDate: String?, dueTime: String?, note: String?) {
            runBlocking { repository.add(title, dueDate, dueTime, note) }
        }
    }

    private fun showToday() {
        compose.setContent {
            val tasks by repository.tasks.collectAsState(initial = emptyList())
            val state = TodayUiState(todaySections(tasks, now, zone), ConnectionStatus.LOCAL, 0, timezone = zone)
            HelmTheme { TodayScreen(state, actions, now = { now }) }
        }
    }

    private fun type(line: String) {
        compose.onNodeWithTag(TodayTags.FAB).performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput(line)
    }

    private fun save() {
        compose.onNodeWithTag(QuickAddTags.SAVE).performClick()
        compose.waitForIdle()
    }

    private fun saved(): Task = runBlocking { repository.tasks.first().single() }

    private fun typeAcross2pm() {
        now = Instant.parse("2026-10-22T12:59:00Z").toEpochMilli()
        showToday()
        type("Call 2pm")
        compose.onNodeWithTag(QuickAddTags.WHEN)
            .assertTextEquals(text(R.string.quick_add_from_phrase, label("2026-10-22", "14:00"), "2pm"))
        compose.runOnIdle { now = Instant.parse("2026-10-22T13:01:00Z").toEpochMilli() }
    }

    /** "Friday 23 Oct, 14:00" as the sheet writes it in the device's language. */
    private fun label(date: String, time: String?): String {
        val locale = context.resources.configuration.locales[0]
        val day = LocalDate.parse(date).format(dateFormat("EEEEdMMM", locale)).replaceFirstChar { it.titlecase(locale) }
        return time?.let { text(R.string.day_and_time, day, it) } ?: day
    }

    @Test
    fun aPhraseAtTheEndSetsTheDayAndTime() {
        showToday()
        type("Call the accountant fri 2pm")
        compose.onNodeWithTag(QuickAddTags.WHEN)
            .assertTextEquals(text(R.string.quick_add_from_phrase, label("2026-10-23", "14:00"), "fri 2pm"))
        save()

        val task = saved()
        assertEquals("Call the accountant", task.title)
        assertEquals("2026-10-23", task.dueDate)
        assertEquals("14:00", task.dueTime)
        // Friday's task is not on Thursday's Today.
        compose.onNodeWithText("Call the accountant", substring = true).assertDoesNotExist()
    }

    @Test
    fun addReadsTheClockAtSubmissionWithoutATitleEdit() {
        typeAcross2pm()
        save()

        assertEquals(listOf("Call", "2026-10-23", "14:00"), saved().let { listOf(it.title, it.dueDate, it.dueTime) })
    }

    @Test
    fun imeDoneReadsTheClockAtSubmissionWithoutATitleEdit() {
        typeAcross2pm()
        compose.onNodeWithTag(QuickAddTags.TITLE).performImeAction()
        compose.waitForIdle()

        assertEquals(listOf("Call", "2026-10-23", "14:00"), saved().let { listOf(it.title, it.dueDate, it.dueTime) })
    }

    @Test
    fun thePreviewRefreshesWithoutATitleEdit() {
        typeAcross2pm()
        compose.mainClock.advanceTimeBy(60_000)
        compose.onNodeWithTag(QuickAddTags.WHEN)
            .assertTextEquals(text(R.string.quick_add_from_phrase, label("2026-10-23", "14:00"), "2pm"))
        save()

        assertEquals(listOf("Call", "2026-10-23", "14:00"), saved().let { listOf(it.title, it.dueDate, it.dueTime) })
    }

    @Test
    fun aPhraseForTodayPutsTheRowInToday() {
        showToday()
        type("Pay the rent 5pm")
        save()

        compose.onNodeWithTag(TodayTags.TODAY).assertIsDisplayed()
        compose.onNodeWithText("17:00  Pay the rent").assertIsDisplayed()
        assertEquals("2026-10-22", saved().dueDate)
    }

    @Test
    fun keepInTitleKeepsTheWordsAndTheDayIsToday() {
        showToday()
        type("Read chapter fri")
        compose.onNodeWithTag(QuickAddTags.KEEP).performClick()
        compose.onNodeWithTag(QuickAddTags.WHEN).assertTextEquals(text(R.string.quick_add_no_phrase))
        compose.runOnIdle { now = Instant.parse("2026-10-22T13:01:00Z").toEpochMilli() }
        save()

        compose.onNodeWithText("Read chapter fri").assertIsDisplayed()
        assertEquals(listOf("Read chapter fri", "2026-10-22", null), saved().let { listOf(it.title, it.dueDate, it.dueTime) })
    }

    @Test
    fun aDayPickedUnderMoreOptionsWinsOverThePhrase() {
        showToday()
        type("Call the accountant mon 2pm")
        compose.onNodeWithText(text(R.string.quick_add_more)).performClick()
        compose.onNodeWithText(text(R.string.quick_add_tomorrow)).performClick()
        compose.onNodeWithTag(QuickAddTags.WHEN)
            .assertTextEquals(text(R.string.quick_add_from_options, label("2026-10-23", null)))
        compose.onNodeWithTag(QuickAddTags.KEEP).assertDoesNotExist()
        compose.runOnIdle { now = Instant.parse("2026-10-22T13:01:00Z").toEpochMilli() }
        save()

        assertEquals(listOf("Call the accountant mon 2pm", "2026-10-23", null), saved().let { listOf(it.title, it.dueDate, it.dueTime) })
    }

    @Test
    fun withoutAPhraseTheLineSaysToday() {
        showToday()
        type("Order a present")
        compose.onNodeWithTag(QuickAddTags.WHEN).assertTextEquals(text(R.string.quick_add_no_phrase))
        compose.onNodeWithTag(QuickAddTags.KEEP).assertDoesNotExist()
        save()

        compose.onNodeWithText("Order a present").assertIsDisplayed()
        assertEquals("2026-10-22", saved().dueDate)
    }
}
