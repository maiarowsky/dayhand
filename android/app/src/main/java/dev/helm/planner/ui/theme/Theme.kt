package dev.helm.planner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

val LocalPalette = staticCompositionLocalOf { Palettes.DefaultDark }
val LocalHelmType = staticCompositionLocalOf { HelmType(HelmFont.Default.family) }

/** The palette of the current theme. */
val palette: Palette
    @Composable @ReadOnlyComposable get() = LocalPalette.current

/** The type scale of the current theme. */
val helmType: HelmType
    @Composable @ReadOnlyComposable get() = LocalHelmType.current

/**
 * The theme of the whole app: the palette and type scale for Dayhand's own components, and a Material 3 scheme, type
 * scale and shapes built from them for fields, switches, dialogs, menus and pickers. Changing [appearance] redraws
 * the whole tree at once.
 */
@Composable
fun HelmTheme(
    appearance: Appearance = Appearance(),
    systemDark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = appearance.palette(systemDark)
    val type = remember(appearance.font) { HelmType(appearance.font.family) }
    CompositionLocalProvider(LocalPalette provides palette, LocalHelmType provides type) {
        MaterialTheme(
            colorScheme = colorScheme(palette),
            typography = type.material,
            shapes = HelmShapes.material,
            content = content,
        )
    }
}

/** A Material 3 scheme from the palette's roles, light or dark according to [Palette.light]. */
fun colorScheme(palette: Palette): ColorScheme {
    val scheme = if (palette.light) lightColorScheme() else darkColorScheme()
    return scheme.copy(
        primary = palette.accent,
        onPrimary = palette.onAccent,
        primaryContainer = palette.accentSoft,
        onPrimaryContainer = palette.text,
        inversePrimary = palette.accentDim,
        secondary = palette.secondary,
        onSecondary = palette.onAccent,
        secondaryContainer = palette.surfaceRaised,
        onSecondaryContainer = palette.text,
        tertiary = palette.success,
        onTertiary = palette.onAccent,
        tertiaryContainer = palette.successSoft,
        onTertiaryContainer = palette.text,
        background = palette.background,
        onBackground = palette.text,
        surface = palette.background,
        onSurface = palette.text,
        surfaceVariant = palette.surfaceRaised,
        onSurfaceVariant = palette.textMuted,
        surfaceTint = palette.accent,
        inverseSurface = palette.text,
        inverseOnSurface = palette.background,
        surfaceBright = palette.surfaceRaised,
        surfaceDim = palette.background,
        surfaceContainerLowest = palette.background,
        surfaceContainerLow = palette.surface,
        surfaceContainer = palette.surface,
        surfaceContainerHigh = palette.surface,
        surfaceContainerHighest = palette.surfaceRaised,
        outline = palette.border,
        outlineVariant = palette.border,
        error = palette.danger,
        onError = palette.onAccent,
        errorContainer = palette.dangerSoft,
        onErrorContainer = palette.text,
        scrim = Color.Black,
    )
}
