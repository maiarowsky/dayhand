package dev.helm.planner.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDay
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle

/** An hour is two touch targets high, so a 30-minute task is one. */
val HOUR_HEIGHT: Dp = HelmDimens.touchTarget * 2
val GUTTER_WIDTH: Dp = 48.dp

/** Room above the first hour shown, so its label (drawn just above its line) is not cut off. */
val HOUR_LABEL_ROOM: Dp = 16.dp

/** The gutter grows with the system font size, so "10:00" stays on one line. */
@Composable
fun gutterWidth(): Dp = GUTTER_WIDTH * LocalDensity.current.fontScale.coerceAtLeast(1f)
private const val HOURS = 24
private val BLOCK_HEIGHT = HOUR_HEIGHT * CalendarDays.EVENT_MINUTES / 60

/** Where the hours start scrolled to: an hour before now on today, else 07:00. */
fun firstHour(day: CalendarDay?, nowMinute: Int): Int = if (day?.isToday == true) (nowMinute / 60 - 1).coerceIn(0, 16) else 7

/** The hours of one or more days side by side, with the times on the left. Not scrollable itself. */
@Composable
fun HourGrid(
    days: List<CalendarDay>,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
    showTime: Boolean = false,
) {
    Row(modifier.fillMaxWidth().height(HOUR_HEIGHT * HOURS)) {
        HourLabels(Modifier.width(gutterWidth()).fillMaxHeight())
        days.forEach { day -> DayColumn(day, nowMinute, onOpen, onMove, showTime, Modifier.weight(1f).fillMaxHeight()) }
    }
}

@Composable
private fun HourLabels(modifier: Modifier) {
    val p = palette
    Column(modifier) {
        repeat(HOURS) { hour ->
            Box(Modifier.height(HOUR_HEIGHT).fillMaxWidth().padding(end = 6.dp), contentAlignment = Alignment.TopEnd) {
                if (hour > 0) Text("%02d:00".format(hour), style = helmType.small, color = p.textFaint, maxLines = 1, softWrap = false, modifier = Modifier.offset(y = (-9).dp))
            }
        }
    }
}

@Composable
private fun DayColumn(
    day: CalendarDay,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    showTime: Boolean,
    modifier: Modifier,
) {
    val p = palette
    BoxWithConstraints(
        modifier
            .background(if (day.isToday) p.accentSoft.copy(alpha = 0.35f) else p.background)
            .drawBehind {
                val hour = HOUR_HEIGHT.toPx()
                for (h in 0 until HOURS) {
                    drawLine(p.border, Offset(0f, h * hour), Offset(size.width, h * hour), strokeWidth = 1.dp.toPx())
                }
                drawLine(p.border, Offset(0f, 0f), Offset(0f, size.height), strokeWidth = 1.dp.toPx())
            },
    ) {
        val laneSpace = maxWidth
        val bottom = HOUR_HEIGHT * HOURS - BLOCK_HEIGHT
        CalendarDays.lanes(day.timed).forEach { placed ->
            val width = laneSpace / placed.lanes
            val top = minOf(HOUR_HEIGHT * placed.startMinute / 60, bottom)
            EntryBlock(
                placed.entry,
                onOpen,
                onMove,
                Modifier
                    .offset(x = width * placed.lane + 1.dp, y = top)
                    .width(width - 2.dp)
                    .height(BLOCK_HEIGHT),
                showTime = showTime,
                maxLines = if (showTime) 1 else 2,
            )
        }
        if (day.isToday) {
            Box(
                Modifier
                    .offset(y = HOUR_HEIGHT * nowMinute / 60)
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(p.accent)
                    .testTag(CalendarTags.NOW_LINE),
            )
        }
    }
}

/** A day above the week's columns: short weekday and number, today in the accent; a tap opens the day. */
@Composable
fun DayHeader(day: CalendarDay, onOpenDay: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    val date = LocalDate.parse(day.date)
    val locale = appLocale()
    val description = buildString {
        append(date.format(DateTimeFormatter.ofPattern("EEEE d MMMM", locale)))
        if (day.isToday) append(", ").append(stringResource(R.string.day_today))
    }
    val openLabel = stringResource(R.string.calendar_open_day)
    Column(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clickable(onClickLabel = openLabel) { onOpenDay(day.date) }
            .semantics(mergeDescendants = true) {
                heading()
                contentDescription = description
            }
            .padding(vertical = 4.dp)
            .testTag(CalendarTags.dayHeader(day.date)),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale),
            style = helmType.small,
            color = if (day.isToday) p.accent else p.textMuted,
            maxLines = 1,
        )
        Box(
            Modifier
                .size(30.dp)
                .clip(CircleShape)
                .background(if (day.isToday) p.accent else p.background),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                date.dayOfMonth.toString(),
                style = helmType.smallStrong,
                color = if (day.isToday) p.onAccent else p.text,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The week's day headers over the columns, with the gutter's room on the left. */
@Composable
fun DayHeaders(days: List<CalendarDay>, onOpenDay: (String) -> Unit) {
    Row(Modifier.fillMaxWidth()) {
        Spacer(Modifier.width(gutterWidth()))
        days.forEach { DayHeader(it, onOpenDay, Modifier.weight(1f)) }
    }
}

/** Tasks without a time, a band over the week's hours: [visible] per day, then "+n" that opens the day. */
@Composable
fun UntimedBand(days: List<CalendarDay>, onOpen: (CalendarEntry) -> Unit, onMove: (CalendarEntry) -> Unit, onOpenDay: (String) -> Unit, visible: Int = 2) {
    if (days.all { it.untimed.isEmpty() }) return
    val p = palette
    Row(Modifier.fillMaxWidth().background(p.surface).padding(vertical = 2.dp)) {
        Box(Modifier.width(gutterWidth()).padding(end = 6.dp, top = 4.dp), contentAlignment = Alignment.TopEnd) {
            Text(stringResource(R.string.calendar_no_time_short), style = helmType.small, color = p.textFaint, textAlign = TextAlign.End)
        }
        days.forEach { day ->
            Column(Modifier.weight(1f).padding(horizontal = 1.dp)) {
                val shown = if (day.untimed.size > visible) day.untimed.take(visible - 1) else day.untimed
                shown.forEach { EntryBlock(it, onOpen, onMove, Modifier.fillMaxWidth().padding(vertical = 1.dp)) }
                val hidden = day.untimed.size - shown.size
                if (hidden > 0) MoreEntries(hidden, day.date, onOpenDay)
            }
        }
    }
}
