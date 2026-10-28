package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmButtonShape
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.Palette
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * The fill and the text of a button, from pairs the palette keeps at 4.5:1 or more: [Accent] is the main action (the
 * accent filled, as Mussh's Send), [Soft] an action on the accent's soft colour, [Danger] one that removes something,
 * [Quiet] the way back out (Cancel) on the raised card colour.
 */
enum class ButtonTone { Accent, Soft, Danger, Quiet }

internal fun ButtonTone.fill(p: Palette): Color = when (this) {
    ButtonTone.Accent -> p.accent
    ButtonTone.Soft -> p.accentSoft
    ButtonTone.Danger -> p.dangerSoft
    ButtonTone.Quiet -> p.surfaceRaised
}

internal fun ButtonTone.content(p: Palette): Color = when (this) {
    ButtonTone.Accent -> p.onAccent
    ButtonTone.Soft -> p.accent
    ButtonTone.Danger -> p.danger
    ButtonTone.Quiet -> p.text
}

/** The tone of a button asked for in one of the palette's colours: the accent, danger, or anything quieter. */
internal fun Palette.toneOf(color: Color): ButtonTone = when (color) {
    accent -> ButtonTone.Soft
    danger -> ButtonTone.Danger
    else -> ButtonTone.Quiet
}

/**
 * Every button of the app, in Mussh's Send shape ([HelmButtonShape]): a filled pill without an outline, at least
 * 34 dp high, centred in a touch target of at least 48 × 48 dp that is also what a screen reader focuses. The press
 * ripple stays inside the pill. It grows with large text instead of clipping it. Without [text] it is a 34 dp circle
 * around [icon], and [description] names it. [clickLabel] tells a screen reader what a tap does.
 */
@Composable
fun HelmButton(
    text: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: ButtonTone = ButtonTone.Soft,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    fillWidth: Boolean = false,
    clickLabel: String? = null,
    description: String? = null,
) {
    val p = palette
    val interaction = remember { MutableInteractionSource() }
    val fill = if (enabled) tone.fill(p) else p.surfaceRaised
    val content = if (enabled) tone.content(p) else p.textFaint
    val wide = if (fillWidth) Modifier.fillMaxWidth() else Modifier
    Box(
        modifier
            .then(wide)
            .sizeIn(minWidth = HelmButtonShape.touchTarget, minHeight = HelmButtonShape.touchTarget)
            .clickable(interaction, indication = null, enabled = enabled, onClickLabel = clickLabel, role = Role.Button, onClick = onClick)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        val pill = Modifier
            .clip(HelmButtonShape.shape)
            .background(fill)
            .indication(interaction, ripple())
        if (text == null) {
            Box(pill.size(HelmButtonShape.height), contentAlignment = Alignment.Center) {
                icon?.let { Icon(it, contentDescription = null, tint = content, modifier = Modifier.size(HelmButtonShape.iconSize)) }
            }
        } else {
            Row(
                pill
                    .then(wide)
                    .heightIn(min = HelmButtonShape.height)
                    .padding(horizontal = HelmButtonShape.horizontalPadding, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                icon?.let { Icon(it, contentDescription = null, tint = content, modifier = Modifier.size(HelmButtonShape.iconSize)) }
                Text(text, style = helmType.smallStrong.copy(fontSize = helmType.body.fontSize), color = content, textAlign = TextAlign.Center)
            }
        }
    }
}

/** The primary action (Mussh "AccentButton"): the accent-filled [HelmButton], full width unless [fillWidth] is off. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    fillWidth: Boolean = true,
    clickLabel: String? = null,
) {
    HelmButton(text, onClick, modifier, ButtonTone.Accent, enabled, icon, fillWidth, clickLabel)
}

/** A secondary action: the [HelmButton] in the tone of [color] (the accent's soft fill, danger, or quiet). */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = palette.secondary,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    HelmButton(text, onClick, modifier, palette.toneOf(color), enabled, icon)
}

/** The floating add button: an accent pill with the on-accent icon; [description] names it for screen readers. */
@Composable
fun HelmFab(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    FloatingActionButton(onClick = onClick, containerColor = p.accent, contentColor = p.onAccent, shape = HelmShapes.pill, modifier = modifier) {
        Icon(icon, contentDescription = description)
    }
}

/**
 * An action for dialogs, banners and rows: the [HelmButton] in the tone of [color] (accent: the soft accent fill,
 * danger, anything else quiet), or [tone] when given.
 */
@Composable
fun TextAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = palette.accent,
    enabled: Boolean = true,
    tone: ButtonTone? = null,
) {
    HelmButton(text, onClick, modifier, tone ?: palette.toneOf(color), enabled)
}

/**
 * A round icon button with a 48 dp touch target (Material's IconButton gives a 40 dp clickable circle), drawn as the
 * bare icon: header and row tools (back, settings, a row's menu), not actions. The icon is a drawing without text,
 * so [description] names the button for a screen reader.
 */
@Composable
fun HeaderIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = palette.text,
) {
    Box(
        modifier
            .size(HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = description
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(HelmDimens.iconSize))
    }
}
