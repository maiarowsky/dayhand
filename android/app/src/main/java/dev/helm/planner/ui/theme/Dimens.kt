package dev.helm.planner.ui.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** Dayhand corner radii: cards 8 dp, options 6 dp, fields and icon tiles 8 dp, buttons and pills fully round. */
object HelmShapes {
    val card = RoundedCornerShape(8.dp)
    val option = RoundedCornerShape(6.dp)
    val field = RoundedCornerShape(8.dp)
    val tile = RoundedCornerShape(8.dp)
    val swatch = RoundedCornerShape(12.dp)
    val badge = RoundedCornerShape(3.dp)
    val pill = CircleShape
    val sheet = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)

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
    val screenMargin = 16.dp
    val cardPadding = 14.dp
    val sectionGap = 12.dp
    val rowMinHeight = 64.dp

    /** A list row (Mussh settings row): its minimum height, side padding and the outline icon at its start. */
    val listRowMinHeight = 60.dp
    val rowPadding = 18.dp
    val lineIcon = 22.dp
    val iconSize = 24.dp
    val iconTile = 48.dp
}

/**
 * One shape for every button and action, copied from Mussh's Send button (`chat/InputBar.kt`, `SendButton`): fully
 * round, filled, with no outline, [height] high (Mussh's `SEND_CIRCLE`) inside a [touchTarget] that a tap and a
 * screen reader use; a disabled button keeps the shape on the raised card colour with faint text, as Send does with
 * nothing to send. Only the shape is Mussh's: the fills come from the Dayhand palette.
 */
object HelmButtonShape {
    val shape = CircleShape
    val height = 34.dp
    val touchTarget = 48.dp
    val horizontalPadding = 14.dp
    val iconSize = 18.dp
}
