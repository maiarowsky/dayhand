package dev.helm.planner.ui.today

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.TodaySections
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Today rows carry no buttons: a long press picks tasks, and the round button's arc moves or archives every picked
 * one at once (Na dziś, Jutro, Inny dzień, Archiwum).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w400dp-h860dp")
class PickAndMoveTest {
    @get:Rule val compose = createComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Application>()
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)
    private fun count(n: Int) = context.resources.getQuantityString(R.plurals.selected_count, n, n)

    private fun task(id: String, due: String) = Task(localId = id, title = "Task $id", dueDate = due, createdAt = 0, updatedAt = 0)

    private val lateA = task("a", "2026-10-21")
    private val lateB = task("b", "2026-10-19")
    private val todayC = task("c", "2026-10-22")

    private class Recorder : TodayActions {
        val calls = mutableListOf<String>()
        override fun complete(localId: String) { calls += "complete:$localId" }
        override fun moveTo(localId: String, date: String) { calls += "move:$localId:$date" }
        override fun archive(localId: String) { calls += "archive:$localId" }
        override fun openTask(localId: String) { calls += "open:$localId" }
    }

    private fun show(actions: TodayActions = Recorder()) {
        val sections = TodaySections("2026-10-22", listOf(lateA, lateB), null, listOf(todayC), emptyList())
        compose.setContent { HelmTheme { TodayScreen(TodayUiState(sections, ConnectionStatus.SYNCED, 0), actions) } }
    }

    private fun assertPicked(n: Int) = compose.onNodeWithText(count(n)).assertIsDisplayed()

    private fun longPress(title: String) = compose.onNodeWithText(title).performTouchInput { longClick() }

    @Test fun aRowHasNoButtonsOnlyTheBoxTheTitleAndTheDate() {
        show()
        compose.onAllNodesWithText(text(R.string.move_to_today)).assertCountEquals(0)
        compose.onAllNodesWithContentDescription(text(R.string.more_actions, lateA.title)).assertCountEquals(0)
        compose.onNodeWithContentDescription(text(R.string.complete_task, lateA.title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.yesterday)).assertIsDisplayed()
    }

    @Test fun aTapOpensTheTaskAndTheBoxTicksItOff() {
        val actions = Recorder()
        show(actions)
        compose.onNodeWithText(lateA.title).performClick()
        compose.onNodeWithContentDescription(text(R.string.complete_task, todayC.title)).performClick()
        assertEquals(listOf("open:a", "complete:c"), actions.calls)
    }

    @Test fun aLongPressPicksTheTaskAndOpensTheArc() {
        show()
        longPress(lateA.title)
        assertPicked(1)
        compose.onNodeWithTag(SelectionTags.circle("a")).assertIsOn()
        compose.onNodeWithTag(SelectionTags.circle("b")).assertIsOff()
        listOf(IslandTags.TODAY, IslandTags.TOMORROW, IslandTags.OTHER_DAY, IslandTags.ARCHIVE).forEach {
            compose.onNodeWithTag(it).assertIsDisplayed()
        }
    }

    @Test fun naDzisMovesEveryPickedTaskThatIsNotOnTodayAlready() {
        val actions = Recorder()
        show(actions)
        longPress(lateA.title)
        compose.onNodeWithTag(IslandTags.SCRIM).performClick()
        compose.onNodeWithText(lateB.title).performClick()
        compose.onNodeWithText(todayC.title).performClick()
        assertPicked(3)
        compose.onNodeWithTag(TodayTags.FAB).performClick()
        compose.onNodeWithTag(IslandTags.TODAY).performClick()

        assertEquals(listOf("move:a:2026-10-22", "move:b:2026-10-22"), actions.calls)
        compose.onAllNodesWithText(count(3)).assertCountEquals(0)
        compose.onNodeWithContentDescription(text(R.string.complete_task, lateA.title)).assertIsDisplayed()
    }

    @Test fun jutroAndArchiwumActOnThePickedTasks() {
        val actions = Recorder()
        show(actions)
        longPress(todayC.title)
        compose.onNodeWithTag(IslandTags.TOMORROW).performClick()
        longPress(lateB.title)
        compose.onNodeWithTag(IslandTags.ARCHIVE).performClick()
        assertEquals(listOf("move:c:2026-10-23", "archive:b"), actions.calls)
    }

    @Test fun selectOverduePicksAllOverdueAndCloseEndsPicking() {
        show()
        longPress(todayC.title)
        compose.onNodeWithTag(IslandTags.SCRIM).performClick()
        compose.onNodeWithText(text(R.string.select_overdue)).performClick()
        assertPicked(3)
        compose.onNodeWithTag(SelectionTags.CLEAR).performClick()
        compose.onAllNodesWithText(count(3)).assertCountEquals(0)
        compose.onNodeWithContentDescription(text(R.string.complete_task, todayC.title)).assertIsDisplayed()
    }

    @Test fun withNothingPickedTheRoundButtonAddsATask() {
        show()
        compose.onNodeWithContentDescription(text(R.string.add_task)).performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).assertIsDisplayed()
    }

    @Test fun inyDzienAsksForTheDay() {
        show()
        longPress(lateA.title)
        compose.onNodeWithTag(IslandTags.OTHER_DAY).performClick()
        compose.onNodeWithText(text(R.string.ok)).assertIsDisplayed()
        assertPicked(1)
    }

    @Config(qualifiers = "en-w320dp-h700dp")
    @Test fun onANarrowScreenTheOptionsStandInAColumnAndStillWork() {
        val actions = Recorder()
        show(actions)
        longPress(lateA.title)
        compose.onNodeWithText(text(R.string.move_to_tomorrow)).assertIsDisplayed()
        compose.onNodeWithTag(IslandTags.TOMORROW).performClick()
        assertEquals(listOf("move:a:2026-10-23"), actions.calls)
    }
}
