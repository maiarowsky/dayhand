package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.components.ButtonTone
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
    const val CANCEL = "editor-cancel"
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
 * A long text (the note) in a sheet from the bottom of the screen: the phone's whole width, about nine tenths of its
 * height, with its handle, and the reading font and size the details show the note in. Cancel, the title and Save
 * stay in a bar on top, above the keyboard; the field takes the rest and scrolls. It opens with the cursor after the
 * text. Back cancels like Cancel: nothing is saved without Save. A tap above the sheet does nothing, and once the
 * text is changed the sheet cannot be dragged away either, so no edit is lost by accident.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LongTextEditor(title: String, initial: String, maxLength: Int, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val focus = remember { FocusRequester() }
    val p = palette
    val changed = field.text != initial
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        sheetGesturesEnabled = !changed,
        containerColor = p.surface,
        contentColor = p.text,
        shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = p.border) },
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = true, shouldDismissOnClickOutside = false),
        modifier = Modifier.testTag(EditorTags.LONG_TEXT),
    ) {
        LaunchedEffect(Unit) { focus.requestFocus() }
        // The sheet keeps itself above the keyboard (its content insets include it), so the bar never moves.
        Column(Modifier.fillMaxWidth().fillMaxHeight(SHEET_HEIGHT)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextAction(stringResource(R.string.cancel), onDismiss, color = p.textMuted, modifier = Modifier.testTag(EditorTags.CANCEL))
                Text(
                    title,
                    style = helmType.title,
                    color = p.text,
                    // Two lines with large text, so the name is never cut between Cancel and Save.
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).padding(horizontal = 4.dp).semantics { heading() },
                )
                TextAction(stringResource(R.string.save), { onSave(field.text) }, tone = ButtonTone.Accent, modifier = Modifier.testTag(EditorTags.SAVE))
            }
            HorizontalDivider(thickness = 1.dp, color = p.border, modifier = Modifier.padding(top = 4.dp))
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

/** Side margin of the long-text editor: the field keeps over 90 % of a 360 dp phone. */
private val EDITOR_MARGIN = 16.dp

/** The note's sheet takes this much of the screen's height (less the keyboard while it is open). */
private const val SHEET_HEIGHT = 0.9f
