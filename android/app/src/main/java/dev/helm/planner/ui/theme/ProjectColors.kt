package dev.helm.planner.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import dev.helm.planner.domain.ProjectRules

/** Named backend tokens, tonally adjusted to each palette. Never use the dot colour for small text. */
object ProjectColors {
    private val light = listOf(0xFFB3261E, 0xFFAA4800, 0xFF8B6300, 0xFF36702B, 0xFF006C62, 0xFF00697D,
        0xFF245FB4, 0xFF5145A6, 0xFF7A3CAC, 0xFFAA326F, 0xFF795338, 0xFF626262).map { Color(it) }
    private val dark = listOf(0xFFFF938B, 0xFFFFB16F, 0xFFE7C45A, 0xFFA3D88A, 0xFF78D8C6, 0xFF79D3E8,
        0xFF99BFFF, 0xFFB6AAFF, 0xFFD3AAFF, 0xFFFFA5CF, 0xFFD9B28E, 0xFFBBBBBB).map { Color(it) }
    private const val MIN_DOT_CONTRAST = 3.1
    private const val TONAL_STEPS = 100

    fun color(token: String?, palette: Palette): Color {
        val index = ProjectRules.colors.indexOf(token)
        val base = if (index < 0) palette.textMuted else (if (palette.light) light else dark)[index]
        val backgrounds = listOf(palette.surface, palette.background, palette.accentSoft, palette.surfaceRaised)
        return (0..TONAL_STEPS).asSequence().map { lerp(base, palette.text, it.toFloat() / TONAL_STEPS) }
            .firstOrNull { color -> backgrounds.all { contrast(color, it) >= MIN_DOT_CONTRAST } } ?: palette.text
    }

    private fun contrast(a: Color, b: Color): Double {
        val high = maxOf(a.luminance(), b.luminance())
        val low = minOf(a.luminance(), b.luminance())
        return (high + 0.05) / (low + 0.05)
    }
}
