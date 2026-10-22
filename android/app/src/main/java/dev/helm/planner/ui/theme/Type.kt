package dev.helm.planner.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The Mussh type scale in the chosen font. Sizes are in sp, so they follow the system font size; layouts that hold
 * text use minimum heights, never fixed ones. [label] stays monospace in every font, like Mussh's "01 — FLEET".
 */
@Immutable
class HelmType(val family: FontFamily) {
    /** Title of a top-level screen ("Today"). */
    val headline = TextStyle(fontFamily = family, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold)

    /** Title of a sub-screen (Settings, a task). */
    val screenTitle = TextStyle(fontFamily = family, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold)

    /** Card titles, the primary button. */
    val title = TextStyle(fontFamily = family, fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontFamily = family, fontSize = 15.sp, lineHeight = 21.sp)
    val bodyStrong = body.copy(fontWeight = FontWeight.SemiBold)
    val small = TextStyle(fontFamily = family, fontSize = 13.sp, lineHeight = 18.sp)
    val smallStrong = small.copy(fontWeight = FontWeight.SemiBold)

    /** Upper-case section labels. */
    val label = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Medium)

    /** Material components (fields, dialogs, menus, pickers) in the same font and sizes. */
    val material: Typography = Typography().let { m ->
        Typography(
            displayLarge = m.displayLarge.copy(fontFamily = family),
            displayMedium = m.displayMedium.copy(fontFamily = family),
            displaySmall = m.displaySmall.copy(fontFamily = family),
            headlineLarge = m.headlineLarge.copy(fontFamily = family),
            headlineMedium = headline,
            headlineSmall = m.headlineSmall.copy(fontFamily = family),
            titleLarge = screenTitle,
            titleMedium = title,
            titleSmall = smallStrong,
            bodyLarge = body,
            bodyMedium = body.copy(fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = small,
            labelLarge = smallStrong.copy(fontSize = 14.sp, lineHeight = 20.sp),
            labelMedium = m.labelMedium.copy(fontFamily = family),
            labelSmall = m.labelSmall.copy(fontFamily = family),
        )
    }
}
