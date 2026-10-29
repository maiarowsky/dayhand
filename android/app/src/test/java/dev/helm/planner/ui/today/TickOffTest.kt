package dev.helm.planner.ui.today

import android.app.Application
import android.provider.Settings
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.todaySections
import dev.helm.planner.ui.theme.HelmTheme
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Ticking a task off on Today: it is done at once, and its row stays a moment (ticked, struck through, fading) so it
 * is clear which one was tapped, then goes and the rows under it move up.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp")
class TickOffTest {
    @get:Rule val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T10:00:00Z").toEpochMilli()
    private val completed = mutableListOf<String>()

    private fun show() {
        val tasks = mutableStateOf(
            listOf(
                Task("first", title = "Water the plants", dueDate = "2026-10-22", createdAt = 1, updatedAt = 1),
                Task("second", title = "Call the plumber", dueDate = "2026-10-22", createdAt = 2, updatedAt = 2),
            ),
        )
        val actions = object : TodayActions {
            // As the repository does: the task is done in the list the screen reads right away.
            override fun complete(localId: String) {
                completed += localId
                tasks.value = tasks.value.map { if (it.localId == localId) it.copy(status = TaskStatus.DONE, completedAt = now) else it }
            }
        }
        compose.setContent {
            val state = TodayUiState(todaySections(tasks.value, now, "UTC"), ConnectionStatus.LOCAL, 0, timezone = "UTC")
            HelmTheme { TodayScreen(state, actions, now = { now }) }
        }
    }

    private fun row(id: String) = compose.onNodeWithTag(TodayTags.row(id), useUnmergedTree = true)

    @Test fun theTaskIsDoneAtOnceAndItsRowLeavesAfterItsMoment() {
        show()
        val secondAt = row("second").getBoundsInRoot().top
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Mark done: Water the plants").performClick()
        // Saved before any frame of the animation.
        assertEquals(listOf("first"), completed)
        compose.mainClock.advanceTimeBy(LeavingTasks.STRIKE_MS.toLong())
        row("first").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(LeavingTasks.LEAVE_MS + 400)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        row("first").assertDoesNotExist()
        assertTrue("the next row moved up", row("second").getBoundsInRoot().top < secondAt)
        assertEquals(listOf("first"), completed)
    }

    @Test fun withAnimationsOffTheTickedRowStaysStillForAMomentThenGoes() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        try {
            show()
            compose.mainClock.autoAdvance = false
            compose.onNodeWithContentDescription("Mark done: Water the plants").performClick()
            assertEquals(listOf("first"), completed)
            // Longer than the animated moment: the row is still there, ticked, as the confirmation.
            compose.mainClock.advanceTimeBy(LeavingTasks.LEAVE_MS + 100)
            row("first").assertIsDisplayed()
            compose.mainClock.advanceTimeBy(LeavingTasks.CONFIRM_MS)
            compose.mainClock.autoAdvance = true
            compose.waitForIdle()
            row("first").assertDoesNotExist()
        } finally {
            Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        }
    }
}
