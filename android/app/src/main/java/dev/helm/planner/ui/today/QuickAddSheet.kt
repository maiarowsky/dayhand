package dev.helm.planner.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.LocalTime

object QuickAddTags {
    const val TITLE = "quick_add_title"
    const val SAVE = "quick_add_save"
}

/**
 * One title field and one tap to save; day (today by default), time and note are behind
 * "More options". The keyboard's Done key saves too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickAddSheet(
    today: LocalDate,
    onDismiss: () -> Unit,
    onSave: (title: String, dueDate: String, dueTime: String?, note: String?) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf("") }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var day by rememberSaveable { mutableStateOf(today.toString()) }
    var time by rememberSaveable { mutableStateOf<String?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val canSave = title.isNotBlank()
    val save = { if (canSave) onSave(title.trim(), day, time, note.trim().ifEmpty { null }) }

    val p = palette
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = p.surface,
        contentColor = p.text,
        shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = p.border) },
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = HelmDimens.screenMargin)
                .padding(bottom = 24.dp)
                .imePadding()
                .verticalScroll(rememberScrollState()),
        ) {
            Text(stringResource(R.string.quick_add_title), style = helmType.screenTitle, color = p.text)
            HelmTextField(
                value = title,
                onValueChange = { if (it.length <= TaskRepository.MAX_TITLE) title = it },
                label = stringResource(R.string.quick_add_field),
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
                modifier = Modifier
                    .focusRequester(focus)
                    .testTag(QuickAddTags.TITLE),
            )
            // Save sits right under the title so the keyboard never hides it.
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextAction(
                    stringResource(if (expanded) R.string.quick_add_less else R.string.quick_add_more),
                    onClick = { expanded = !expanded },
                    color = p.secondary,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                PrimaryButton(
                    stringResource(R.string.quick_add_save),
                    onClick = save,
                    enabled = canSave,
                    fillWidth = false,
                    modifier = Modifier.testTag(QuickAddTags.SAVE),
                )
            }
            if (expanded) {
                MoreOptions(
                    today = today,
                    day = day,
                    time = time,
                    note = note,
                    onDay = { day = it },
                    onPickDay = { pickingDay = true },
                    onPickTime = { pickingTime = true },
                    onClearTime = { time = null },
                    onNote = { note = it },
                )
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
    if (pickingDay) {
        DayPickerDialog(LocalDate.parse(day), onDismiss = { pickingDay = false }) {
            day = it.toString()
            pickingDay = false
        }
    }
    if (pickingTime) {
        TimePickerDialog(time?.let(LocalTime::parse) ?: LocalTime.of(9, 0), onDismiss = { pickingTime = false }) {
            time = it
            pickingTime = false
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoreOptions(
    today: LocalDate,
    day: String,
    time: String?,
    note: String,
    onDay: (String) -> Unit,
    onPickDay: () -> Unit,
    onPickTime: () -> Unit,
    onClearTime: () -> Unit,
    onNote: (String) -> Unit,
) {
    val tomorrow = today.plusDays(1).toString()
    val other = day != today.toString() && day != tomorrow
    val muted = palette.textMuted
    SectionLabel(stringResource(R.string.quick_add_day), color = muted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HelmChip(stringResource(R.string.quick_add_today), selected = day == today.toString(), onClick = { onDay(today.toString()) })
        HelmChip(stringResource(R.string.quick_add_tomorrow), selected = day == tomorrow, onClick = { onDay(tomorrow) })
        HelmChip(
            if (other) LocalDate.parse(day).format(dateFormat("EEEdMMM", appLocale()))
            else stringResource(R.string.move_to_day),
            selected = other,
            onClick = onPickDay,
        )
    }
    SectionLabel(stringResource(R.string.quick_add_time), color = muted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HelmChip(stringResource(R.string.quick_add_no_time), selected = time == null, onClick = onClearTime)
        HelmChip(time ?: stringResource(R.string.quick_add_time), selected = time != null, onClick = onPickTime)
    }
    HelmTextField(
        value = note,
        onValueChange = { if (it.length <= TaskRepository.MAX_NOTE) onNote(it) },
        label = stringResource(R.string.quick_add_note),
        minLines = 2,
    )
}
