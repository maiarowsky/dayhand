package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.weekdayName
import dev.helm.planner.ui.components.ActionChip
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.helmFieldColors
import dev.helm.planner.ui.components.helmRadioColors
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object EditorTags {
    const val FIELD = "editor-field"
    const val URL = "editor-url"
    const val LINK_TITLE = "editor-link-title"
    const val SAVE = "editor-save"
    const val INTERVAL = "editor-interval"
    fun every(every: RepeatEvery?) = "editor-every-${every?.name ?: "none"}"
    fun weekday(day: Int) = "editor-weekday-$day"
}

/** One text field in a dialog: the title (one line, required) or the note (many lines, may be empty). */
@Composable
fun TextEditDialog(
    title: String,
    initial: String,
    maxLength: Int,
    singleLine: Boolean,
    allowEmpty: Boolean,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    // Opens focused with the cursor after the existing text, ready to type or delete.
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val text = field.text
    val focus = remember { FocusRequester() }
    val valid = allowEmpty || text.isNotBlank()
    HelmDialog(
        title = title,
        onDismiss = onDismiss,
        confirm = stringResource(R.string.save),
        onConfirm = { onSave(text) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = valid,
        confirmTag = EditorTags.SAVE,
    ) {
        // Inside the dialog's own window, where the field is attached.
        LaunchedEffect(Unit) { focus.requestFocus() }
        // Material's field, not HelmTextField: it needs a TextFieldValue to place the cursor after the text.
        OutlinedTextField(
            value = field,
            onValueChange = { if (it.text.length <= maxLength) field = it },
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 4,
            textStyle = helmType.body,
            shape = HelmShapes.field,
            colors = helmFieldColors(),
            isError = !valid,
            supportingText = if (!valid) {
                { Text(stringResource(R.string.title_required)) }
            } else {
                null
            },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focus)
                .testTag(EditorTags.FIELD),
        )
    }
}

/** Repeat: never, or every N days / weeks (optionally on chosen weekdays) / months / years. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RepeatDialog(initial: RepeatRule?, onDismiss: () -> Unit, onSave: (RepeatRule?) -> Unit) {
    var every by rememberSaveable { mutableStateOf(initial?.every) }
    var interval by rememberSaveable { mutableStateOf((initial?.interval ?: 1).toString()) }
    var weekdays by rememberSaveable { mutableStateOf(initial?.weekdays.orEmpty()) }
    val rule = every?.let { unit ->
        RepeatRule(unit, interval.toIntOrNull() ?: 0, weekdays.sorted().takeIf { unit == RepeatEvery.WEEK && it.isNotEmpty() })
    }
    val valid = rule == null || TaskRules.isValid(rule)
    val p = palette
    HelmDialog(
        title = stringResource(R.string.edit_repeat),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.save),
        onConfirm = { onSave(rule) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = valid,
        confirmTag = EditorTags.SAVE,
    ) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            (listOf(null) + RepeatEvery.entries).forEach { unit ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .selectable(selected = every == unit, role = Role.RadioButton, onClick = { every = unit })
                        .testTag(EditorTags.every(unit)),
                ) {
                    RadioButton(selected = every == unit, onClick = null, colors = helmRadioColors())
                    Text(stringResource(everyLabel(unit)), style = helmType.body, color = p.text, modifier = Modifier.padding(start = 12.dp))
                }
            }
            if (every != null) {
                HelmTextField(
                    value = interval,
                    onValueChange = { value -> if (value.length <= 3 && value.all(Char::isDigit)) interval = value },
                    label = stringResource(R.string.repeat_interval),
                    singleLine = true,
                    isError = !valid,
                    supportingText = if (!valid) stringResource(R.string.repeat_interval_invalid, TaskRules.MAX_REPEAT_INTERVAL) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .testTag(EditorTags.INTERVAL),
                )
            }
            if (every == RepeatEvery.WEEK) {
                Text(stringResource(R.string.repeat_on), style = helmType.smallStrong, color = p.textMuted, modifier = Modifier.padding(vertical = 8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    (1..7).forEach { day ->
                        HelmChip(
                            weekdayName(day, appLocale()),
                            selected = day in weekdays,
                            onClick = { weekdays = if (day in weekdays) weekdays - day else weekdays + day },
                            multiple = true,
                            modifier = Modifier.testTag(EditorTags.weekday(day)),
                        )
                    }
                }
            }
        }
    }
}

private fun everyLabel(every: RepeatEvery?) = when (every) {
    null -> R.string.repeat_none
    RepeatEvery.DAY -> R.string.repeat_unit_day
    RepeatEvery.WEEK -> R.string.repeat_unit_week
    RepeatEvery.MONTH -> R.string.repeat_unit_month
    RepeatEvery.YEAR -> R.string.repeat_unit_year
}

/** A new label (or project): type one or pick one already in use. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LabelDialog(current: List<String>, suggestions: List<String>, onDismiss: () -> Unit, onAdd: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val clean = text.trim()
    val full = current.size >= TaskRules.MAX_LABELS
    val valid = clean.isNotEmpty() && clean.length <= TaskRules.MAX_LABEL && !full
    HelmDialog(
        title = stringResource(R.string.add_label),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.add),
        onConfirm = { onAdd(clean) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = valid,
        confirmTag = EditorTags.SAVE,
    ) {
        Column {
            HelmTextField(
                value = text,
                onValueChange = { if (it.length <= TaskRules.MAX_LABEL) text = it },
                singleLine = true,
                label = stringResource(R.string.label_name),
                supportingText = if (full) stringResource(R.string.labels_full, TaskRules.MAX_LABELS) else null,
                isError = full,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.testTag(EditorTags.FIELD),
            )
            if (suggestions.isNotEmpty() && !full) {
                Text(stringResource(R.string.labels_in_use), style = helmType.smallStrong, color = palette.textMuted, modifier = Modifier.padding(vertical = 8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    suggestions.take(MAX_SUGGESTIONS).forEach { label -> ActionChip(label, onClick = { onAdd(label) }) }
                }
            }
        }
    }
}

/** A link: an http(s) address and an optional title. */
@Composable
fun LinkDialog(onDismiss: () -> Unit, onAdd: (TaskLink) -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    val link = TaskRules.link(url, title)
    val showError = url.isNotBlank() && link == null
    HelmDialog(
        title = stringResource(R.string.add_link),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.add),
        onConfirm = { link?.let(onAdd) },
        dismiss = stringResource(R.string.cancel),
        confirmEnabled = link != null,
        confirmTag = EditorTags.SAVE,
    ) {
        Column {
            HelmTextField(
                value = url,
                onValueChange = { if (it.length <= TaskRules.MAX_URL) url = it },
                singleLine = true,
                label = stringResource(R.string.link_url),
                placeholder = "https://",
                isError = showError,
                supportingText = if (showError) stringResource(R.string.link_invalid) else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.testTag(EditorTags.URL),
            )
            HelmTextField(
                value = title,
                onValueChange = { if (it.length <= TaskRules.MAX_TITLE) title = it },
                singleLine = true,
                label = stringResource(R.string.link_title),
                modifier = Modifier
                    .padding(top = 8.dp)
                    .testTag(EditorTags.LINK_TITLE),
            )
        }
    }
}

private const val MAX_SUGGESTIONS = 12
