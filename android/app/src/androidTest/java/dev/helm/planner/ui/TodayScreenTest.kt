package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.TodaySections
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.QuickAddTags
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayTags
import dev.helm.planner.ui.today.TodayUiState
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TodayScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val now = Instant.parse("2026-10-22T09:00:00Z").toEpochMilli()
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private fun task(id: String, due: String?, time: String? = null, block: Task.() -> Task = { this }) =
        Task(localId = id, title = "Task $id", dueDate = due, dueTime = time, createdAt = 0, updatedAt = 0).block()

    private fun sections(
        overdue: List<Task> = emptyList(),
        now: Task? = null,
        today: List<Task> = emptyList(),
        done: List<Task> = emptyList(),
    ) = TodaySections("2026-10-22", overdue, now, today, done)

    private class Recorder : TodayActions {
        val calls = mutableListOf<String>()
        override fun complete(localId: String) { calls += "complete:$localId" }
        override fun moveTo(localId: String, date: String) { calls += "move:$localId:$date" }
        override fun add(title: String, dueDate: String?, dueTime: String?, note: String?) { calls += "add:$title:$dueDate:$dueTime" }
        override fun openSettings() { calls += "settings" }
        override fun openTask(localId: String) { calls += "open:$localId" }
        override fun removeSample() { calls += "sample:remove" }
    }

    private fun show(state: TodayUiState, actions: TodayActions = Recorder()) {
        compose.setContent { HelmTheme { TodayScreen(state, actions, now = { now }) } }
    }

    @Test
    fun emptyStateHasOneSentenceAndAnAddButton() {
        show(TodayUiState(sections(), ConnectionStatus.SYNCED, 0))
        compose.onNodeWithTag(TodayTags.EMPTY).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.empty_today)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.add_task)).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun overdueSectionShowsCountAndActions() {
        val actions = Recorder()
        val late = task("a", "2026-10-21")
        show(TodayUiState(sections(overdue = listOf(late, task("b", "2026-10-19"))), ConnectionStatus.SYNCED, 0), actions)

        compose.onNodeWithTag(TodayTags.OVERDUE).assertTextContains(text(R.string.section_overdue, 2), ignoreCase = true)
        compose.onNodeWithText(text(R.string.yesterday)).assertIsDisplayed()
        compose.onNodeWithContentDescription(text(R.string.move_to_today_described, late.title)).performClick()
        compose.onNodeWithContentDescription(text(R.string.complete_task, late.title)).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithContentDescription(text(R.string.more_actions, late.title)).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText(text(R.string.archive)).assertIsDisplayed()

        assertEquals(listOf("move:a:2026-10-22", "complete:a"), actions.calls)
    }

    @Test
    fun nowTaskShowsWhereIStoppedUnderItsTitle() {
        val now = task("n", "2026-10-22") { copy(isNow = true, status = TaskStatus.DOING, resumeNote = "Draft is in docs/week.md") }
        show(TodayUiState(sections(now = now, today = listOf(task("t", "2026-10-22", "09:00"))), ConnectionStatus.SYNCED, 0))

        compose.onNodeWithTag(TodayTags.NOW).assertIsDisplayed()
        compose.onNodeWithText("Task n").assertIsDisplayed()
        compose.onNodeWithText("Draft is in docs/week.md").assertIsDisplayed()
        compose.onNodeWithText("09:00  Task t").assertIsDisplayed()
    }

    @Test
    fun nowTaskWithoutNoteInvitesOne() {
        val now = task("n", "2026-10-22") { copy(isNow = true, status = TaskStatus.DOING) }
        show(TodayUiState(sections(now = now), ConnectionStatus.SYNCED, 0))
        compose.onNodeWithText(text(R.string.resume_empty)).assertIsDisplayed().performClick()
        compose.onNodeWithText(text(R.string.resume_label)).assertIsDisplayed()
    }

    @Test
    fun doneSectionIsCollapsedByDefault() {
        val done = task("d", "2026-10-22") { copy(status = TaskStatus.DONE, completedAt = 1) }
        show(TodayUiState(sections(today = listOf(task("t", "2026-10-22")), done = listOf(done)), ConnectionStatus.SYNCED, 0))

        compose.onNodeWithTag(TodayTags.DONE).assertTextContains(text(R.string.section_done, 1), ignoreCase = true)
        compose.onNodeWithText("Task d").assertDoesNotExist()
        compose.onNodeWithTag(TodayTags.DONE).performClick()
        compose.onNodeWithText("Task d").assertIsDisplayed()
    }

    @Test
    fun offlineBannerTellsHowManyChangesWait() {
        show(TodayUiState(sections(today = listOf(task("t", "2026-10-22"))), ConnectionStatus.OFFLINE, 2))
        compose.onNodeWithTag(TodayTags.STATUS).assertTextContains(context.resources.getQuantityString(R.plurals.status_offline, 2, 2))
    }

    @Test
    fun bannerThatAppearsLaterIsOnScreenWithALongList() {
        val tasks = (1..30).map { task("t$it", "2026-10-22") }
        var state by mutableStateOf(TodayUiState(sections(today = tasks), ConnectionStatus.SYNCED, 0))
        compose.setContent { HelmTheme { TodayScreen(state, Recorder(), now = { now }) } }
        compose.waitForIdle()
        state = state.copy(connection = ConnectionStatus.OFFLINE)
        compose.onNodeWithTag(TodayTags.STATUS).assertIsDisplayed()
    }

    @Test
    fun onThisPhoneOnlyIsNotAWarning() {
        // Changes queue up for a server that may never come; nothing is said about them.
        show(TodayUiState(sections(today = listOf(task("t", "2026-10-22"))), ConnectionStatus.LOCAL, 5))
        compose.onNodeWithTag(TodayTags.STATUS).assertDoesNotExist()
        compose.onNodeWithTag(TodayTags.SAMPLE).assertDoesNotExist()
    }

    @Test
    fun sampleTasksSaySoAndGoWithOneTap() {
        val actions = Recorder()
        show(TodayUiState(sections(today = listOf(task("sample-1", "2026-10-22"))), ConnectionStatus.LOCAL, 0, sample = true), actions)
        compose.onNodeWithTag(TodayTags.SAMPLE).assertTextContains(text(R.string.sample_banner), substring = true)
        compose.onNodeWithText(text(R.string.sample_remove)).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("sample:remove"), actions.calls)
    }

    @Test
    fun quickAddSavesWithOneTapForToday() {
        val actions = Recorder()
        show(TodayUiState(sections(), ConnectionStatus.SYNCED, 0), actions)
        compose.onNodeWithTag(TodayTags.FAB).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput("Order a present")
        compose.onNodeWithTag(QuickAddTags.SAVE).performClick()
        compose.waitForIdle()
        assertEquals(listOf("add:Order a present:2026-10-22:null"), actions.calls)
    }

    @Test
    fun tappingATaskOpensItsDetails() {
        val actions = Recorder()
        show(TodayUiState(sections(today = listOf(task("t", "2026-10-22"))), ConnectionStatus.SYNCED, 0), actions)
        compose.onNodeWithText("Task t").assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("open:t"), actions.calls)
    }
}
