package dev.helm.planner.ui.task

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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.components.ButtonTone
import dev.helm.planner.ui.components.HelmButton
import dev.helm.planner.ui.components.LARGE_TEXT_SCALE
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** The name of a field in the details card: small and muted, so the value under it reads first. */
@Composable
internal fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = modifier.semantics { heading() })
}

/** A thin line between the fields of one card. */
@Composable
internal fun FieldDivider() {
    HorizontalDivider(thickness = 1.dp, color = palette.border)
}

/**
 * A labelled value that opens its editor when tapped: the muted name over the value in the larger reading style, and
 * "›" at the end. A screen reader hears name and value as one button that says what a tap does.
 */
@Composable
internal fun ValueRow(
    label: String,
    value: String,
    placeholder: Boolean,
    editLabel: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    val p = palette
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.field)
            .clickable(enabled = enabled, onClickLabel = editLabel, role = Role.Button, onClick = onClick)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FieldLabel(label)
            Row(verticalAlignment = Alignment.CenterVertically) {
                leading?.let { it(); Spacer(Modifier.width(8.dp)) }
                Text(value, style = helmType.value, color = if (placeholder) p.textMuted else p.text)
            }
        }
        if (enabled) {
            Spacer(Modifier.width(8.dp))
            LineIconView(LineIcon.Chevron, p.textMuted, size = 18.dp)
        }
    }
}

/**
 * A labelled value in one row: the muted name, the value (with [leading] before it) and "›", so a field costs one
 * 48 dp row. From the large text sizes on, the name goes over the value as in [ValueRow].
 */
@Composable
internal fun InlineValueRow(
    label: String,
    value: String,
    placeholder: Boolean,
    editLabel: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    if (LocalDensity.current.fontScale >= LARGE_TEXT_SCALE) {
        ValueRow(label, value, placeholder, editLabel, enabled, onClick, modifier, leading)
        return
    }
    val p = palette
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.field)
            .clickable(enabled = enabled, onClickLabel = editLabel, role = Role.Button, onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FieldLabel(label, Modifier.padding(end = 12.dp))
        leading?.let { it(); Spacer(Modifier.width(8.dp)) }
        Text(value, style = helmType.valueSmall, color = if (placeholder) p.textMuted else p.text, modifier = Modifier.weight(1f))
        if (enabled) {
            Spacer(Modifier.width(8.dp))
            LineIconView(LineIcon.Chevron, p.textMuted, size = 18.dp)
        }
    }
}

/** An action on the details screen (pick a day, add a link, move to the trash): the app's [HelmButton] with an icon. */
@Composable
internal fun DetailAction(
    text: String,
    onClick: () -> Unit,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
) {
    HelmButton(text, onClick, modifier, if (danger) ButtonTone.Danger else ButtonTone.Soft, icon = icon)
}

@Composable
internal fun Placeholder(text: String) {
    Text(text, style = helmType.valueSmall, color = palette.textMuted, modifier = Modifier.padding(vertical = 4.dp))
}
