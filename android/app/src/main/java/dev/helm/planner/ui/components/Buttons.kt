package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * The primary action (Mussh "AccentButton"): a full-width pill in the accent colour, at least 56 dp high. It grows with
 * large text instead of clipping it. [clickLabel] tells a screen reader what a tap does.
 */
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
    val p = palette
    val content = if (enabled) p.onAccent else p.textFaint
    Row(
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = HelmDimens.primaryButtonHeight)
            .clip(HelmShapes.pill)
            .background(if (enabled) p.accent else p.surfaceRaised)
            .clickable(enabled = enabled, onClickLabel = clickLabel, role = Role.Button, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = content) }
        Text(text, style = helmType.title, color = content, textAlign = TextAlign.Center)
    }
}

/** The secondary action (Mussh "GhostButton"): a pill tinted with [color] at 12 %, text in [color], at least 48 dp. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = palette.secondary,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val p = palette
    val tint = if (enabled) color else p.textFaint
    Row(
        modifier = modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .background(tint.copy(alpha = 0.12f))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp)) }
        Text(text, style = helmType.smallStrong, color = tint)
    }
}

/** The floating add button: an accent pill with the on-accent icon; [description] names it for screen readers. */
@Composable
fun HelmFab(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    FloatingActionButton(onClick = onClick, containerColor = p.accent, contentColor = p.onAccent, shape = HelmShapes.pill, modifier = modifier) {
        Icon(icon, contentDescription = description)
    }
}

/** A text-only action for dialogs, banners and rows, in the accent colour, at least 48 × 48 dp. */
@Composable
fun TextAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = palette.accent,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(contentColor = color, disabledContentColor = palette.textFaint),
        modifier = modifier.sizeIn(minWidth = HelmDimens.touchTarget, minHeight = HelmDimens.touchTarget),
    ) {
        Text(text, style = helmType.smallStrong.copy(fontSize = helmType.body.fontSize))
    }
}

/**
 * A round icon button with a 48 dp touch target (Material's IconButton gives a 40 dp clickable circle). The icon is a
 * drawing without text, so [description] names the button for a screen reader.
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
