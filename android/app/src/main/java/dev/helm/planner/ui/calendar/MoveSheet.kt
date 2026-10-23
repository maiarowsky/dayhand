package dev.helm.planner.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.components.ChoiceRow
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.DayPickerDialog
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle

/**
 * Moves one task: a day of its week (or any other day) and a time or none, in groups of rows as on Settings. Nothing
 * changes until Move; the screen then offers Undo. [onMove] gets the new day and time.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoveSheet(entry: CalendarEntry, onDismiss: () -> Unit, onMove: (date: String, time: String?) -> Unit) {
    val p = palette
    val locale = appLocale()
    var day by rememberSaveable(entry.key) { mutableStateOf(entry.date) }
    var time by rememberSaveable(entry.key) { mutableStateOf(entry.time) }
    var pickingDay by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    val week = CalendarDays.weekStart(LocalDate.parse(entry.date))
    val otherDay = LocalDate.parse(day).takeIf { it < week || it > week.plusDays(6) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = p.surface,
        shape = HelmShapes.sheet,
        modifier = Modifier.testTag(CalendarTags.MOVE_SHEET),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = HelmDimens.screenMargin)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.calendar_move_title, entry.task.title),
                style = helmType.title,
                color = p.text,
                modifier = Modifier.semantics { heading() },
            )
            SheetGroup(stringResource(R.string.calendar_move_day)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp).selectableGroup()) {
                    (0L until 7L).map { week.plusDays(it) }.forEach { date ->
                        DayChoice(date, day == date.toString(), { day = date.toString() }, Modifier.weight(1f).testTag(CalendarTags.moveDay(date.toString())))
                    }
                }
                HorizontalDivider(thickness = 1.dp, color = p.border)
                ListRow(
                    stringResource(R.string.calendar_move_other_day),
                    tag = CalendarTags.MOVE_OTHER_DAY,
                    value = otherDay?.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy", locale)),
                    trailing = otherDay?.let { { Chosen() } },
                    onClick = { pickingDay = true },
                )
            }
            SheetGroup(stringResource(R.string.calendar_move_time)) {
                ChoiceRow(stringResource(R.string.calendar_no_time), selected = time == null, tag = CalendarTags.MOVE_NO_TIME, onSelect = { time = null })
                HorizontalDivider(thickness = 1.dp, color = p.border)
                ListRow(
                    stringResource(R.string.calendar_move_pick_time),
                    tag = CalendarTags.MOVE_TIME,
                    value = time,
                    trailing = time?.let { { Chosen() } },
                    onClick = { pickingTime = true },
                )
            }
            PrimaryButton(
                stringResource(R.string.calendar_move_confirm),
                onClick = { onMove(day, time) },
                enabled = day != entry.date || time != entry.time,
                modifier = Modifier.fillMaxWidth().testTag(CalendarTags.MOVE_CONFIRM),
            )
        }
    }
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

/** A labelled group of rows on a raised card, as Settings' groups but on the sheet's colour. */
@Composable
private fun SheetGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    val p = palette
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(title, Modifier.padding(start = 4.dp, top = 4.dp), color = p.textMuted)
        Column(Modifier.fillMaxWidth().clip(HelmShapes.card).background(p.surfaceRaised), content = content)
    }
}

/** The check mark of the chosen row (shape, not colour alone). */
@Composable
private fun Chosen() = LineIconView(LineIcon.Check, palette.accent, size = HelmDimens.lineIcon)

/** One day of the task's week, drawn like the calendar's day headers: the chosen one in the accent, underlined. */
@Composable
private fun DayChoice(date: LocalDate, selected: Boolean, onSelect: () -> Unit, modifier: Modifier) {
    val p = palette
    val locale = appLocale()
    val color = if (selected) p.accent else p.textMuted
    Column(
        modifier
            .heightIn(min = HelmDimens.listRowMinHeight)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale), style = helmType.small, color = color, maxLines = 1)
        Text(date.dayOfMonth.toString(), style = if (selected) helmType.bodyStrong else helmType.body, color = if (selected) p.accent else p.text, maxLines = 1)
        Box(
            Modifier
                .padding(top = 4.dp)
                .size(width = 20.dp, height = 2.dp)
                .clip(CircleShape)
                .background(if (selected) p.accent else Color.Transparent),
        )
    }
}
