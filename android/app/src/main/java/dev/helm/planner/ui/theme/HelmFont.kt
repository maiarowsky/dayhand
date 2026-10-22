package dev.helm.planner.ui.theme

import androidx.annotation.FontRes
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import dev.helm.planner.R

/**
 * A font shipped inside the app, never downloaded: its own name, the Compose family and the licence file in
 * `assets/licenses` (all SIL Open Font License 1.1, unmodified files from Mussh).
 */
class BundledFont(val name: String, val version: String, val family: FontFamily, val license: String)

private fun bundled(name: String, version: String, @FontRes regular: Int, @FontRes bold: Int, license: String) =
    BundledFont(name, version, FontFamily(Font(regular, FontWeight.Normal), Font(bold, FontWeight.Bold)), license)

/** The font files, apart from [HelmFont] so that enum construction does not depend on initialisation order. */
internal object BundledFonts {
    val Inter = bundled("Inter", "4.001", R.font.inter_regular, R.font.inter_bold, "Inter-OFL.txt")
    val IbmPlexSans = bundled("IBM Plex Sans", "3.005", R.font.ibm_plex_sans_regular, R.font.ibm_plex_sans_bold, "IBMPlexSans-OFL.txt")
    val Atkinson = bundled(
        "Atkinson Hyperlegible", "1.006", R.font.atkinson_hyperlegible_regular, R.font.atkinson_hyperlegible_bold,
        "AtkinsonHyperlegible-OFL.txt",
    )
    val Geist = bundled("Geist", "1.800", R.font.geist_regular, R.font.geist_bold, "Geist-OFL.txt")
    val SourceSerif = bundled("Source Serif 4", "4.005", R.font.source_serif_4_regular, R.font.source_serif_4_bold, "SourceSerif4-OFL.txt")
    val JetBrainsMono = bundled("JetBrains Mono", "2.304", R.font.jetbrains_mono_regular, R.font.jetbrains_mono_bold, "JetBrainsMono-OFL.txt")
}

/**
 * The text font of the whole app, chosen in Settings: the reading fonts Mussh offers for its chat, with the same ids.
 * [System] is the phone's own sans-serif (Roboto or the maker's font), the default and what Mussh's screens use.
 */
enum class HelmFont(val id: String, val bundled: BundledFont?, val monospace: Boolean = false) {
    System("system", null),
    Inter("inter", BundledFonts.Inter),
    IbmPlexSans("ibm-plex-sans", BundledFonts.IbmPlexSans),
    Atkinson("atkinson-hyperlegible", BundledFonts.Atkinson),
    Geist("geist", BundledFonts.Geist),
    SourceSerif("source-serif", BundledFonts.SourceSerif),
    Mono("mono", BundledFonts.JetBrainsMono, monospace = true),
    ;

    val family: FontFamily get() = bundled?.family ?: FontFamily.Default

    companion object {
        val Default = System

        fun byId(id: String?): HelmFont = entries.firstOrNull { it.id == id } ?: Default

        /** Every bundled font, for the licences screen. */
        val bundledFonts: List<BundledFont> get() = entries.mapNotNull { it.bundled }
    }
}
