package dev.helm.planner.ui.today

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.ui.components.ButtonTone
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.palette
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

/** Material date picker; it works in UTC midnights, converted here to a plain calendar date. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayPickerDialog(initial: LocalDate, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(
        initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
    )
    val colors = DatePickerDefaults.colors(containerColor = palette.surface)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        colors = colors,
        confirmButton = {
            TextAction(stringResource(R.string.ok), tone = ButtonTone.Accent, onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    ?: onDismiss()
            })
        },
        dismissButton = { TextAction(stringResource(R.string.cancel), onClick = onDismiss, color = palette.textMuted) },
    ) {
        DatePicker(state = state, colors = colors)
    }
}

/** Material time picker in a dialog; returns HH:MM as the backend expects it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimePickerDialog(initial: LocalTime, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
    val p = palette
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.surface,
        text = {
            TimePicker(
                state = state,
                colors = TimePickerDefaults.colors(
                    clockDialColor = p.surfaceRaised,
                    timeSelectorUnselectedContainerColor = p.surfaceRaised,
                    periodSelectorUnselectedContainerColor = p.surfaceRaised,
                ),
            )
        },
        confirmButton = { TextAction(stringResource(R.string.ok), tone = ButtonTone.Accent, onClick = { onPick(LocalTime.of(state.hour, state.minute).toString()) }) },
        dismissButton = { TextAction(stringResource(R.string.cancel), onClick = onDismiss, color = p.textMuted) },
    )
}
