package dev.helm.planner.ui

import android.app.Application
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.R
import dev.helm.planner.ui.calendar.CalendarActions
import dev.helm.planner.ui.calendar.CalendarScreen
import dev.helm.planner.ui.calendar.CalendarTags
import dev.helm.planner.ui.calendar.CalendarUiState
import dev.helm.planner.ui.components.HelmTabBar
import dev.helm.planner.ui.components.HelmTabItem
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.domain.daySections
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.SearchTags
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayTags
import dev.helm.planner.ui.today.TodayUiState
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

/** The tab bar, Today's header and the calendar's days at the largest system font size (2.0) on a phone held upright. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "pl-w360dp-h780dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LargeTextTest {
    @get:Rule val compose = createComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val tabs = listOf(R.string.today_title, R.string.calendar_title, R.string.board_title, R.string.projects_title)
        .map { context.getString(it) }

    private fun show(scale: Float, content: @Composable () -> Unit) {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale)) { HelmTheme { content() } }
        }
    }

    @Composable
    private fun tabBar() = HelmTabBar(
        tabs.mapIndexed { i, label -> HelmTabItem(label, if (i == 1) Icons.Filled.DateRange else Icons.Filled.Home, i == 1, "tab-$i") {} },
    )

    /** How a text node was laid out. */
    private fun layout(text: String): androidx.compose.ui.text.TextLayoutResult {
        val node = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
        val results = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        node.config[androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.single()
    }

    /** The lines a text node was laid out in. */
    private fun lines(text: String): Int = layout(text).lineCount

    /** [text] on one line and whole: not cut short, not running past its box. */
    private fun assertWholeOnOneLine(text: String) {
        val result = layout(text)
        assertEquals(text, 1, result.lineCount)
        assertFalse("$text ellipsized", result.isLineEllipsized(0))
        assertFalse("$text overflows", result.hasVisualOverflow)
    }

    @Test fun atTheUsualSizeEveryTabHasItsLabelOnOneLine() {
        show(1f) { tabBar() }
        tabs.forEach { assertEquals(it, 1, lines(it)) }
    }

    @Test fun atTwiceTheSizeTheTabsShowIconsNamedForAScreenReader() {
        show(2f) { tabBar() }
        tabs.forEachIndexed { i, label ->
            compose.onNodeWithText(label, useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("tab-$i").assertContentDescriptionEquals(label)
        }
    }

    private fun calendar(scale: Float) = show(scale) {
        CalendarScreen(
            CalendarUiState(emptyList(), "2026-11-22", 600, ConnectionStatus.SYNCED, 0),
            object : CalendarActions {
                override fun move(localId: String, date: String, time: String?) {}
                override fun openTask(localId: String) {}
                override fun openSettings() {}
            },
            dayWhenNarrow = true,
        )
    }

    /** The weekday shown over [date] in the day view's row of dates. */
    private fun weekday(date: String): String =
        compose.onNodeWithTag(CalendarTags.dayHeader(date)).fetchSemanticsNode().config
            .getOrNull(SemanticsProperties.Text).orEmpty().first().text

    @Test fun atTwiceTheSizeTheDayRowUsesOneLetterWeekdaysThatFit() {
        calendar(2f)
        compose.onNodeWithTag(CalendarTags.DAY).fetchSemanticsNode()
        // Sunday 22 November: the row runs from today to Saturday, every weekday one letter.
        (22..28).forEach { assertEquals("2026-11-$it", 1, weekday("2026-11-$it").length) }
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-11-16")).assertDoesNotExist()
    }

    @Test fun atTheUsualSizeTheDayRowKeepsTheShortWeekdays() {
        calendar(1f)
        assertEquals("niedz.", weekday("2026-11-22"))
        assertTrue(weekday("2026-11-23").length > 1)
    }

    @Test fun atTwiceTheSizeTheTodayButtonFitsWithTheScreenMarginOnItsRight() {
        calendar(2f)
        val button = compose.onNodeWithTag(CalendarTags.TODAY).getUnclippedBoundsInRoot()
        val screen = compose.onRoot().getUnclippedBoundsInRoot()
        assertTrue("left ${button.left}", button.left >= screen.left)
        assertTrue("right ${button.right} of ${screen.right}", screen.right - button.right >= 16.dp)
        assertEquals(1, lines(context.getString(R.string.calendar_go_today)))
    }

    private val sunday = java.time.Instant.parse("2026-11-22T08:00:00Z").toEpochMilli()

    private fun todayScreen(scale: Float, offset: Int = 0) = show(scale) {
        TodayScreen(
            TodayUiState(daySections(emptyList(), sunday, "UTC", offset), ConnectionStatus.LOCAL, 0, timezone = "UTC", dayOffset = offset),
            object : TodayActions {},
            now = { sunday },
        )
    }

    @Test fun atTwiceTheSizeTodayKeepsItsTitleOnOneLineAndSearchesFromTheMenu() {
        todayScreen(2f)
        assertWholeOnOneLine("Dzisiaj")
        compose.onNodeWithContentDescription(context.getString(R.string.search_tasks)).assertDoesNotExist()
        compose.onNodeWithTag(TodayTags.MENU).performClick()
        compose.onNodeWithText(context.getString(R.string.open_settings)).assertExists()
        compose.onNodeWithText(context.getString(R.string.search_tasks)).performClick()
        compose.onNodeWithTag(SearchTags.SHEET).assertExists()
    }

    /** Monday 30 November, eight days on, below large text: the magnifier and Settings still buttons of their own. */
    private fun longestWeekdayBesideTheMagnifier(scale: Float) {
        todayScreen(scale, offset = 8)
        compose.onNodeWithTag(TodayTags.MENU).assertDoesNotExist()
        compose.onNodeWithTag(SearchTags.OPEN).assertExists()
        assertWholeOnOneLine("Poniedziałek")
    }

    @Test fun atALittleLargerTextTheLongestWeekdayStaysWhole() = longestWeekdayBesideTheMagnifier(1.15f)

    @Test fun atLargerTextTheLongestWeekdayStaysWhole() = longestWeekdayBesideTheMagnifier(1.3f)

    @Test fun atTwiceTheSizeTheLongestWeekdayStaysOnOneLine() {
        // Monday 30 November, eight days on.
        todayScreen(2f, offset = 8)
        assertWholeOnOneLine("Poniedziałek")
    }

    @Test fun atTheUsualSizeSearchAndSettingsAreButtonsOfTheirOwn() {
        todayScreen(1f)
        compose.onNodeWithTag(TodayTags.MENU).assertDoesNotExist()
        compose.onNodeWithContentDescription(context.getString(R.string.search_tasks)).assertExists()
        compose.onNodeWithContentDescription(context.getString(R.string.open_settings)).assertExists()
    }

    @Test fun atTheUsualSizeALongHeaderTitleWrapsWhole() {
        val name = "Remont mieszkania na Mokotowie przed zimą 2027"
        // A project's header: back, edit and more beside its name.
        show(1f) {
            LargeHeader(name, onBack = {}) {
                HeaderIconButton(Icons.Filled.Edit, "edit", {})
                HeaderIconButton(Icons.Filled.MoreVert, "more", {})
            }
        }
        val result = layout(name)
        assertTrue("lines ${result.lineCount}", result.lineCount > 1)
        assertFalse(result.isLineEllipsized(result.lineCount - 1))
        assertFalse(result.hasVisualOverflow)
    }

    @Test fun onASundayTheWeekStartsThatSundayNotTheMondayBefore() {
        calendar(1f)
        compose.onNodeWithTag(CalendarTags.MODE_WEEK).performClick()
        (22..28).forEach { compose.onNodeWithTag(CalendarTags.dayHeader("2026-11-$it")).assertExists() }
        compose.onNodeWithTag(CalendarTags.dayHeader("2026-11-21")).assertDoesNotExist()
    }
}
