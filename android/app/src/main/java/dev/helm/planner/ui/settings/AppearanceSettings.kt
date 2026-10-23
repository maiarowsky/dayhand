package dev.helm.planner.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.helm.planner.R
import dev.helm.planner.ui.components.ChoiceRow
import dev.helm.planner.ui.components.LARGE_TEXT_SCALE
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.OptionCard
import dev.helm.planner.ui.components.Pill
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.HelmType
import dev.helm.planner.ui.theme.LocalHelmType
import dev.helm.planner.ui.theme.LocalPalette
import dev.helm.planner.ui.theme.Palette
import dev.helm.planner.ui.theme.Palettes
import dev.helm.planner.ui.theme.ThemeMode
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object AppearanceTags {
    const val GROUP = "appearance"
    const val MODE = "appearance_mode"
    const val COLORS = "appearance_colors"
    const val FONT = "appearance_font"
    const val PREVIEW = "appearance_preview"
    const val THEME_SCREEN = "theme_screen"
    const val PALETTE_SCREEN = "palette_screen"
    const val FONT_SCREEN = "font_screen"
    fun mode(mode: ThemeMode) = "mode-${mode.id}"
    fun palette(palette: Palette) = "palette-${palette.id}"
    fun font(font: HelmFont) = "font-${font.id}"
}

/** Font sample: letters, Polish characters and characters that are easy to confuse. */
private const val FONT_SAMPLE = "Aa ąę 0O il1"

/** Theme: system, light or dark, as a choice of rows. */
@Composable
internal fun ThemeOptions(appearance: Appearance, onChange: (Appearance) -> Unit) {
    ListGroup(
        null,
        rows = ThemeMode.entries.map { mode ->
            {
                ChoiceRow(stringResource(modeName(mode)), mode == appearance.mode, AppearanceTags.mode(mode), { onChange(appearance.copy(mode = mode)) })
            }
        },
    )
}

/** Colours: the dark and the light palette, each list under a pinned preview of both. */
@Composable
fun PaletteScreen(appearance: Appearance, onChange: (Appearance) -> Unit, onBack: () -> Unit) {
    AppearancePage(stringResource(R.string.appearance_colors), onBack, AppearanceTags.PALETTE_SCREEN, appearance) {
        OptionSection(stringResource(R.string.appearance_palettes_dark)) {
            Palettes.dark.forEach { option ->
                PaletteOption(option, option.id == appearance.darkPalette.id) { onChange(appearance.withPalette(option)) }
            }
        }
        OptionSection(stringResource(R.string.appearance_palettes_light)) {
            Palettes.light.forEach { option ->
                PaletteOption(option, option.id == appearance.lightPalette.id) { onChange(appearance.withPalette(option)) }
            }
        }
    }
}

/** Font: the bundled reading fonts, each shown in itself. */
@Composable
fun FontScreen(appearance: Appearance, onChange: (Appearance) -> Unit, onBack: () -> Unit) {
    AppearancePage(stringResource(R.string.appearance_font), onBack, AppearanceTags.FONT_SCREEN, appearance) {
        val (mono, proportional) = HelmFont.entries.partition { it.monospace }
        OptionSection(stringResource(R.string.appearance_fonts_proportional)) {
            proportional.forEach { font -> FontOption(font, font == appearance.font) { onChange(appearance.copy(font = font)) } }
        }
        OptionSection(stringResource(R.string.appearance_fonts_mono)) {
            mono.forEach { font -> FontOption(font, font == appearance.font) { onChange(appearance.copy(font = font)) } }
        }
    }
}

/** A settings page with the preview pinned above the scrolling choices (at large text it scrolls with them). */
@Composable
private fun AppearancePage(title: String, onBack: () -> Unit, tag: String, appearance: Appearance, content: @Composable ColumnScope.() -> Unit) {
    val pinned = LocalDensity.current.fontScale < LARGE_TEXT_SCALE
    SettingsPage(title, onBack, tag, pinned = if (pinned) ({ AppearancePreview(appearance) }) else null) {
        if (!pinned) AppearancePreview(appearance)
        content()
    }
}

@Composable
private fun OptionSection(title: String, options: @Composable () -> Unit) {
    SectionLabel(title, Modifier.padding(start = 4.dp, top = 8.dp), color = palette.textMuted)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { options() }
}

/**
 * The dark and the light palette side by side (stacked with large text), each a small Today screen in the chosen
 * font, so a change is visible whichever mode is on. Settings itself stays in the system sans ([SettingsType]); the
 * preview is where the font shows.
 */
@Composable
fun AppearancePreview(appearance: Appearance) {
    val large = LocalDensity.current.fontScale >= LARGE_TEXT_SCALE
    val modifier = Modifier.testTag(AppearanceTags.PREVIEW)
    if (large) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PreviewCard(appearance.darkPalette, appearance.font, Modifier.fillMaxWidth())
            PreviewCard(appearance.lightPalette, appearance.font, Modifier.fillMaxWidth())
        }
    } else {
        Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PreviewCard(appearance.darkPalette, appearance.font, Modifier.weight(1f))
            PreviewCard(appearance.lightPalette, appearance.font, Modifier.weight(1f))
        }
    }
}

@Composable
private fun PreviewCard(option: Palette, font: HelmFont, modifier: Modifier) {
    val type = remember(font) { HelmType(font.family) }
    CompositionLocalProvider(LocalPalette provides option, LocalHelmType provides type) {
        val p = palette
        Column(
            modifier
                .background(p.background, HelmShapes.card)
                .border(1.dp, p.border, HelmShapes.card)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SectionLabel(stringResource(R.string.appearance_preview_today))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(16.dp).border(2.dp, p.textMuted, HelmShapes.badge))
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.appearance_preview_task),
                    style = helmType.body,
                    color = p.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill(stringResource(R.string.appearance_preview_now), p.working)
                Pill(stringResource(R.string.appearance_preview_done), p.done)
            }
            Text(
                stringResource(R.string.add_task),
                style = helmType.smallStrong,
                color = p.onAccent,
                modifier = Modifier.background(p.accent, HelmShapes.pill).padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

/** A palette card: swatches of its own colours, its name and a line about it. */
@Composable
private fun PaletteOption(option: Palette, selected: Boolean, onSelect: () -> Unit) {
    val p = palette
    OptionCard(selected, AppearanceTags.palette(option), onSelect) {
        Swatches(option)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(paletteName(option)), style = helmType.bodyStrong, color = if (selected) p.accent else p.text)
            Text(stringResource(paletteNote(option)), style = helmType.small, color = p.textMuted)
        }
    }
}

@Composable
private fun Swatches(option: Palette) {
    Column(
        Modifier.background(option.background, HelmShapes.swatch).border(1.dp, option.border, HelmShapes.swatch).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Dot(option.accent)
            Dot(option.working)
            Dot(option.attention)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Dot(option.done)
            Dot(option.link)
            Dot(option.text)
        }
    }
}

@Composable
private fun Dot(color: Color) {
    Box(Modifier.size(14.dp).background(color, CircleShape))
}

/** A font row: a sample in that font, its name and a line about it. */
@Composable
private fun FontOption(font: HelmFont, selected: Boolean, onSelect: () -> Unit) {
    val p = palette
    OptionCard(selected, AppearanceTags.font(font), onSelect) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                FONT_SAMPLE,
                style = TextStyle(fontFamily = font.family, fontSize = 20.sp, color = p.text),
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
            Text(fontName(font), style = helmType.smallStrong, color = if (selected) p.accent else p.text)
            Text(stringResource(fontNote(font)), style = helmType.small, color = p.textMuted)
        }
    }
}

@StringRes
internal fun modeName(mode: ThemeMode): Int = when (mode) {
    ThemeMode.System -> R.string.appearance_mode_system
    ThemeMode.Light -> R.string.appearance_mode_light
    ThemeMode.Dark -> R.string.appearance_mode_dark
}

/** Font names are proper names and stay untranslated; only "System" comes from resources. */
@Composable
fun fontName(font: HelmFont): String = font.bundled?.name ?: stringResource(R.string.appearance_font_system)

@StringRes
private fun fontNote(font: HelmFont): Int = when (font) {
    HelmFont.System -> R.string.font_note_system
    HelmFont.Inter -> R.string.font_note_inter
    HelmFont.IbmPlexSans -> R.string.font_note_ibm_plex_sans
    HelmFont.Atkinson -> R.string.font_note_atkinson
    HelmFont.Geist -> R.string.font_note_geist
    HelmFont.SourceSerif -> R.string.font_note_source_serif
    HelmFont.Mono -> R.string.font_note_mono
}

@StringRes
fun paletteName(option: Palette): Int = PaletteTexts[option.id]?.first ?: R.string.palette_terracotta

@StringRes
private fun paletteNote(option: Palette): Int = PaletteTexts[option.id]?.second ?: R.string.palette_terracotta_note

private val PaletteTexts: Map<String, Pair<Int, Int>> = mapOf(
    Palettes.Terracotta.id to (R.string.palette_terracotta to R.string.palette_terracotta_note),
    Palettes.Honey.id to (R.string.palette_honey to R.string.palette_honey_note),
    Palettes.Amber.id to (R.string.palette_amber to R.string.palette_amber_note),
    Palettes.GruvboxDark.id to (R.string.palette_gruvbox_dark to R.string.palette_gruvbox_dark_note),
    Palettes.SolarizedDark.id to (R.string.palette_solarized_dark to R.string.palette_solarized_dark_note),
    Palettes.Nord.id to (R.string.palette_nord to R.string.palette_nord_note),
    Palettes.Dracula.id to (R.string.palette_dracula to R.string.palette_dracula_note),
    Palettes.TokyoNight.id to (R.string.palette_tokyo_night to R.string.palette_tokyo_night_note),
    Palettes.CatppuccinMocha.id to (R.string.palette_catppuccin_mocha to R.string.palette_catppuccin_mocha_note),
    Palettes.OneDark.id to (R.string.palette_one_dark to R.string.palette_one_dark_note),
    Palettes.RosePine.id to (R.string.palette_rose_pine to R.string.palette_rose_pine_note),
    Palettes.Paper.id to (R.string.palette_paper to R.string.palette_paper_note),
    Palettes.GruvboxLight.id to (R.string.palette_gruvbox_light to R.string.palette_gruvbox_light_note),
    Palettes.SolarizedLight.id to (R.string.palette_solarized_light to R.string.palette_solarized_light_note),
    Palettes.CatppuccinLatte.id to (R.string.palette_catppuccin_latte to R.string.palette_catppuccin_latte_note),
    Palettes.RosePineDawn.id to (R.string.palette_rose_pine_dawn to R.string.palette_rose_pine_dawn_note),
)
