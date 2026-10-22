package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.ui.settings.FontScreen
import dev.helm.planner.ui.settings.LicensesScreen
import dev.helm.planner.ui.settings.PaletteScreen
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Screenshots of the Appearance pages, which exist only after the design-system change. */
@RunWith(AndroidJUnit4::class)
class AppearanceTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()
    private val appearance = Appearance(
        mode = if (config.dark) ThemeMode.Dark else ThemeMode.Light,
        darkPalette = Palettes.darkById(config.darkPalette),
        lightPalette = Palettes.lightById(config.lightPalette),
    )

    private fun show(name: String, content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config, content) }
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    @Test
    fun colors() = show("20-colors") { PaletteScreen(appearance, onChange = {}, onBack = {}) }

    @Test
    fun font() = show("21-font") { FontScreen(appearance, onChange = {}, onBack = {}) }

    @Test
    fun licenses() = show("22-licenses") { LicensesScreen(onBack = {}) }
}
