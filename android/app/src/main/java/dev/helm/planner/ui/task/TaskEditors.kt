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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import dev.helm.planner.ui.common.weekdayName

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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            // Inside the dialog's own window, where the field is attached.
            LaunchedEffect(Unit) { focus.requestFocus() }
            OutlinedTextField(
                value = field,
                onValueChange = { if (it.text.length <= maxLength) field = it },
                singleLine = singleLine,
                minLines = if (singleLine) 1 else 4,
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
        },
        confirmButton = {
            TextButton(onClick = { onSave(text) }, enabled = valid, modifier = Modifier.testTag(EditorTags.SAVE)) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.edit_repeat)) },
        text = {
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
                        RadioButton(selected = every == unit, onClick = null)
                        Text(stringResource(everyLabel(unit)), modifier = Modifier.padding(start = 12.dp))
                    }
                }
                if (every != null) {
                    OutlinedTextField(
                        value = interval,
                        onValueChange = { value -> if (value.length <= 3 && value.all(Char::isDigit)) interval = value },
                        label = { Text(stringResource(R.string.repeat_interval)) },
                        singleLine = true,
                        isError = !valid,
                        supportingText = if (!valid) {
                            { Text(stringResource(R.string.repeat_interval_invalid, TaskRules.MAX_REPEAT_INTERVAL)) }
                        } else {
                            null
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                            .testTag(EditorTags.INTERVAL),
                    )
                }
                if (every == RepeatEvery.WEEK) {
                    Text(stringResource(R.string.repeat_on), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        (1..7).forEach { day ->
                            FilterChip(
                                selected = day in weekdays,
                                onClick = { weekdays = if (day in weekdays) weekdays - day else weekdays + day },
                                label = { Text(weekdayName(day)) },
                                modifier = ChipHeight.testTag(EditorTags.weekday(day)),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(rule) }, enabled = valid, modifier = Modifier.testTag(EditorTags.SAVE)) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_label)) },
        text = {
            Column {
                OutlinedTextField(
                    value = text,
                    onValueChange = { if (it.length <= TaskRules.MAX_LABEL) text = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.label_name)) },
                    supportingText = if (full) {
                        { Text(stringResource(R.string.labels_full, TaskRules.MAX_LABELS)) }
                    } else {
                        null
                    },
                    isError = full,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(EditorTags.FIELD),
                )
                if (suggestions.isNotEmpty() && !full) {
                    Text(stringResource(R.string.labels_in_use), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        suggestions.take(MAX_SUGGESTIONS).forEach { label ->
                            SuggestionChip(onClick = { onAdd(label) }, label = { Text(label) }, modifier = ChipHeight)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onAdd(clean) }, enabled = valid, modifier = Modifier.testTag(EditorTags.SAVE)) {
                Text(stringResource(R.string.add))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** A link: an http(s) address and an optional title. */
@Composable
fun LinkDialog(onDismiss: () -> Unit, onAdd: (TaskLink) -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    val link = TaskRules.link(url, title)
    val showError = url.isNotBlank() && link == null
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_link)) },
        text = {
            Column {
                OutlinedTextField(
                    value = url,
                    onValueChange = { if (it.length <= TaskRules.MAX_URL) url = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.link_url)) },
                    placeholder = { Text("https://") },
                    isError = showError,
                    supportingText = if (showError) {
                        { Text(stringResource(R.string.link_invalid)) }
                    } else {
                        null
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(EditorTags.URL),
                )
                OutlinedTextField(
                    value = title,
                    onValueChange = { if (it.length <= TaskRules.MAX_TITLE) title = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.link_title)) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .testTag(EditorTags.LINK_TITLE),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { link?.let(onAdd) }, enabled = link != null, modifier = Modifier.testTag(EditorTags.SAVE)) {
                Text(stringResource(R.string.add))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

private const val MAX_SUGGESTIONS = 12
