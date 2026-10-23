package dev.helm.planner.ui.calendar

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.components.ActionChip
import dev.helm.planner.ui.components.HelmChip
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

/**
 * Moves one task: a day of its week (or any other day) and a time or none. Nothing changes until Move; the screen
 * then offers Undo. [onMove] gets the new day and time.
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
    val chipFormat = DateTimeFormatter.ofPattern("EEE d", locale)
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
            SectionLabel(stringResource(R.string.calendar_move_day), color = p.textMuted)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (0L until 7L).map { week.plusDays(it) }.forEach { date ->
                    HelmChip(
                        date.format(chipFormat),
                        selected = day == date.toString(),
                        onClick = { day = date.toString() },
                        modifier = Modifier.testTag(CalendarTags.moveDay(date.toString())),
                    )
                }
                val otherDay = LocalDate.parse(day).let { if (it < week || it > week.plusDays(6)) it.format(DateTimeFormatter.ofPattern("d MMM", locale)) else null }
                ActionChip(otherDay ?: stringResource(R.string.calendar_move_other_day), onClick = { pickingDay = true })
            }
            SectionLabel(stringResource(R.string.calendar_move_time), color = p.textMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HelmChip(
                    stringResource(R.string.calendar_no_time),
                    selected = time == null,
                    onClick = { time = null },
                    modifier = Modifier.testTag(CalendarTags.MOVE_NO_TIME),
                )
                ActionChip(time ?: stringResource(R.string.calendar_move_pick_time), onClick = { pickingTime = true })
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
