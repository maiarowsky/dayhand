package dev.helm.planner.ui.calendar

import android.app.Application
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.theme.HelmTheme
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The days the Move sheet offers. Today is Thursday 22 October 2026: its week runs to Wednesday 28. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "pl-w360dp-h780dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MoveSheetTest {
    @get:Rule val compose = createComposeRule()

    private val today = LocalDate.parse("2026-10-22")

    private fun show(date: String) {
        val task = Task(localId = "a", title = "Task a", dueDate = date, createdAt = 0, updatedAt = 0)
        val entry = CalendarEntry(task, date, null, repeat = false, overdue = date < today.toString(), done = false)
        compose.setContent { HelmTheme { MoveSheet(entry, today, onDismiss = {}) { _, _ -> } } }
    }

    private fun offered(date: String) = compose.onNodeWithTag(CalendarTags.moveDay(date))

    @Test fun anOverdueTaskIsOfferedTodayAndTheSixDaysAfterIt() {
        show("2026-10-20")
        (22..28).forEach { offered("2026-10-$it").assertExists() }
        offered("2026-10-21").assertDoesNotExist()
        offered("2026-10-20").assertDoesNotExist()
        compose.onNodeWithTag(CalendarTags.MOVE_OTHER_DAY).assertExists()
    }

    @Test fun aLaterTaskIsOfferedTheRollingWeekItIsIn() {
        show("2026-10-30")
        offered("2026-10-30").assertIsSelected()
        listOf("2026-10-29", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04").forEach { offered(it).assertExists() }
        offered("2026-10-28").assertDoesNotExist()
        offered("2026-11-05").assertDoesNotExist()
    }
}
