package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Font scale from which what sits side by side is stacked instead, all of it whole (Mussh: accessibility sizes). */
const val LARGE_TEXT_SCALE = 1.5f

/**
 * A list section (Mussh "SettingsGroup"): an accent label and a rounded card whose rows are split by thin lines that
 * start where the row text starts, so the icons stand in one clean column.
 */
@Composable
fun ListGroup(title: String?, rows: List<@Composable () -> Unit>, modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        title?.let { SectionLabel(it, Modifier.padding(start = 4.dp, top = 8.dp)) }
        Column(Modifier.fillMaxWidth().clip(HelmShapes.card).background(p.surface)) {
            rows.forEachIndexed { i, row ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = HelmDimens.rowInset), thickness = 1.dp, color = p.border)
                row()
            }
        }
    }
}

/** What a row's icon says: a setting (accent), something neutral, or a state that is fine, needs a look or is wrong. */
enum class IconTone { Accent, Neutral, Success, Warning, Danger }

/** The icon of a list row on a small rounded tile tinted for its [tone]; decoration only, the row's text names it. */
@Composable
fun RowIcon(icon: ImageVector, tone: IconTone = IconTone.Accent, enabled: Boolean = true) {
    val p = palette
    val (tint, background) = when {
        !enabled -> p.textFaint to p.surfaceRaised
        else -> when (tone) {
            IconTone.Accent -> p.accent to p.accentSoft
            IconTone.Neutral -> p.textMuted to p.surfaceRaised
            IconTone.Success -> p.success to p.successSoft
            IconTone.Warning -> p.warning to p.warningSoft
            IconTone.Danger -> p.danger to p.dangerSoft
        }
    }
    Box(Modifier.size(HelmDimens.rowIcon).background(background, HelmShapes.swatch), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
    }
}

/**
 * A list row (Mussh "SettingsRow"), at least [HelmDimens.rowMinHeight] high: an icon tile, the name with an optional
 * line under it, then the control ([trailing]: a switch, a value) and "›" when it opens something. [badge] sits after
 * the name (under it when there is no room), e.g. a state pill; [below] goes under the text, e.g. the button that
 * fixes what the row reports. The icon stays at the top of a tall row. With large text everything wraps, nothing is
 * cut off. A tappable row is one button for a screen reader; [clickLabel] says what a tap does.
 */
@Composable
fun ListRow(
    title: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    tone: IconTone = IconTone.Accent,
    subtitle: String? = null,
    titleColor: Color = palette.text,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    clickLabel: String? = null,
    chevron: Boolean = onClick != null,
    badge: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    below: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val p = palette
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.rowMinHeight)
            .then(
                if (onClick != null) {
                    Modifier.clickable(enabled = enabled, onClickLabel = clickLabel, role = Role.Button, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(horizontal = HelmDimens.rowPadding, vertical = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let {
            Box(Modifier.align(Alignment.Top)) { RowIcon(it, tone, enabled) }
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (badge == null) {
                Text(title, style = helmType.body, color = if (enabled) titleColor else p.textFaint)
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, style = helmType.body, color = if (enabled) titleColor else p.textFaint)
                    badge()
                }
            }
            subtitle?.let { Text(it, style = helmType.small, color = p.textMuted) }
            below?.let {
                Spacer(Modifier.height(8.dp))
                it()
            }
        }
        trailing?.let {
            Spacer(Modifier.width(12.dp))
            it()
        }
        if (chevron) {
            Spacer(Modifier.width(4.dp))
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(22.dp))
        }
    }
}

/** A short note under a group. */
@Composable
fun ListNote(text: String, modifier: Modifier = Modifier) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = modifier.padding(horizontal = 4.dp))
}

/** A menu on a raised card colour with option corners; items are [androidx.compose.material3.DropdownMenuItem]s. */
@Composable
fun HelmMenu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        containerColor = palette.surfaceRaised,
        shape = HelmShapes.option,
        content = content,
    )
}

/** A dialog on the palette's card colour with text actions; [content] is the body under the title. */
@Composable
fun HelmDialog(
    title: String,
    onDismiss: () -> Unit,
    confirm: String,
    onConfirm: () -> Unit,
    dismiss: String? = null,
    confirmEnabled: Boolean = true,
    /** The danger colour for a confirm that removes or disconnects something. */
    destructive: Boolean = false,
    confirmTag: String? = null,
    content: (@Composable () -> Unit)? = null,
) {
    val p = palette
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.surface,
        titleContentColor = p.text,
        textContentColor = p.textMuted,
        title = { Text(title, style = helmType.title) },
        text = content,
        confirmButton = {
            TextAction(
                confirm,
                onConfirm,
                enabled = confirmEnabled,
                color = if (destructive) p.danger else p.accent,
                modifier = confirmTag?.let { Modifier.testTag(it) } ?: Modifier,
            )
        },
        dismissButton = dismiss?.let { { TextAction(it, onDismiss, color = p.textMuted) } },
    )
}
