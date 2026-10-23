package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
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
import dev.helm.planner.ui.settings.CalendarFeedActions
import dev.helm.planner.ui.settings.CalendarFeedPage
import dev.helm.planner.ui.settings.CalendarFeedUiState
import dev.helm.planner.ui.settings.FeedView
import dev.helm.planner.ui.today.ConnectionStatus
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The calendar (week, day, moving a task) and Settings → Calendar; see [ScreenTour]. Sample data is Polish. */
@RunWith(AndroidJUnit4::class)
class CalendarTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()

    private fun show(content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config, content) }
        compose.waitForIdle()
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

    @Test
    fun feed() {
        val url = "https://helm-example.convex.site/cal/Ab3dEf6hIj9k" + "x".repeat(32) + ".ics"
        val feed = CalendarFeed(url, url.replace("https://", "webcal://"), "https://calendar.google.com/calendar/render?cid=x", 0)
        show { CalendarFeedPage(CalendarFeedUiState(FeedView.On(feed)), object : CalendarFeedActions {}, onBack = {}) }
        shot("54-calendar-feed")
    }
}
