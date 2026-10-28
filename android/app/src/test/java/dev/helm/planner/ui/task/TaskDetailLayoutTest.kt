package dev.helm.planner.ui.task

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import dev.helm.planner.data.local.Task
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The details of a task on a small phone (360 × 780 dp): what is read most fits on the first screen. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp")
class TaskDetailLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val task = Task(
        "task",
        title = "Test the new version of the app on the phone before the release goes out on Tuesday morning, then report",
        note = "Install it, go through Today, the calendar and the board, then check the reminders after a restart.",
        dueDate = "2026-10-26",
        createdAt = 0,
        updatedAt = 0,
    )

    private fun show(task: Task = this.task, font: HelmFont = HelmFont.Default) {
        val state = TaskDetailUiState.Ready(task, "2026-10-27", "UTC", emptyList(), HistoryState.FRESH, 0, listOf(0))
        compose.setContent { HelmTheme(Appearance(font = font)) { TaskDetailScreen(state, object : TaskDetailActions {}) } }
    }

    private fun assertFirstScreen() {
        listOf(TaskDetailTags.STATUS, TaskDetailTags.DUE, TaskDetailTags.PROJECT, TaskDetailTags.MORE).forEach { tag ->
            compose.onNodeWithTag(tag).assertIsDisplayed()
            // The test window has no status or navigation bar; a phone keeps about 48 dp for them.
            val bottom = compose.onNodeWithTag(tag).getBoundsInRoot().bottom
            assertTrue("$tag ends at $bottom, below the first screen", bottom <= 780.dp - SYSTEM_BARS)
        }
    }

    @Test fun statusDueProjectAndTheRestAreOnTheFirstScreen() {
        show()
        assertFirstScreen()
    }

    @Test fun theyStayOnTheFirstScreenInTheMonospacedFont() {
        show(font = HelmFont.Mono)
        assertFirstScreen()
    }

    @Test fun longTitleTakesTwoLinesUntilUnfolded() {
        show()
        val folded = compose.onNodeWithTag(TaskDetailTags.TITLE).getBoundsInRoot().let { it.bottom - it.top }
        assertTrue("folded title is $folded", folded <= 72.dp)
        compose.onNodeWithTag(TaskDetailTags.TITLE_MORE).performClick()
        val whole = compose.onNodeWithTag(TaskDetailTags.TITLE).getBoundsInRoot().let { it.bottom - it.top }
        assertTrue("unfolded title is $whole", whole > folded)
        compose.onNodeWithText("Show less").assertIsDisplayed()
    }

    @Test fun shortTitleHasNoUnfoldButton() {
        show(task.copy(title = "Milk"))
        compose.onNodeWithTag(TaskDetailTags.TITLE_MORE).assertDoesNotExist()
    }

    @Test fun oneProjectChipAndNoLabelsAnywhere() {
        show()
        compose.onAllNodesWithText("Label", substring = true).assertCountEquals(0)
        compose.onAllNodesWithContentDescription("Project: No project").assertCountEquals(1)
        compose.onNodeWithTag(TaskDetailTags.MORE).performClick()
        compose.onAllNodesWithText("Label", substring = true).assertCountEquals(0)
    }

    @Test fun repeatAndRemindersFoldWithTheirValuesInTheHeader() {
        show()
        compose.onNodeWithTag(TaskDetailTags.REPEAT).assertDoesNotExist()
        compose.onNodeWithText("Does not repeat", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(TaskDetailTags.MORE).performScrollTo().performClick()
        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(TaskDetailTags.REMINDERS).performScrollTo().assertIsDisplayed()
    }

    private companion object {
        val SYSTEM_BARS = 48.dp
    }
}
