package dev.helm.planner.ui.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDay
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate

/**
 * A day's tasks with their titles, from a long press on the day in the week of bars, where a bar is too small to read
 * or to hold: tasks without a time first, then by time. A tap on a task opens it; **Move** opens the move sheet for it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DaySheet(
    day: CalendarDay,
    onDismiss: () -> Unit,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    onOpenDay: (String) -> Unit,
) {
    val p = palette
    val title = LocalDate.parse(day.date).format(dateFormat("EEEEdMMMM", appLocale()))
    val move = stringResource(R.string.calendar_move_confirm)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = p.surface,
        shape = HelmShapes.sheet,
        modifier = Modifier.testTag(CalendarTags.DAY_SHEET),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = HelmDimens.screenMargin)
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, style = helmType.title, color = p.text, modifier = Modifier.padding(bottom = 6.dp).semantics { heading() })
            (day.untimed + day.timed).forEach { entry ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    EntryBlock(
                        entry,
                        onOpen,
                        onMove,
                        Modifier.weight(1f),
                        showTime = entry.time != null,
                        maxLines = 2,
                        tag = CalendarTags.sheetEntry(entry.key),
                    )
                    if (entry.movable) {
                        val label = stringResource(R.string.calendar_move_title, entry.task.title)
                        TextAction(
                            move,
                            { onMove(entry) },
                            Modifier.semantics { contentDescription = label }.testTag(CalendarTags.sheetMove(entry.key)),
                        )
                    }
                }
            }
            TextAction(
                stringResource(R.string.calendar_open_day),
                { onOpenDay(day.date) },
                Modifier.align(Alignment.End).testTag(CalendarTags.DAY_SHEET_OPEN_DAY),
            )
        }
    }
}
