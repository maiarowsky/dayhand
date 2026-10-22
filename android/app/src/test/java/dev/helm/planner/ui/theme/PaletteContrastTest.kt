package dev.helm.planner.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every palette keeps text readable (WCAG 2.1: 4.5:1 for text, 3:1 for hints and large elements). */
class PaletteContrastTest {
    private fun contrast(a: Color, b: Color): Double {
        val (light, dark) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (light + 0.05) / (dark + 0.05)
    }

    private fun assertContrast(min: Double, role: String, fg: (Palette) -> Color, bg: (Palette) -> Color) {
        Palettes.all.forEach { p ->
            val ratio = contrast(fg(p), bg(p))
            // 0.01 below the threshold absorbs rounding of the 8-bit values Mussh rounded to two decimals.
            assertTrue("${p.id}: $role is %.2f:1, needs %.1f:1".format(ratio, min), ratio >= min - 0.01)
        }
    }

    @Test
    fun textIsReadableOnScreensCardsAndSoftBackgrounds() {
        assertContrast(4.5, "text on background", { it.text }, { it.background })
        assertContrast(4.5, "text on surface", { it.text }, { it.surface })
        assertContrast(4.5, "muted text on background", { it.textMuted }, { it.background })
        assertContrast(4.5, "muted text on surface", { it.textMuted }, { it.surface })
        assertContrast(4.5, "text on accentSoft", { it.text }, { it.accentSoft })
        assertContrast(4.5, "text on warningSoft", { it.text }, { it.warningSoft })
        assertContrast(4.5, "text on dangerSoft", { it.text }, { it.dangerSoft })
        assertContrast(4.5, "text on successSoft", { it.text }, { it.successSoft })
    }

    @Test
    fun accentsAndStatesAreReadable() {
        assertContrast(4.5, "onAccent on accent", { it.onAccent }, { it.accent })
        assertContrast(4.5, "accent on background", { it.accent }, { it.background })
        assertContrast(4.5, "accent on accentSoft", { it.accent }, { it.accentSoft })
        assertContrast(4.5, "danger on background", { it.danger }, { it.background })
        assertContrast(4.5, "danger on surface", { it.danger }, { it.surface })
        assertContrast(4.5, "secondary on background", { it.secondary }, { it.background })
        // Roles drawn on cards: task labels and the person's badge, links and chip icons, the agent's badge.
        assertContrast(4.5, "secondary on surface", { it.secondary }, { it.surface })
        assertContrast(4.5, "accent on surface", { it.accent }, { it.surface })
        assertContrast(4.5, "attention on surface", { it.attention }, { it.surface })
        assertContrast(3.0, "faint text on background", { it.textFaint }, { it.background })
    }

    @Test
    fun idsAreUniqueAndBothVariantsExist() {
        assertEquals(Palettes.all.size, Palettes.all.map { it.id }.toSet().size)
        assertEquals(11, Palettes.dark.size)
        assertEquals(5, Palettes.light.size)
        assertTrue(!Palettes.DefaultDark.light && Palettes.DefaultLight.light)
    }

    @Test
    fun materialSchemeTakesThePaletteRoles() {
        Palettes.all.forEach { p ->
            val scheme = colorScheme(p)
            assertEquals(p.accent, scheme.primary)
            assertEquals(p.onAccent, scheme.onPrimary)
            assertEquals(p.background, scheme.background)
            assertEquals(p.text, scheme.onSurface)
            assertEquals(p.surface, scheme.surfaceContainer)
            assertEquals(p.danger, scheme.error)
        }
    }
}
