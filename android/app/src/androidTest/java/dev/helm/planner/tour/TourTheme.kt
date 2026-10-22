package dev.helm.planner.tour

import androidx.compose.runtime.Composable
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode

/** The theme of a tour run: mode and the two palettes from the instrumentation arguments. */
@Composable
fun TourTheme(config: TourConfig, content: @Composable () -> Unit) {
    val appearance = Appearance(
        mode = if (config.dark) ThemeMode.Dark else ThemeMode.Light,
        darkPalette = Palettes.darkById(config.darkPalette),
        lightPalette = Palettes.lightById(config.lightPalette),
    )
    HelmTheme(appearance, systemDark = config.dark, content = content)
}
