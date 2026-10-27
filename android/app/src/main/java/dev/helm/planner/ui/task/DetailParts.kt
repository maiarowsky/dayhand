package dev.helm.planner.ui.task

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.helm.planner.R
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.LARGE_TEXT_SCALE
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.components.SectionLabel
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
 * A section that folds: its upper-case name, a one-line [summary] of what is inside while folded, and an arrow. The
 * header is one button for a screen reader, with "expanded" or "collapsed" as its state.
 */
@Composable
internal fun FoldingSection(
    title: String,
    tag: String,
    initiallyExpanded: Boolean,
    modifier: Modifier = Modifier,
    summary: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable(tag) { mutableStateOf(initiallyExpanded) }
    val p = palette
    val state = stringResource(if (expanded) R.string.section_expanded else R.string.section_collapsed)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = HelmDimens.touchTarget)
                .clip(HelmShapes.field)
                .clickable { expanded = !expanded }
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    stateDescription = state
                    heading()
                }
                .padding(start = 4.dp, top = 8.dp, bottom = 4.dp)
                .testTag("$tag-header"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                SectionLabel(title, color = p.textMuted)
                if (!expanded && summary != null) Text(summary, style = helmType.valueSmall, color = p.text)
            }
            Icon(
                if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = p.textMuted,
                modifier = Modifier.padding(horizontal = 12.dp).size(HelmDimens.iconSize),
            )
        }
        if (expanded) HelmCard(Modifier.testTag(tag), content = content)
    }
}

/**
 * The statuses as one row of equal segments, one per line at large text sizes. The chosen one is filled with the
 * accent in dark text; the others are on the raised card colour in the text colour, so the choice shows as fill and
 * colour, not as an outline. Each segment is a radio button for a screen reader and at least 48 dp high.
 */
@Composable
internal fun <T> SegmentedChoice(
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    tag: (T) -> String,
    enabled: Boolean,
    onSelect: (T) -> Unit,
) {
    val p = palette
    // From the large text sizes on, a name would break inside a word in a third of the width: one segment per line.
    val stacked = LocalDensity.current.fontScale >= LARGE_TEXT_SCALE
    val segment = @Composable { option: T, modifier: Modifier ->
        val chosen = option == selected
        Box(
            modifier
                .heightIn(min = HelmDimens.touchTarget)
                .clip(HelmShapes.pill)
                .background(if (chosen) p.accent else p.surfaceRaised)
                .selectable(selected = chosen, enabled = enabled, role = Role.RadioButton, onClick = { onSelect(option) })
                .padding(horizontal = 6.dp, vertical = 8.dp)
                .testTag(tag(option)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label(option),
                style = helmType.smallStrong.copy(fontFamily = helmType.reading, fontSize = 14.sp, lineHeight = 18.sp),
                color = if (chosen) p.onAccent else p.text,
                textAlign = TextAlign.Center,
            )
        }
    }
    val group = Modifier
        .fillMaxWidth()
        .clip(if (stacked) HelmShapes.option else HelmShapes.pill)
        .background(p.surfaceRaised)
    if (stacked) {
        Column(group) { options.forEach { segment(it, Modifier.fillMaxWidth()) } }
    } else {
        Row(group, verticalAlignment = Alignment.CenterVertically) { options.forEach { segment(it, Modifier.weight(1f)) } }
    }
}

/** A label on the task: its name on the raised card colour, and a cross when it can be removed (the whole chip removes it). */
@Composable
internal fun LabelChip(text: String, enabled: Boolean, removeLabel: String, onRemove: () -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    Row(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .background(p.surfaceRaised)
            .clickable(enabled = enabled, onClickLabel = removeLabel, role = Role.Button, onClick = onRemove)
            .padding(start = 14.dp, end = if (enabled) 10.dp else 14.dp, top = 10.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = helmType.valueSmall, color = p.text)
        if (enabled) Icon(Icons.Filled.Close, contentDescription = null, tint = p.textMuted, modifier = Modifier.size(18.dp))
    }
}

/**
 * An action on the details screen (pick a day, add a label, move to the trash): a filled pill in the accent's or the
 * danger's soft colour with an icon, so it reads as a button. Its text keeps 4.5:1 on that fill in every palette,
 * which a 12 % tint of the accent does not.
 */
@Composable
internal fun DetailAction(
    text: String,
    onClick: () -> Unit,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
) {
    val p = palette
    val tint = if (danger) p.danger else p.accent
    Row(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .background(if (danger) p.dangerSoft else p.accentSoft)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(text, style = helmType.smallStrong.copy(fontFamily = helmType.reading, fontSize = 14.sp), color = tint)
    }
}

@Composable
internal fun Placeholder(text: String) {
    Text(text, style = helmType.valueSmall, color = palette.textMuted, modifier = Modifier.padding(vertical = 4.dp))
}
