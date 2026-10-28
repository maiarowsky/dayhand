package dev.helm.planner.ui.task

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.components.ActionChip
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.components.helmFieldColors
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object EditorTags {
    const val FIELD = "editor-field"
    const val LONG_TEXT = "editor-long-text"
    const val URL = "editor-url"
    const val LINK_TITLE = "editor-link-title"
    const val SAVE = "editor-save"
    const val INTERVAL = "editor-interval"
    const val COUNT = "editor-count"
    const val FROM_DUE = "editor-from-due"
    const val FROM_COMPLETION = "editor-from-completion"
    const val END_NEVER = "editor-end-never"
    const val END_UNTIL = "editor-end-until"
    const val END_COUNT = "editor-end-count"
    const val REMINDERS_DEFAULT = "editor-reminders-default"
    const val REMINDERS_NONE = "editor-reminders-none"
    const val REMINDERS_CUSTOM = "editor-reminders-custom"
    const val REMINDER_ON_DAY = "editor-reminder-on-day"
    const val REMINDER_DAY_BEFORE = "editor-reminder-day-before"
    const val ITEM_UP = "editor-item-up"
    const val ITEM_DOWN = "editor-item-down"
    const val ITEM_REMOVE = "editor-item-remove"
    fun every(every: RepeatEvery?) = "editor-every-${every?.name ?: "none"}"
    fun weekday(day: Int) = "editor-weekday-$day"
    fun month(key: String) = "editor-month-$key"
    fun before(minutes: Int) = "editor-before-$minutes"
}

/** One line of text in a dialog (the title, a checklist item), which may not stay empty. */
@Composable
fun TextEditDialog(
    title: String,
    initial: String,
    maxLength: Int,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
    /** More actions under the field (a checklist item's move and remove). */
    extra: (@Composable () -> Unit)? = null,
) {
    // Opens focused with the cursor after the existing text, ready to type or delete.
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val text = field.text
    val focus = remember { FocusRequester() }
    val valid = text.isNotBlank()
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
        Column {
            // Material's field, not HelmTextField: it needs a TextFieldValue to place the cursor after the text.
            OutlinedTextField(
                value = field,
                onValueChange = { if (it.text.length <= maxLength) field = it },
                singleLine = true,
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
            extra?.invoke()
        }
    }
}

/**
 * A long text (the note) on a whole screen, so it is written at the phone's width in the reading font and size the
 * details show it in. Cancel, the title and Save stay in a bar on top, above the keyboard; the field takes the rest
 * and scrolls. It opens with the cursor after the text. Back cancels like Cancel: nothing is saved without Save.
 */
@Composable
fun LongTextEditor(title: String, initial: String, maxLength: Int, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val focus = remember { FocusRequester() }
    val p = palette
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        DialogBars(light = p.light)
        LaunchedEffect(Unit) { focus.requestFocus() }
        Column(
            Modifier
                .fillMaxSize()
                .background(p.background)
                // The keyboard is part of safeDrawing: the field ends above it and the bar never moves.
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .testTag(EditorTags.LONG_TEXT),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextAction(stringResource(R.string.cancel), onDismiss, color = p.textMuted)
                Text(
                    title,
                    style = helmType.title,
                    color = p.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                TextAction(stringResource(R.string.save), { onSave(field.text) }, modifier = Modifier.testTag(EditorTags.SAVE))
            }
            HorizontalDivider(thickness = 1.dp, color = p.border)
            BasicTextField(
                value = field,
                onValueChange = { if (it.text.length <= maxLength) field = it },
                textStyle = helmType.value.copy(color = p.text),
                cursorBrush = SolidColor(p.accent),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner ->
                    Box {
                        if (field.text.isEmpty()) Text(title, style = helmType.value, color = p.textMuted)
                        inner()
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = EDITOR_MARGIN, vertical = 12.dp)
                    .focusRequester(focus)
                    .testTag(EditorTags.FIELD),
            )
        }
    }
}

/** Status and navigation bar icons that stay readable on a full-screen dialog in this palette. */
@Composable
private fun DialogBars(light: Boolean) {
    val view = LocalView.current
    val window = (view.parent as? DialogWindowProvider)?.window ?: return
    SideEffect {
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }
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
                supportingText = if (full) pluralStringResource(R.plurals.labels_full, TaskRules.MAX_LABELS, TaskRules.MAX_LABELS) else null,
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

/** Side margin of the long-text editor: the field keeps over 90 % of a 360 dp phone. */
private val EDITOR_MARGIN = 16.dp
