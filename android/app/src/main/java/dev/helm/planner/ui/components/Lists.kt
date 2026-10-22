package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Font scale from which a row puts its value under its name, both whole (Mussh: accessibility sizes). */
const val LARGE_TEXT_SCALE = 1.5f

/** A list section: a label and a rounded card whose rows are split by thin lines. */
@Composable
fun ListGroup(title: String?, rows: List<@Composable () -> Unit>, modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
 * A list row (Mussh "SettingsRow"): optional icon, name, the current value in muted text and "›" when it opens
 * something. With large text the value goes under the name and nothing is cut off.
 */
@Composable
fun ListRow(
    title: String,
    tag: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    value: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val p = palette
    val large = LocalDensity.current.fontScale >= LARGE_TEXT_SCALE
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.rowMinHeight)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = HelmDimens.cardPadding, vertical = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let {
            Icon(it, contentDescription = null, tint = p.textMuted, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(16.dp))
        }
        if (large) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = helmType.body, color = p.text)
                value?.let { Text(it, style = helmType.body, color = p.textMuted, modifier = Modifier.testTag("$tag-value")) }
            }
        } else {
            Text(title, style = helmType.body, color = p.text, modifier = Modifier.weight(1f))
            value?.let {
                Spacer(Modifier.width(12.dp))
                Text(
                    it,
                    style = helmType.body,
                    color = p.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 190.dp).testTag("$tag-value"),
                )
            }
        }
        if (onClick != null) {
            Spacer(Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(20.dp))
        }
    }
}

/** A short note under a group. */
@Composable
fun ListNote(text: String, modifier: Modifier = Modifier) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = modifier.padding(horizontal = 4.dp))
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
        confirmButton = { TextAction(confirm, onConfirm, enabled = confirmEnabled) },
        dismissButton = dismiss?.let { { TextAction(it, onDismiss, color = p.textMuted) } },
    )
}
