package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.ui.calendar.CalendarActions
import dev.helm.planner.ui.calendar.CalendarScreen
import dev.helm.planner.ui.calendar.CalendarTags
import dev.helm.planner.ui.calendar.CalendarUiState
import dev.helm.planner.ui.calendar.HOUR_HEIGHT
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Today is Thursday 22 October 2026, 10:00; its week runs Monday 19 to Sunday 25. */
@RunWith(AndroidJUnit4::class)
class CalendarScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private fun task(id: String, due: String?, time: String? = null, block: Task.() -> Task = { this }) =
        Task(localId = id, title = "Task $id", dueDate = due, dueTime = time, createdAt = 0, updatedAt = 0).block()

    private class Recorder : CalendarActions {
        val calls = mutableListOf<String>()
        override fun move(localId: String, date: String, time: String?) { calls += "move:$localId:$date:$time" }
        override fun openTask(localId: String) { calls += "open:$localId" }
        override fun openSettings() { calls += "settings" }
    }

    private class Haptics : HapticFeedback {
        val kinds = mutableListOf<HapticFeedbackType>()
        override fun performHapticFeedback(hapticFeedbackType: HapticFeedbackType) { kinds += hapticFeedbackType }
    }

    /** A phone-wide screen (three days in the week) unless a test asks for a tablet's [width]. */
    private fun show(tasks: List<Task>, actions: CalendarActions = Recorder(), width: Dp = 400.dp, haptics: HapticFeedback = Haptics()) {
        compose.setContent {
            HelmTheme {
                CompositionLocalProvider(LocalHapticFeedback provides haptics) {
                    CalendarScreen(CalendarUiState(tasks, "2026-10-22", 600, ConnectionStatus.SYNCED, 0), actions, Modifier.requiredWidth(width))
                }
            }
        }
    }

    /** One day column on the 400 dp phone: the width less the 48 dp of hours, in three. */
    private val dayWidth = (400.dp - 48.dp) / 3

    /** Long-presses the block [key] and moves the finger by [dx], [dy] in small steps, as a finger does; it stays down. */
    private fun drag(key: String, dx: Dp, dy: Dp) {
        compose.onNodeWithTag(CalendarTags.entry(key)).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            val by = Offset(dx.toPx(), dy.toPx())
            repeat(STEPS) { moveBy(by / STEPS.toFloat()) }
        }
    }

    private fun letGo() = compose.onNodeWithTag(CalendarTags.SCREEN).performTouchInput { up() }

    @Test
    fun aPhoneShowsThreeDaysFromTodayAndTheArrowsMoveAWeek() {
        show(listOf(task("a", "2026-10-22", "09:00"), task("b", "2026-10-23"), task("c", "2026-10-29", "14:00")))

        compose.onNodeWithTag(CalendarTags.WEEK).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-22")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-24")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-21")).assertDoesNotExist()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-25")).assertIsNotDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("a@2026-10-22")).assertExists()
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-23")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.NOW_LINE).assertExists()
        compose.onNodeWithTag(CalendarTags.TODAY).assertDoesNotExist()
        compose.onNodeWithTag(CalendarTags.entry("c@2026-10-29")).assertDoesNotExist()

        // A week on: Thursday to Saturday of the next week.
        compose.onNodeWithTag(CalendarTags.NEXT).performClick()
        compose.onNodeWithTag(CalendarTags.entry("c@2026-10-29")).assertExists()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-29")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("a@2026-10-22")).assertDoesNotExist()
        compose.onNodeWithTag(CalendarTags.TODAY).performClick()
        compose.onNodeWithTag(CalendarTags.entry("a@2026-10-22")).assertExists()
        compose.onNodeWithTag(CalendarTags.TODAY).assertDoesNotExist()
    }

    @Test
    fun swipingMovesByDaysAndBack() {
        show(listOf(task("a", "2026-10-22", "09:00")))

        // A third of the screen (a day or so, and a little glide): today goes out on the left.
        compose.onNodeWithTag(CalendarTags.WEEK).performTouchInput { swipeLeft(startX = right - 10f, endX = right - width / 3f, durationMillis = 600) }
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-22")).assertDoesNotExist()
        compose.onNodeWithTag(CalendarTags.TODAY).assertIsDisplayed()

        // Nearly the whole width back: three days at most, so today and the day before are in view again.
        compose.onNodeWithTag(CalendarTags.WEEK).performTouchInput { swipeRight(startX = left + 10f, endX = right - 10f, durationMillis = 600) }
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-21")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-22")).assertIsDisplayed()
    }

    @Test
    fun aTabletShowsMondayToSunday() {
        show(listOf(task("a", "2026-10-19"), task("b", "2026-10-25")), width = 900.dp)

        (19..25).forEach { compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-$it")).assertExists() }
        compose.onNodeWithTag(CalendarTags.entry("a@2026-10-19")).assertExists()
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-25")).assertExists()
        compose.onNodeWithTag(CalendarTags.NEXT).performClick()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-26")).assertExists()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-11-01")).assertExists()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-25")).assertDoesNotExist()
    }

    @Test
    fun longTitlesBreakBetweenWordsOnly() {
        val title = "Zadzwonić do dentysty w sprawie wizyty"
        show(listOf(task("z", "2026-10-22", "09:00") { copy(title = title) }, task("r", "2026-10-23") { copy(title = "Raport kwartalny") }))

        listOf("z@2026-10-22" to title, "r@2026-10-23" to "Raport kwartalny").forEach { (key, full) ->
            val words = full.split(" ")
            val shown = compose.onNodeWithTag(CalendarTags.entry(key)).fetchSemanticsNode().config[SemanticsProperties.Text].joinToString("\n") { it.text }
            val lines = shown.split("\n")
            assertTrue(shown, lines.size in 1..2)
            // Every line is whole words of the title, the last one possibly shortened with "…": never half a word
            // followed by its other half on the next line.
            lines.forEach { line ->
                val lineWords = line.removeSuffix("…").split(" ")
                lineWords.dropLast(1).forEach { assertTrue("'$it' in '$shown'", it in words) }
                assertTrue(shown, lineWords.last() in words || line.endsWith("…"))
            }
        }
    }

    @Test
    fun backFromADayShowsThatDayInTheWeek() {
        show(emptyList())
        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        repeat(4) { compose.onNodeWithTag(CalendarTags.NEXT).performClick() }
        compose.onNodeWithTag(CalendarTags.MODE_WEEK).performClick()
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-26")).assertIsDisplayed()
    }

    @Test
    fun tapOpensTheTask() {
        val actions = Recorder()
        show(listOf(task("b", "2026-10-23")), actions)
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-23"))
            .assertHeightIsAtLeast(48.dp)
            .assertContentDescriptionContains("Task b", substring = true)
            .performClick()
        assertEquals(listOf("open:b"), actions.calls)
    }

    @Test
    fun longPressMovesAndUndoPutsItBack() {
        val actions = Recorder()
        show(listOf(task("b", "2026-10-23")), actions)

        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-23")).performTouchInput { longClick() }
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.MOVE_NO_TIME).assertIsSelected()
        compose.onNodeWithTag(CalendarTags.moveDay("2026-10-23")).assertIsSelected()
        compose.onNodeWithTag(CalendarTags.moveDay("2026-10-24")).performClick()
        compose.onNodeWithTag(CalendarTags.moveDay("2026-10-24")).assertIsSelected()
        compose.onNodeWithTag(CalendarTags.MOVE_CONFIRM).performClick()
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.calendar_undo)).performClick()

        assertEquals(listOf("move:b:2026-10-24:null", "move:b:2026-10-23:null"), actions.calls)
    }

    @Test
    fun dragMovesATaskToAnotherDayAndTimeAndUndoPutsItBack() {
        val actions = Recorder()
        val haptics = Haptics()
        show(listOf(task("a", "2026-10-22", "09:00")), actions, haptics = haptics)

        // A column on (Friday) and an hour and a quarter down: the block's top at 10:15.
        drag("a@2026-10-22", dayWidth, HOUR_HEIGHT * 1.25f)
        compose.onNodeWithTag(CalendarTags.DRAG_GUIDE).assertTextEquals("10:15")
        assertEquals(emptyList<String>(), actions.calls)
        letGo()

        assertEquals(listOf("move:a:2026-10-23:10:15"), actions.calls)
        compose.onNodeWithTag(CalendarTags.DRAG_GUIDE).assertDoesNotExist()
        assertEquals(listOf(HapticFeedbackType.LongPress, HapticFeedbackType.Confirm), haptics.kinds)
        compose.onNodeWithText(text(R.string.calendar_undo)).performClick()
        assertEquals("move:a:2026-10-22:09:00", actions.calls.last())
    }

    @Test
    fun aTaskDraggedIntoTheHoursGetsATimeAndOntoTheBandLosesIt() {
        val actions = Recorder()
        show(listOf(task("a", "2026-10-22", "09:00"), task("b", "2026-10-23")), actions)

        // From the band of tasks without a time down into the hours.
        drag("b@2026-10-23", 0.dp, 200.dp)
        letGo()
        assertTrue(actions.calls.toString(), actions.calls.single().matches(Regex("move:b:2026-10-23:\\d\\d:(00|15|30|45)")))

        // From the hours up over the band and the day's header: no time.
        drag("a@2026-10-22", 0.dp, (-100).dp)
        letGo()
        assertEquals("move:a:2026-10-22:null", actions.calls.last())
    }

    @Test
    fun holdingAtTheEdgeMovesTheDaysOn() {
        val actions = Recorder()
        show(listOf(task("a", "2026-10-22", "09:00")), actions)

        // To the right edge of the screen, held there a second: one day on (Friday to Sunday in view); then back into
        // the last column, and let go when the days have stopped. While the finger is at the edge the calendar runs
        // frames and is never idle, so the test moves the clock itself.
        drag("a@2026-10-22", dayWidth * 2.5f, 0.dp)
        compose.mainClock.autoAdvance = false
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(CalendarTags.SCREEN).performTouchInput { moveBy(Offset(-dayWidth.toPx() / 3, 0f)) }
        compose.mainClock.advanceTimeBy(800)
        letGo()
        compose.mainClock.autoAdvance = true
        assertEquals(listOf("move:a:2026-10-25:09:00"), actions.calls)
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-25")).assertIsDisplayed()
    }

    @Test
    fun aDropWhereItWasChangesNothing() {
        val actions = Recorder()
        show(listOf(task("a", "2026-10-22", "09:00")), actions)
        drag("a@2026-10-22", 0.dp, 40.dp)
        compose.onNodeWithTag(CalendarTags.SCREEN).performTouchInput { moveBy(Offset(0f, -40.dp.toPx())) }
        letGo()
        assertEquals(emptyList<String>(), actions.calls)
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertDoesNotExist()
    }

    @Test
    fun theDayViewDragsToAnotherTimeAndToTheRowWithoutATime() {
        val actions = Recorder()
        show(listOf(task("a", "2026-10-22", "09:00")), actions)
        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()

        drag("a@2026-10-22", 0.dp, HOUR_HEIGHT)
        compose.onNodeWithTag(CalendarTags.DROP_UNTIMED).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.DRAG_GUIDE).assertTextEquals("10:00")
        letGo()
        assertEquals(listOf("move:a:2026-10-22:10:00"), actions.calls)
        compose.onNodeWithTag(CalendarTags.DROP_UNTIMED).assertDoesNotExist()

        // Up onto the row that appears over the top of the day while dragging.
        val top = compose.onNodeWithTag(CalendarTags.DAY).fetchSemanticsNode().boundsInRoot.top
        val block = compose.onNodeWithTag(CalendarTags.entry("a@2026-10-22")).fetchSemanticsNode().boundsInRoot.center.y
        drag("a@2026-10-22", 0.dp, with(compose.density) { (top - block).toDp() } + 20.dp)
        letGo()
        assertEquals("move:a:2026-10-22:null", actions.calls.last())
    }

    @Test
    fun screenReadersMoveThroughTheSheet() {
        val actions = Recorder()
        show(listOf(task("b", "2026-10-23")), actions)
        val node = compose.onNodeWithTag(CalendarTags.entry("b@2026-10-23"))

        // The screen reader's long press (no finger on the screen) and its "Move" action both open the sheet.
        node.performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.moveDay("2026-10-24")).performClick()
        compose.onNodeWithTag(CalendarTags.MOVE_CONFIRM).performClick()
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertDoesNotExist()

        val move = node.fetchSemanticsNode().config[SemanticsActions.CustomActions].single()
        assertEquals(text(R.string.calendar_move_action), move.label)
        compose.runOnIdle { move.action() }
        compose.onNodeWithTag(CalendarTags.MOVE_SHEET).assertIsDisplayed()
        assertEquals(listOf("move:b:2026-10-24:null"), actions.calls)
    }

    @Test
    fun laterDatesOfASeriesOpenButDoNotMove() {
        show(listOf(task("r", "2026-10-22") { copy(repeat = RepeatRule(RepeatEvery.DAY)) }))

        compose.onNodeWithTag(CalendarTags.entry("r@2026-10-22"))
            .assert(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions))
        compose.onNodeWithTag(CalendarTags.entry("r@2026-10-23"))
            .assertContentDescriptionContains(text(R.string.calendar_state_repeat), substring = true)
            .assert(SemanticsMatcher.keyNotDefined(SemanticsActions.CustomActions))
    }

    @Test
    fun dayModeListsOverdueAndUntimedAboveTheHours() {
        show(listOf(task("late", "2026-10-20"), task("b", "2026-10-22"), task("a", "2026-10-22", "11:00")))

        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        compose.onNodeWithTag(CalendarTags.DAY).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.section_overdue, 1), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("late@2026-10-20"))
            .assertContentDescriptionContains(text(R.string.calendar_state_overdue), substring = true)
        compose.onNodeWithText(text(R.string.calendar_no_time), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-22")).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("a@2026-10-22")).assertExists()

        compose.onNodeWithTag(CalendarTags.NEXT).performClick()
        // The pager may still hold the neighbouring (also empty) day while it settles.
        compose.onAllNodesWithText(text(R.string.calendar_empty_day)).onFirst().assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-22")).assertIsNotDisplayed()
        compose.onNodeWithTag(CalendarTags.MODE_WEEK).performClick()
        compose.onNodeWithTag(CalendarTags.WEEK).assertIsDisplayed()
    }

    @Test
    fun tappingADayHeaderOpensThatDay() {
        show(listOf(task("b", "2026-10-24")))
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-24")).performClick()
        compose.onNodeWithTag(CalendarTags.DAY).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("b@2026-10-24")).assertIsDisplayed()
    }

    private companion object {
        const val STEPS = 12
    }
}
