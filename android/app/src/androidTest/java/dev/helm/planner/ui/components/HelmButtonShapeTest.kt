package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.theme.Palette
import dev.helm.planner.ui.theme.palette
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Every button drawn in Mussh's Send shape: a filled 34 dp pill without an outline, round at its ends. */
@RunWith(AndroidJUnit4::class)
class HelmButtonShapeTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var colors: Palette
    private var density = 1f

    private fun show(tone: ButtonTone, text: String? = "Save", enabled: Boolean = true) {
        compose.setContent {
            HelmTheme {
                colors = palette
                density = LocalDensity.current.density
                Box(Modifier.testTag(BOX).background(palette.background).padding(8.dp)) {
                    HelmButton(text, {}, tone = tone, enabled = enabled, icon = if (text == null) Icons.AutoMirrored.Filled.KeyboardArrowRight else null, description = if (text == null) "Next" else null)
                }
            }
        }
    }

    private class Fill(val xs: IntRange, val ys: IntRange, val pixels: IntArray, val width: Int)

    /** Where the pixels are exactly [color]: the pill's flat inside. */
    private fun fill(color: Color): Fill {
        val image = compose.onNodeWithTag(BOX).captureToImage()
        val pixels = IntArray(image.width * image.height).also { image.readPixels(it) }
        val at = pixels.indices.filter { pixels[it] == color.toArgb() }
        assertTrue("no pixel of the fill", at.isNotEmpty())
        return Fill(at.minOf { it % image.width }..at.maxOf { it % image.width }, at.minOf { it / image.width }..at.maxOf { it / image.width }, pixels, image.width)
    }

    /** About 34 dp, give or take the antialiased edge. */
    private fun assertAbout34dp(range: IntRange) {
        val dp = (range.last - range.first + 1) / density
        assertTrue("the fill is $dp dp across", abs(dp - 34f) <= 1.5f)
    }

    @Test fun aTextButtonIsARoundEnded34dpPillWithoutAnOutline() {
        show(ButtonTone.Accent)
        val fill = fill(colors.accent)
        assertAbout34dp(fill.ys)
        assertTrue((fill.xs.last - fill.xs.first) / density >= 48f)
        // Round ends: the corner of the fill's box is the screen behind it. No outline: just above the flat top is
        // the background.
        assertNotEquals(colors.accent.toArgb(), fill.pixels[fill.ys.first * fill.width + fill.xs.first])
        val middle = (fill.xs.first + fill.xs.last) / 2
        assertEquals(colors.background.toArgb(), fill.pixels[(fill.ys.first - 2) * fill.width + middle])
    }

    @Test fun anIconButtonIsA34dpCircle() {
        show(ButtonTone.Quiet, text = null)
        val fill = fill(colors.surfaceRaised)
        assertAbout34dp(fill.ys)
        assertAbout34dp(fill.xs)
    }

    @Test fun aDisabledButtonKeepsItsShapeOnTheRaisedColour() {
        show(ButtonTone.Accent, enabled = false)
        assertAbout34dp(fill(colors.surfaceRaised).ys)
    }

    private companion object {
        const val BOX = "box"
    }
}
