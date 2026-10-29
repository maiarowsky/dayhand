package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Font scale from which what sits side by side is stacked instead, all of it whole (Mussh: accessibility sizes). */
const val LARGE_TEXT_SCALE = 1.5f

/** Widest a row's value may get before it ends in an ellipsis, so the name keeps its room (Mussh: 190 dp). */
private val VALUE_MAX_WIDTH = 190.dp

/**
 * A list section (Mussh "SettingsGroup"): a muted upper-case label and a rounded card on `surface` whose rows are
 * split by thin full-width lines. Meant for a column with 12 dp between its children, as on Mussh's settings.
 */
@Composable
fun ListGroup(title: String?, rows: List<@Composable () -> Unit>, modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        title?.let { SectionLabel(it, Modifier.padding(start = 4.dp, top = 12.dp), color = p.textMuted) }
        Column(Modifier.fillMaxWidth().clip(HelmShapes.card).background(p.surface)) {
            rows.forEachIndexed { i, row ->
                if (i > 0) HorizontalDivider(thickness = 1.dp, color = p.border)
                row()
            }
        }
    }
}

/**
 * A list row (Mussh "SettingsRow"), at least [HelmDimens.listRowMinHeight] high: a thin outline icon, the name, the
 * current value in muted text and "›" when it opens something. [note] is a muted line under the name (what a state
 * means); [trailing] is a control after it (a switch, a spinner). From [LARGE_TEXT_SCALE] the value goes under the
 * name and nothing is cut off. A tappable row is one button for a screen reader ([clickLabel] says what a tap does),
 * any other row one item.
 */
@Composable
fun ListRow(
    title: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: LineIcon? = null,
    value: String? = null,
    note: String? = null,
    titleColor: Color = palette.text,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
    clickLabel: String? = null,
    /** "›" at the end; by default when the row opens something. */
    chevron: Boolean? = null,
    onLongClick: (() -> Unit)? = null,
    longClickLabel: String? = null,
    leadingContent: (@Composable () -> Unit)? = null,
    valueColor: Color = palette.textMuted,
    onClick: (() -> Unit)? = null,
) {
    val p = palette
    val large = LocalDensity.current.fontScale >= LARGE_TEXT_SCALE
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.listRowMinHeight)
            .then(
                if (onClick != null) {
                    Modifier.combinedClickable(enabled = enabled, onClickLabel = clickLabel, role = Role.Button, onClick = onClick,
                        onLongClick = onLongClick, onLongClickLabel = longClickLabel)
                } else {
                    // Name and value are read as one.
                    Modifier.semantics(mergeDescendants = true) {}
                },
            )
            .padding(horizontal = HelmDimens.rowPadding, vertical = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leadingContent?.let { it(); Spacer(Modifier.width(16.dp)) }
        icon?.let {
            LineIconView(it, if (enabled) p.textMuted else p.textFaint, size = HelmDimens.lineIcon)
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // A name next to a value stays on one line, as on Mussh; alone it wraps.
            val oneLine = value != null && !large
            Text(
                title,
                style = helmType.body,
                color = if (enabled) titleColor else p.textFaint,
                maxLines = if (oneLine) 1 else Int.MAX_VALUE,
                overflow = TextOverflow.Ellipsis,
            )
            if (large) value?.let { Text(it, style = helmType.body, color = valueColor, modifier = Modifier.testTag("$tag-value")) }
            note?.let { Text(it, style = helmType.small, color = p.textMuted) }
        }
        if (!large) {
            value?.let {
                Spacer(Modifier.width(12.dp))
                Text(
                    it,
                    style = helmType.body,
                    color = valueColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = VALUE_MAX_WIDTH).testTag("$tag-value"),
                )
            }
        }
        trailing?.let {
            Spacer(Modifier.width(12.dp))
            it()
        }
        if (chevron ?: (onClick != null)) {
            Spacer(Modifier.width(8.dp))
            LineIconView(LineIcon.Chevron, p.textFaint, size = 18.dp)
        }
    }
}

/**
 * One choice in a group of rows: the name and a check mark in the accent when chosen (shape, not colour alone). A
 * screen reader reads it as a radio button, or as a checkbox when [multiple] choices can be on.
 */
@Composable
fun ChoiceRow(title: String, selected: Boolean, tag: String, onSelect: () -> Unit, multiple: Boolean = false) {
    val p = palette
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.listRowMinHeight)
            .selectable(selected = selected, role = if (multiple) Role.Checkbox else Role.RadioButton, onClick = onSelect)
            .padding(horizontal = HelmDimens.rowPadding, vertical = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = helmType.body, color = p.text, modifier = Modifier.weight(1f))
        if (selected) {
            Spacer(Modifier.width(12.dp))
            LineIconView(LineIcon.Check, p.accent, size = HelmDimens.lineIcon)
        }
    }
}

/** A short muted note under a group (Mussh "SettingsNote"). */
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

/** A dialog on the palette's card colour with its actions as buttons; [content] is the body under the title. */
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
                tone = if (destructive) ButtonTone.Danger else ButtonTone.Accent,
                modifier = confirmTag?.let { Modifier.testTag(it) } ?: Modifier,
            )
        },
        dismissButton = dismiss?.let { { TextAction(it, onDismiss, color = p.textMuted) } },
    )
}
