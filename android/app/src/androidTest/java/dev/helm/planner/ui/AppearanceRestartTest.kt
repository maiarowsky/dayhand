package dev.helm.planner.ui

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.HelmApplication
import dev.helm.planner.MainActivity
import dev.helm.planner.R
import dev.helm.planner.ui.settings.AppearanceTags
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.AppearanceStore
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * The real app: palette and font picked in Settings repaint Today at once, and the choice is still there after the
 * activity is recreated and when the preferences are read again, as at the next launch.
 */
@RunWith(AndroidJUnit4::class)
class AppearanceRestartTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val store get() = (context.applicationContext as HelmApplication).container.appearance

    @Before
    fun startFromDefaultsInDarkMode() {
        store.save(Appearance(mode = ThemeMode.Dark))
    }

    @After
    fun restoreDefaults() {
        store.save(Appearance())
    }

    @Test
    fun paletteAndFontChangeAtOnceAndSurviveARestart() {
        assertColor(Palettes.Terracotta.background, screenEdge())
        assertColor(Palettes.Terracotta.surface, tabBarCorner())

        compose.onNodeWithContentDescription(context.getString(R.string.open_settings)).performClick()
        compose.onNodeWithTag(AppearanceTags.COLORS).performScrollTo().performClick()
        compose.onNodeWithTag(AppearanceTags.palette(Palettes.Dracula)).performScrollTo().performClick()
        compose.onNodeWithTag("back").performClick()
        compose.onNodeWithTag(AppearanceTags.FONT).performScrollTo().performClick()
        compose.onNodeWithTag(AppearanceTags.font(HelmFont.Atkinson)).performScrollTo().performClick()
        compose.onNodeWithTag("back").performClick()
        compose.onNodeWithTag("back").performClick()
        compose.waitForIdle()

        // Back on Today, without a restart.
        assertColor(Palettes.Dracula.background, screenEdge())
        assertColor(Palettes.Dracula.surface, tabBarCorner())
        assertEquals(HelmFont.Atkinson.family, titleFont())

        compose.activityRule.scenario.recreate()
        compose.waitForIdle()
        assertColor(Palettes.Dracula.background, screenEdge())
        assertEquals(HelmFont.Atkinson.family, titleFont())

        // What the next launch reads from storage.
        val stored = AppearanceStore(context).appearance.value
        assertEquals(Palettes.Dracula, stored.darkPalette)
        assertEquals(HelmFont.Atkinson, stored.font)
        assertEquals(ThemeMode.Dark, stored.mode)
    }

    private fun titleFont(): FontFamily? {
        val results = mutableListOf<TextLayoutResult>()
        // The header title; the tab bar's "Today" label is the second node with the same text.
        compose.onAllNodesWithText(context.getString(R.string.today_title), useUnmergedTree = true)[0]
            .fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.first().layoutInput.style.fontFamily
    }

    /** A pixel on the left edge halfway down Today, inside the screen margin: only the screen background is there. */
    private fun screenEdge(): Color {
        val pixels = compose.onRoot().captureToImage().toPixelMap()
        return pixels[4, pixels.height / 2]
    }

    /** A pixel in the bottom-left corner: the tab bar, drawn in the palette's surface colour. */
    private fun tabBarCorner(): Color {
        val pixels = compose.onRoot().captureToImage().toPixelMap()
        return pixels[4, pixels.height - 4]
    }

    private fun assertColor(expected: Color, actual: Color) {
        val close = abs(expected.red - actual.red) < 0.02f && abs(expected.green - actual.green) < 0.02f && abs(expected.blue - actual.blue) < 0.02f
        assertTrue("expected $expected, drawn $actual", close)
    }
}
