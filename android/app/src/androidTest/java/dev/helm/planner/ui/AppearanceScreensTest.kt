package dev.helm.planner.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.ui.settings.AppearanceTags
import dev.helm.planner.ui.settings.FontScreen
import dev.helm.planner.ui.settings.PaletteScreen
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Choosing a palette or a font on the Appearance screens changes what is drawn at once. */
@RunWith(AndroidJUnit4::class)
class AppearanceScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun choosingADarkPaletteRepaintsTheScreen() {
        var appearance by mutableStateOf(Appearance(mode = ThemeMode.Dark))
        compose.setContent {
            HelmTheme(appearance, systemDark = false) {
                PaletteScreen(appearance, onChange = { appearance = it }, onBack = {})
            }
        }
        assertColor(Palettes.Terracotta.background, background())

        compose.onNodeWithTag(AppearanceTags.palette(Palettes.Nord)).performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(Palettes.Nord, appearance.darkPalette)
        compose.onNodeWithTag(AppearanceTags.palette(Palettes.Nord)).assertIsSelected()
        assertColor(Palettes.Nord.background, background())
    }

    @Test
    fun aLightPaletteShowsInLightModeOnly() {
        var appearance by mutableStateOf(Appearance(mode = ThemeMode.Light))
        compose.setContent {
            HelmTheme(appearance, systemDark = true) {
                PaletteScreen(appearance, onChange = { appearance = it }, onBack = {})
            }
        }
        assertColor(Palettes.Paper.background, background())
        compose.onNodeWithTag(AppearanceTags.palette(Palettes.SolarizedLight)).performScrollTo().performClick()
        compose.waitForIdle()
        assertColor(Palettes.SolarizedLight.background, background())

        appearance = appearance.copy(mode = ThemeMode.Dark)
        compose.waitForIdle()
        assertColor(Palettes.Terracotta.background, background())
    }

    @Test
    fun choosingAFontChangesThePreviewAndSettingsStaySans() {
        var appearance by mutableStateOf(Appearance(mode = ThemeMode.Dark))
        compose.setContent {
            HelmTheme(appearance, systemDark = true) {
                FontScreen(appearance, onChange = { appearance = it }, onBack = {})
            }
        }
        // The first of the two preview cards (dark, then light).
        val sample = compose.onAllNodesWithText(context.getString(R.string.appearance_preview_task))[0]
        val title = compose.onNodeWithText(context.getString(R.string.appearance_font))
        assertEquals(FontFamily.Default, sample.fontFamily())
        val before = sample.layout().getLineRight(0)

        compose.onNodeWithTag(AppearanceTags.font(HelmFont.Mono)).performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(HelmFont.Mono, appearance.font)
        assertEquals(HelmFont.Mono.family, sample.fontFamily())
        assertNotEquals("the preview is drawn in another font", before, sample.layout().getLineRight(0))
        // Settings themselves keep the system sans, as on Mussh.
        assertEquals(FontFamily.Default, title.fontFamily())
    }

    private fun background(): Color {
        val pixels = compose.onNodeWithTag(AppearanceTags.PALETTE_SCREEN).captureToImage().toPixelMap()
        // Bottom-left corner, in the screen margin: only the screen background is there.
        return pixels[2, pixels.height - 2]
    }

    private fun assertColor(expected: Color, actual: Color) {
        val close = abs(expected.red - actual.red) < 0.02f && abs(expected.green - actual.green) < 0.02f && abs(expected.blue - actual.blue) < 0.02f
        assertTrue("expected $expected, drawn $actual", close)
    }

    private fun SemanticsNodeInteraction.layout(): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.first()
    }

    private fun SemanticsNodeInteraction.fontFamily(): FontFamily? = layout().layoutInput.style.fontFamily
}
