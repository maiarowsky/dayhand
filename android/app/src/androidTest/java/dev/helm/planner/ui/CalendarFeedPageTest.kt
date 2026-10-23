package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.calendar.CalendarFeed
import dev.helm.planner.ui.settings.CalendarFeedActions
import dev.helm.planner.ui.settings.CalendarFeedPage
import dev.helm.planner.ui.settings.CalendarFeedTags
import dev.helm.planner.ui.settings.CalendarFeedUiState
import dev.helm.planner.ui.settings.FeedView
import dev.helm.planner.ui.settings.IcsExport
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CalendarFeedPageTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private val url = "https://helm.example.convex.site/cal/selector0001secretsecretsecretsecretsecr.ics"
    private val feed = CalendarFeed(url, url.replace("https://", "webcal://"), "https://calendar.google.com/calendar/render?cid=x", 0)

    private class Recorder : CalendarFeedActions {
        val calls = mutableListOf<String>()
        override fun turnOn() { calls += "on" }
        override fun copy() { calls += "copy" }
        override fun openGoogle() { calls += "google" }
        override fun shareApple() { calls += "apple" }
        override fun rotate() { calls += "rotate" }
        override fun turnOff() { calls += "off" }
        override fun export() { calls += "export" }
        override fun retry() { calls += "retry" }
    }

    private fun show(state: CalendarFeedUiState, actions: CalendarFeedActions = Recorder()) {
        compose.setContent { HelmTheme { CalendarFeedPage(state, actions, onBack = {}) } }
    }

    @Test
    fun addressWithItsActions() {
        val actions = Recorder()
        show(CalendarFeedUiState(FeedView.On(feed)), actions)

        compose.onNodeWithTag(CalendarFeedTags.ADDRESS).assertTextContains(url)
        compose.onNodeWithTag(CalendarFeedTags.COPY).performClick()
        compose.onNodeWithTag(CalendarFeedTags.GOOGLE).performClick()
        compose.onNodeWithTag(CalendarFeedTags.APPLE).performScrollTo().performClick()
        compose.onNodeWithTag(CalendarFeedTags.EXPORT).performScrollTo().performClick()

        assertEquals(listOf("copy", "google", "apple", "export"), actions.calls)
    }

    @Test
    fun newAddressAndOffAreConfirmedFirst() {
        val actions = Recorder()
        show(CalendarFeedUiState(FeedView.On(feed)), actions)

        compose.onNodeWithTag(CalendarFeedTags.ROTATE).performScrollTo().performClick()
        assertEquals(emptyList<String>(), actions.calls)
        compose.onNodeWithText(text(R.string.calendar_feed_rotate_confirm)).assertIsDisplayed()
        compose.onNodeWithTag(CalendarFeedTags.CONFIRM).performClick()
        compose.onNodeWithTag(CalendarFeedTags.TURN_OFF).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.calendar_feed_off_confirm)).assertIsDisplayed()
        compose.onNodeWithTag(CalendarFeedTags.CONFIRM).performClick()

        assertEquals(listOf("rotate", "off"), actions.calls)
    }

    @Test
    fun offOffersToTurnOn() {
        val actions = Recorder()
        show(CalendarFeedUiState(FeedView.Off), actions)
        compose.onNodeWithTag(CalendarFeedTags.ADDRESS).assertDoesNotExist()
        compose.onNodeWithTag(CalendarFeedTags.TURN_ON).performClick()
        assertEquals(listOf("on"), actions.calls)
    }

    @Test
    fun withoutAServerThereIsNothingToExport() {
        show(CalendarFeedUiState(FeedView.NotConnected))
        compose.onNodeWithText(text(R.string.calendar_feed_not_connected)).assertIsDisplayed()
        compose.onNodeWithTag(CalendarFeedTags.EXPORT).assertDoesNotExist()
    }

    @Test
    fun exportInProgressDisablesTheRow() {
        show(CalendarFeedUiState(FeedView.Off, export = IcsExport.Working))
        compose.onNodeWithTag(CalendarFeedTags.EXPORT).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.calendar_feed_exporting)).assertExists()
    }
}
