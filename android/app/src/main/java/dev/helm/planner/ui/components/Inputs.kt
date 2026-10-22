package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CheckboxColors
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Field colours from the palette, as in Mussh: accent border and label when focused, danger on error. */
@Composable
fun helmFieldColors(): TextFieldColors = palette.let { p ->
    OutlinedTextFieldDefaults.colors(
        focusedTextColor = p.text,
        unfocusedTextColor = p.text,
        disabledTextColor = p.textMuted,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedBorderColor = p.accent,
        unfocusedBorderColor = p.border,
        focusedLabelColor = p.accent,
        unfocusedLabelColor = p.textMuted,
        cursorColor = p.accent,
        focusedPlaceholderColor = p.textMuted,
        unfocusedPlaceholderColor = p.textMuted,
        focusedSupportingTextColor = p.textMuted,
        unfocusedSupportingTextColor = p.textMuted,
        errorBorderColor = p.danger,
        errorLabelColor = p.danger,
        errorSupportingTextColor = p.danger,
        errorTextColor = p.text,
        errorCursorColor = p.danger,
    )
}

/** A text field: Material's outlined field with Helm's colours, 14 dp corners and the body text style. */
@Composable
fun HelmTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = false,
    minLines: Int = 1,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        textStyle = helmType.body,
        label = label?.let { { Text(it) } },
        placeholder = placeholder?.let { { Text(it) } },
        supportingText = supportingText?.let { { Text(it) } },
        trailingIcon = trailingIcon,
        isError = isError,
        singleLine = singleLine,
        minLines = minLines,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        shape = HelmShapes.field,
        colors = helmFieldColors(),
    )
}

/** A small pill with a state or a count (Mussh "Pill"), e.g. "Overdue"; [strong] fills it with [color]. */
@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier, strong: Boolean = false) {
    Text(
        text,
        style = helmType.smallStrong,
        color = if (strong) palette.onAccent else color,
        modifier = modifier
            .background(if (strong) color else color.copy(alpha = 0.16f), HelmShapes.pill)
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/**
 * A choice chip (day, time, reminder): a pill that is soft accent with a tick when [selected], at least 48 dp high.
 * [multiple]: one of several that can be on together (a checkbox for screen readers), else one of a group.
 */
@Composable
fun HelmChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, multiple: Boolean = false) {
    val p = palette
    Row(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.pill)
            .background(if (selected) p.accentSoft else p.surface)
            .border(1.dp, if (selected) p.accent else p.border, HelmShapes.pill)
            .selectable(selected = selected, role = if (multiple) Role.Checkbox else Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Selected is shown by a tick too, not by colour alone.
        if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = p.accent, modifier = Modifier.size(18.dp))
        Text(text, style = helmType.smallStrong, color = if (selected) p.accent else p.textMuted, textAlign = TextAlign.Center)
    }
}

data class SegmentOption(val id: String, val label: String)

/** One of a few options in a pill (Mussh "Segmented"): the selected one raised and in the accent colour. */
@Composable
fun Segmented(options: List<SegmentOption>, selected: String, onSelect: (String) -> Unit, tagFor: (String) -> String, modifier: Modifier = Modifier) {
    val p = palette
    Row(
        modifier.fillMaxWidth().background(p.surface, HelmShapes.pill).padding(4.dp).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val active = option.id == selected
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = HelmDimens.touchTarget)
                    .clip(HelmShapes.pill)
                    .background(if (active) p.surfaceRaised else Color.Transparent)
                    .selectable(selected = active, role = Role.RadioButton) { onSelect(option.id) }
                    .padding(horizontal = 4.dp, vertical = 10.dp)
                    .testTag(tagFor(option.id)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(option.label, style = helmType.smallStrong, color = if (active) p.accent else p.textMuted, textAlign = TextAlign.Center)
            }
        }
    }
}

/**
 * A row with a switch: tapping the text or the switch toggles it, and a screen reader hears one switch with its name
 * and state. Only the switch shows the press (same interaction source), as in Mussh.
 */
@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
) {
    val p = palette
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .toggleable(value = checked, interactionSource = interaction, indication = null, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = helmType.body, color = p.text)
            subtitle?.let { Text(it, style = helmType.small, color = p.textMuted) }
        }
        Switch(
            checked = checked,
            onCheckedChange = null,
            interactionSource = interaction,
            colors = SwitchDefaults.colors(
                checkedTrackColor = p.accent,
                checkedThumbColor = p.onAccent,
                uncheckedTrackColor = p.surfaceRaised,
                uncheckedThumbColor = p.textMuted,
                uncheckedBorderColor = p.border,
            ),
        )
    }
}

/** Checkbox colours: accent box with the on-accent tick, muted outline. */
@Composable
fun helmCheckboxColors(): CheckboxColors = palette.let { p ->
    CheckboxDefaults.colors(checkedColor = p.accent, uncheckedColor = p.textMuted, checkmarkColor = p.onAccent)
}
