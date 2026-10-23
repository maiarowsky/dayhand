package dev.helm.planner.tour

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.calendar.CalendarFeed
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.ui.calendar.CalendarActions
import dev.helm.planner.ui.calendar.CalendarScreen
import dev.helm.planner.ui.calendar.CalendarTags
import dev.helm.planner.ui.calendar.CalendarUiState
import dev.helm.planner.ui.calendar.HOUR_HEIGHT
import dev.helm.planner.ui.settings.CalendarFeedActions
import dev.helm.planner.ui.settings.CalendarFeedPage
import dev.helm.planner.ui.settings.CalendarFeedUiState
import dev.helm.planner.ui.settings.FeedView
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The calendar (week, day, moving and dragging a task, a day's tasks from the week of bars) and Settings → Calendar;
 * see [ScreenTour]. Sample data is Polish. Run upright and on its side: upright the week is bars, on its side titles.
 */
@RunWith(AndroidJUnit4::class)
class CalendarTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()

    private fun show(content: @Composable () -> Unit) {
        if (config.landscape) turnToLandscape()
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config, content) }
        compose.waitForIdle()
    }

    /** On its side (the emulator's own rotation setting does not hold from one test's activity to the next). */
    private fun turnToLandscape() {
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        val until = System.currentTimeMillis() + ROTATION_TIMEOUT_MS
        while (compose.activity.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE) {
            check(System.currentTimeMillis() < until) { "the activity did not turn" }
            Thread.sleep(100)
        }
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    private fun task(id: String, title: String, due: String, time: String? = null, block: Task.() -> Task = { this }) =
        Task(localId = id, title = title, dueDate = due, dueTime = time, createdAt = 0, updatedAt = 0).block()

    private val tasks = listOf(
        task("a", "Podlać kwiaty", "2026-10-20"),
        task("b", "Zadzwonić do dentysty", "2026-10-22", "09:30"),
        task("c", "Przegląd tygodnia", "2026-10-22", "11:00"),
        task("d", "Kupić chleb", "2026-10-22"),
        task("e", "Raport kwartalny", "2026-10-23", "10:00"),
        task("f", "Basen", "2026-10-21", "18:00") { copy(repeat = RepeatRule(RepeatEvery.WEEK, 1, listOf(3, 5))) },
        task("g", "Poranny bieg", "2026-10-22", "07:00") { copy(status = TaskStatus.DONE, completedAt = 1) },
        task("h", "Urodziny Ani", "2026-10-24"),
        task("i", "Spotkanie z księgową", "2026-10-22", "11:30"),
    )

    @Test
    fun calendar() {
        show { CalendarScreen(CalendarUiState(tasks, "2026-10-22", 10 * 60 + 15, ConnectionStatus.SYNCED, 0), object : CalendarActions {}) }
        shot("50-calendar-week")
        compose.onNodeWithTag(CalendarTags.entry("e@2026-10-23")).performTouchInput { longClick() }
        shot("51-calendar-move")
        compose.onNodeWithTag(CalendarTags.moveDay("2026-10-24")).performClick()
        compose.onNodeWithTag(CalendarTags.MOVE_CONFIRM).performClick()
        shot("52-calendar-moved")
        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        shot("53-calendar-day")
    }

    /** Moves change the sample tasks, as Room would, so the drop is seen where it landed. */
    private class Live(initial: List<Task>) : CalendarActions {
        var tasks by mutableStateOf(initial)
        override fun move(localId: String, date: String, time: String?) {
            tasks = tasks.map { if (it.localId == localId) it.copy(dueDate = date, dueTime = time) else it }
        }
    }

    /** Long-presses [key] and moves the finger by [by] pixels in steps; the finger stays down. */
    private fun lift(key: String, by: (Float) -> Offset) {
        compose.onNodeWithTag(CalendarTags.entry(key)).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            val total = by(HOUR_HEIGHT.toPx())
            repeat(STEPS) { moveBy(total / STEPS.toFloat()) }
        }
    }

    private fun moveFinger(by: (Float) -> Offset) = compose.onNodeWithTag(CalendarTags.SCREEN).performTouchInput {
        val total = by(HOUR_HEIGHT.toPx())
        repeat(STEPS) { moveBy(total / STEPS.toFloat()) }
    }

    /** Scrolls the hours inside [view] so that the task [key] is [at] its height. */
    private fun centre(key: String, view: String, at: Float = 0.5f) {
        val hours = compose.onAllNodes(hasScrollAction() and hasAnyAncestor(hasTestTag(view))).onFirst()
        val page = hours.fetchSemanticsNode().boundsInRoot
        val task = compose.onNodeWithTag(CalendarTags.entry(key)).fetchSemanticsNode().boundsInRoot
        hours.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, task.center.y - (page.top + page.height * at)) }
    }

    private fun letGo() = compose.onNodeWithTag(CalendarTags.SCREEN).performTouchInput { up() }

    @Test
    fun drag() {
        val live = Live(tasks)
        show { CalendarScreen(CalendarUiState(live.tasks, "2026-10-22", 10 * 60 + 15, ConnectionStatus.SYNCED, 0), live) }
        val day = compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-24")).fetchSemanticsNode().boundsInRoot.left -
            compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-23")).fetchSemanticsNode().boundsInRoot.left
        // "Raport kwartalny" (Friday 10:00) a day on and two hours and a quarter later (12:15). On its side the hours
        // show barely more than an hour, all of it near an edge that scrolls them: the task is brought to their middle
        // and only goes a day on (10:00).
        val down = if (config.landscape) 0f else 2.25f
        if (config.landscape) centre("e@2026-10-23", CalendarTags.WEEK)
        lift("e@2026-10-23") { hour -> Offset(day, hour * down) }
        shot("55-calendar-drag")
        // Up over Saturday's header: no time.
        val header = compose.onNodeWithTag(CalendarTags.dayHeader("2026-10-24")).fetchSemanticsNode().boundsInRoot.center.y
        val block = compose.onNodeWithTag(CalendarTags.entry("e@2026-10-23")).fetchSemanticsNode().boundsInRoot.center.y
        moveFinger { hour -> Offset(0f, header - block - hour * down) }
        shot("56-calendar-drag-untimed")
        moveFinger { hour -> Offset(0f, block - header + hour * down) }
        letGo()
        shot("57-calendar-dropped")
        compose.mainClock.advanceTimeBy(SNACKBAR_GONE_MS)
        // On its side the day's hours are too short to drag in.
        if (config.landscape) return

        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        // The task in the middle of the day's page, away from the edges that scroll it.
        compose.onNodeWithTag(CalendarTags.entry("c@2026-10-22")).performScrollTo()
        centre("c@2026-10-22", CalendarTags.DAY, at = 0.4f)
        // "Przegląd tygodnia" (11:00) an hour later, with the row for "no time" over the top of the day.
        lift("c@2026-10-22") { hour -> Offset(0f, hour) }
        shot("58-calendar-day-drag")
        letGo()
    }

    /** Upright only: a long press on a day of bars lists its tasks (on its side the week has titles and no such sheet). */
    @Test
    fun daySheet() {
        show { CalendarScreen(CalendarUiState(tasks, "2026-10-22", 10 * 60 + 15, ConnectionStatus.SYNCED, 0), object : CalendarActions {}) }
        val band = compose.onAllNodesWithTag(CalendarTags.untimedBars("2026-10-22"))
        assumeTrue(band.fetchSemanticsNodes().isNotEmpty())
        band.onFirst().performTouchInput { longClick() }
        shot("59-calendar-day-sheet")
    }

    @Test
    fun feed() {
        val url = "https://helm-example.convex.site/cal/Ab3dEf6hIj9k" + "x".repeat(32) + ".ics"
        val feed = CalendarFeed(url, url.replace("https://", "webcal://"), "https://calendar.google.com/calendar/render?cid=x", 0)
        show { CalendarFeedPage(CalendarFeedUiState(FeedView.On(feed)), object : CalendarFeedActions {}, onBack = {}) }
        shot("54-calendar-feed")
    }

    private companion object {
        const val STEPS = 12
        const val ROTATION_TIMEOUT_MS = 5_000L

        /** A long snackbar (the drop's Undo) is gone after 10 s. */
        const val SNACKBAR_GONE_MS = 11_000L
    }
}
