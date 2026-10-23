package dev.helm.planner.ui.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** Corner radii from Mussh: cards 20 dp, options 16 dp, fields and icon tiles 14 dp, buttons and pills fully round. */
object HelmShapes {
    val card = RoundedCornerShape(20.dp)
    val option = RoundedCornerShape(16.dp)
    val field = RoundedCornerShape(14.dp)
    val tile = RoundedCornerShape(14.dp)
    val swatch = RoundedCornerShape(12.dp)
    val badge = RoundedCornerShape(8.dp)
    val pill = CircleShape
    val sheet = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)

    val material = Shapes(
        extraSmall = badge,
        small = field,
        medium = option,
        large = card,
        extraLarge = RoundedCornerShape(28.dp),
    )
}

/** Spacing and touch sizes. Every tappable element is at least [touchTarget] in both directions. */
object HelmDimens {
    val touchTarget = 48.dp
    val primaryButtonHeight = 56.dp
    val screenMargin = 20.dp
    val cardPadding = 18.dp
    val sectionGap = 12.dp
    val rowMinHeight = 64.dp

    /** A list row (Mussh settings row): its minimum height, side padding and the outline icon at its start. */
    val listRowMinHeight = 60.dp
    val rowPadding = 18.dp
    val lineIcon = 22.dp
    val iconSize = 24.dp
    val iconTile = 48.dp
}
