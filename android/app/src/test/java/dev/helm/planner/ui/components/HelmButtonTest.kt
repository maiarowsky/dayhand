package dev.helm.planner.ui.components

import android.app.Application
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmButtonShape
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.theme.Palettes
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Every button in Mussh's Send shape keeps a 48 dp touch target and readable text in every tone. The drawn 34 dp pill
 * is checked on a device (androidTest `HelmButtonShapeTest`): Robolectric does not capture this window's pixels.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp")
class HelmButtonTest {
    @get:Rule val compose = createComposeRule()

    @Test fun aTextButtonAndAnIconButtonAreTouchTargetsOf48dp() {
        compose.setContent {
            HelmTheme {
                androidx.compose.foundation.layout.Column {
                    HelmButton("Save", {}, tone = ButtonTone.Accent)
                    HelmButton(null, {}, tone = ButtonTone.Quiet, icon = Icons.AutoMirrored.Filled.KeyboardArrowRight, description = "Next")
                }
            }
        }
        compose.onNodeWithText("Save").assertWidthIsAtLeast(HelmButtonShape.touchTarget).assertHeightIsEqualTo(HelmButtonShape.touchTarget)
        compose.onNodeWithContentDescription("Next").assertWidthIsAtLeast(48.dp).assertHeightIsEqualTo(48.dp)
    }

    @Test fun everyToneIsReadableOnEveryPalette() {
        Palettes.all.forEach { p ->
            ButtonTone.entries.forEach { tone -> assertReadable("${p.id} $tone", tone.content(p), tone.fill(p)) }
        }
    }

    private fun assertReadable(what: String, fg: Color, bg: Color) {
        val (light, dark) = listOf(fg.luminance(), bg.luminance()).sortedDescending()
        val ratio = (light + 0.05) / (dark + 0.05)
        // 0.01 below 4.5:1 absorbs the rounding PaletteContrastTest allows too.
        assertTrue("$what is %.2f:1".format(ratio), ratio >= 4.5 - 0.01)
    }
}
