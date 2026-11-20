package dev.helm.planner.ui.today

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.TodaySections
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The round button's options, in each language's own words, stay on screen and apart: a tap anywhere on an option's
 * label runs that option and no other, whether the labels stand in the arc or fall back to a column.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class)
class ArcOptionsLayoutTest {
    @get:Rule val compose = createComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Application>()
    private fun text(@StringRes id: Int) = context.getString(id)

    private val late = Task(localId = "a", title = "Task a", dueDate = "2026-10-21", createdAt = 0, updatedAt = 0)

    private class Recorder : TodayActions {
        val calls = mutableListOf<String>()
        override fun complete(localId: String) { calls += "complete:$localId" }
        override fun moveTo(localId: String, date: String) { calls += "move:$localId:$date" }
        override fun archive(localId: String) { calls += "archive:$localId" }
        override fun openTask(localId: String) { calls += "open:$localId" }
    }

    private val options = listOf(
        R.string.move_to_today to "move:a:2026-10-22",
        R.string.move_to_tomorrow to "move:a:2026-10-23",
        R.string.move_to_day to null,
        R.string.archive to "archive:a",
    )

    private fun labelBounds(@StringRes id: Int): Rect =
        compose.onNode(hasText(text(id)), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot

    private fun tap(point: Offset) = compose.onRoot().performTouchInput { click(point) }

    private fun everyLabelStaysOnScreenAndRunsItsOwnOption() {
        val actions = Recorder()
        val sections = TodaySections("2026-10-22", listOf(late), null, emptyList(), emptyList())
        compose.setContent { HelmTheme { TodayScreen(TodayUiState(sections, ConnectionStatus.SYNCED, 0), actions) } }
        compose.onNodeWithText(late.title).performTouchInput { longClick() }

        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        val labels = options.map { labelBounds(it.first) }
        labels.forEach { label ->
            assertTrue("$label is not inside $root", label.left >= root.left && label.right <= root.right && label.top >= root.top)
        }
        labels.forEachIndexed { i, a -> labels.drop(i + 1).forEach { b -> assertFalse("$a overlaps $b", a.overlaps(b)) } }

        options.forEachIndexed { index, (id, call) ->
            val label = labels[index]
            listOf(Offset(label.left + 1f, label.center.y), label.center, Offset(label.right - 1f, label.center.y)).forEach { point ->
                if (compose.onAllNodesWithTag(IslandTags.TODAY).fetchSemanticsNodes().isEmpty()) {
                    compose.onNodeWithTag(TodayTags.FAB).performClick()
                }
                tap(point)
                if (call == null) {
                    compose.onNodeWithText(text(R.string.cancel)).performClick()
                } else {
                    assertEquals("tap at $point on ${text(id)}", call, actions.calls.removeLastOrNull())
                    compose.onNodeWithText(late.title).performTouchInput { longClick() }
                }
            }
        }
        assertTrue(actions.calls.isEmpty())
    }

    @Config(qualifiers = "en-w400dp-h860dp")
    @Test fun english() = everyLabelStaysOnScreenAndRunsItsOwnOption()

    @Config(qualifiers = "pl-w400dp-h860dp")
    @Test fun polish() = everyLabelStaysOnScreenAndRunsItsOwnOption()

    @Config(qualifiers = "fr-w400dp-h860dp")
    @Test fun french() = everyLabelStaysOnScreenAndRunsItsOwnOption()

    @Config(qualifiers = "de-w400dp-h860dp")
    @Test fun german() = everyLabelStaysOnScreenAndRunsItsOwnOption()
}
