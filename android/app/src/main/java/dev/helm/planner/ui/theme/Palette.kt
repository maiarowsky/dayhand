package dev.helm.planner.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * The app's colours as one swappable set: screens read roles (background, card, accent…), never raw colours.
 * The roles and values follow the Mussh design system (docs/design.md); a palette is either light or dark.
 */
@Immutable
data class Palette(
    val id: String,
    /** Light background: light Material scheme, dark status and navigation bar icons. */
    val light: Boolean = false,
    /** Screen background. */
    val background: Color,
    /** Cards, groups and fields. */
    val surface: Color,
    /** Elements on a card, selected segments, disabled buttons. */
    val surfaceRaised: Color,
    val border: Color,
    val text: Color,
    val textMuted: Color,
    /** Hints and decoration only: at least 3:1 on the background, not for text that must be read. */
    val textFaint: Color,
    /** Section labels, primary buttons, selection. */
    val accent: Color,
    val accentDim: Color,
    /** Text and icons on [accent]. */
    val onAccent: Color,
    /** Icon tiles, selected options and informational banners. */
    val accentSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
    val warning: Color,
    val warningSoft: Color,
    val success: Color,
    val successSoft: Color,
    /** The task being worked on ("Now"). */
    val working: Color,
    /** Completed tasks. */
    val done: Color,
    /** Something waiting for the user, e.g. overdue. */
    val attention: Color,
    val link: Color,
    /** Secondary buttons and pills. */
    val secondary: Color,
)

/**
 * Palettes from Mussh with the same ids and values: its own "Terracotta and sand", "Honey and olive", "Amber" and
 * "Paper", and the editor themes in [PaletteThemes]. Dark palettes first (the default first), then light ones.
 */
object Palettes {
    val Terracotta = Palette(
        id = "terracotta",
        background = Color(0xFF1D2021),
        surface = Color(0xFF282828),
        surfaceRaised = Color(0xFF32302F),
        border = Color(0xFF3C3836),
        text = Color(0xFFFAF2CC),
        textMuted = Color(0xFFD2C5A5),
        textFaint = Color(0xFF928374),
        accent = Color(0xFFF1C050),
        accentDim = Color(0xFFCE9C3E),
        onAccent = Color(0xFF1D2021),
        accentSoft = Color(0xFF3A3021),
        danger = Color(0xFFE86A5E),
        dangerSoft = Color(0xFF3B1F1E),
        warning = Color(0xFFE78A4E),
        warningSoft = Color(0xFF3D2A1C),
        success = Color(0xFF9DB97A),
        successSoft = Color(0xFF26301F),
        working = Color(0xFFF08B5A),
        done = Color(0xFF9DB97A),
        attention = Color(0xFFE07A5F),
        link = Color(0xFFD9A0B8),
        secondary = Color(0xFFE2C49C),
    )

    val Honey = Palette(
        id = "honey",
        background = Color(0xFF1D2021),
        surface = Color(0xFF282828),
        surfaceRaised = Color(0xFF32302F),
        border = Color(0xFF3C3836),
        text = Color(0xFFFAF2CC),
        textMuted = Color(0xFFD2C5A5),
        textFaint = Color(0xFF928374),
        accent = Color(0xFFF1C050),
        accentDim = Color(0xFFCE9C3E),
        onAccent = Color(0xFF1D2021),
        accentSoft = Color(0xFF3A3021),
        danger = Color(0xFFEA6962),
        dangerSoft = Color(0xFF3B1F1E),
        warning = Color(0xFFE78A4E),
        warningSoft = Color(0xFF3D2A1C),
        success = Color(0xFFA9B665),
        successSoft = Color(0xFF2B3020),
        working = Color(0xFFE78A4E),
        done = Color(0xFFA9B665),
        attention = Color(0xFFE9967A),
        link = Color(0xFFD3869B),
        secondary = Color(0xFFC9A77C),
    )

    val Amber = Palette(
        id = "amber",
        background = Color(0xFF1D2021),
        surface = Color(0xFF282828),
        surfaceRaised = Color(0xFF32302F),
        border = Color(0xFF3C3836),
        text = Color(0xFFFAF2CC),
        textMuted = Color(0xFFD2C5A5),
        textFaint = Color(0xFF928374),
        accent = Color(0xFFF1C050),
        accentDim = Color(0xFFCE9C3E),
        onAccent = Color(0xFF1D2021),
        accentSoft = Color(0xFF3A3021),
        danger = Color(0xFFEA6962),
        dangerSoft = Color(0xFF3B1F1E),
        warning = Color(0xFFE78A4E),
        warningSoft = Color(0xFF3D2A1C),
        success = Color(0xFF99BF83),
        successSoft = Color(0xFF26301F),
        working = Color(0xFFF1C050),
        done = Color(0xFF99BF83),
        attention = Color(0xFFF1C050),
        link = Color(0xFFF1C050),
        secondary = Color(0xFFF1C050),
    )

    val Paper = Palette(
        id = "paper",
        light = true,
        background = Color(0xFFF6F0E2),
        surface = Color(0xFFFFFAEF),
        surfaceRaised = Color(0xFFECE3CE),
        border = Color(0xFFDDD2BA),
        text = Color(0xFF2B2620),
        textMuted = Color(0xFF564D42),
        textFaint = Color(0xFF7D7264),
        accent = Color(0xFF9A421D),
        accentDim = Color(0xFFB8784A),
        onAccent = Color(0xFFF6F0E2),
        accentSoft = Color(0xFFE7D1BF),
        danger = Color(0xFFA73326),
        dangerSoft = Color(0xFFEAD2C4),
        warning = Color(0xFF924D0E),
        warningSoft = Color(0xFFE9D7C0),
        success = Color(0xFF426A26),
        successSoft = Color(0xFFDBDDC5),
        working = Color(0xFFB1521E),
        done = Color(0xFF4B782B),
        attention = Color(0xFFA9432F),
        link = Color(0xFF8A436A),
        secondary = Color(0xFF6E5134),
    )

    val GruvboxDark get() = PaletteThemes.GruvboxDark
    val SolarizedDark get() = PaletteThemes.SolarizedDark
    val Nord get() = PaletteThemes.Nord
    val Dracula get() = PaletteThemes.Dracula
    val TokyoNight get() = PaletteThemes.TokyoNight
    val CatppuccinMocha get() = PaletteThemes.CatppuccinMocha
    val OneDark get() = PaletteThemes.OneDark
    val RosePine get() = PaletteThemes.RosePine
    val GruvboxLight get() = PaletteThemes.GruvboxLight
    val SolarizedLight get() = PaletteThemes.SolarizedLight
    val CatppuccinLatte get() = PaletteThemes.CatppuccinLatte
    val RosePineDawn get() = PaletteThemes.RosePineDawn

    val all: List<Palette> = listOf(
        Terracotta, Honey, Amber, GruvboxDark, SolarizedDark, Nord, Dracula, TokyoNight, CatppuccinMocha, OneDark, RosePine,
        Paper, GruvboxLight, SolarizedLight, CatppuccinLatte, RosePineDawn,
    )

    val dark: List<Palette> get() = all.filterNot { it.light }
    val light: List<Palette> get() = all.filter { it.light }

    /** Mussh's default palette, used in dark mode until the user picks another. */
    val DefaultDark: Palette = Terracotta

    /** The warm light palette that goes with [DefaultDark]. */
    val DefaultLight: Palette = Paper

    /** The palette with [id] if it is a dark one, else [DefaultDark]; an unknown id never breaks the start. */
    fun darkById(id: String?): Palette = dark.firstOrNull { it.id == id } ?: DefaultDark

    fun lightById(id: String?): Palette = light.firstOrNull { it.id == id } ?: DefaultLight
}
