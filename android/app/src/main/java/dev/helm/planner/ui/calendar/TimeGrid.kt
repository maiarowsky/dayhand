package dev.helm.planner.ui.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDay
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle

/** An hour is two touch targets high, so a 30-minute task is one. */
val HOUR_HEIGHT: Dp = HelmDimens.touchTarget * 2
val GUTTER_WIDTH: Dp = 48.dp

/** How strongly today's column is tinted: enough to find it, not enough to compete with its tasks. */
private const val TODAY_TINT = 0.22f

/** Room above the first hour shown, so its label (drawn just above its line) is not cut off. */
val HOUR_LABEL_ROOM: Dp = 16.dp

/** The gutter grows with the system font size, so "10:00" stays on one line. */
@Composable
fun gutterWidth(): Dp = GUTTER_WIDTH * LocalDensity.current.fontScale.coerceAtLeast(1f)
const val HOURS = 24
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
        HourLabels(Modifier.width(gutterWidth()).fillMaxHeight(), days.map { it.date })
        days.forEach { day -> DayColumn(day, nowMinute, onOpen, onMove, showTime, Modifier.weight(1f).fillMaxHeight()) }
    }
}

/** The hours' times; while a task is dragged over one of [dates], the time it would get, over them. */
@Composable
internal fun HourLabels(modifier: Modifier, dates: List<String>) {
    val p = palette
    Box(modifier) {
        Column(Modifier.fillMaxSize()) {
            repeat(HOURS) { hour ->
                Box(Modifier.height(HOUR_HEIGHT).fillMaxWidth().padding(end = 6.dp), contentAlignment = Alignment.TopEnd) {
                    if (hour > 0) Text("%02d:00".format(hour), style = helmType.small, color = p.textFaint, maxLines = 1, softWrap = false, modifier = Modifier.offset(y = LABEL_SHIFT))
                }
            }
        }
        GuideTime(dates)
    }
}

/** Hour labels sit centred on their line. */
private val LABEL_SHIFT = (-9).dp

@Composable
private fun GuideTime(dates: List<String>) {
    val p = palette
    val drag = LocalCalendarDrag.current ?: return
    val time = drag.target?.takeIf { drag.moved && it.date in dates }?.time ?: return
    Text(
        time,
        style = helmType.smallStrong,
        color = p.text,
        maxLines = 1,
        softWrap = false,
        textAlign = TextAlign.End,
        modifier = Modifier
            .offset(y = HOUR_HEIGHT * CalendarDays.minuteOf(time) / 60 + LABEL_SHIFT)
            .fillMaxWidth()
            .background(p.background)
            .padding(end = 6.dp)
            .testTag(CalendarTags.DRAG_GUIDE),
    )
}

/** While a task is dragged over [date] at a time, a line where its block would start. */
@Composable
private fun Modifier.dragGuide(date: String): Modifier {
    val drag = LocalCalendarDrag.current ?: return this
    val color = palette.text
    return drawWithContent {
        drawContent()
        val time = drag.target?.takeIf { drag.moved && it.date == date }?.time ?: return@drawWithContent
        val y = HOUR_HEIGHT.toPx() * CalendarDays.minuteOf(time) / 60
        drawLine(color, Offset(0f, y), Offset(size.width, y), strokeWidth = GUIDE_WIDTH.toPx())
    }
}

private val GUIDE_WIDTH = 2.dp

/** In the week of bars, what a finger on a day does away from its bars: a tap opens the day, a long press its tasks. */
class DayTouch(val open: () -> Unit, val hold: (() -> Unit)?)

/** One day's hours: its timed tasks as blocks with titles, or with [touch] as bars without them. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun DayColumn(
    day: CalendarDay,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    showTime: Boolean,
    modifier: Modifier,
    touch: DayTouch? = null,
) {
    val p = palette
    BoxWithConstraints(
        modifier
            .background(if (day.isToday) p.accentSoft.copy(alpha = TODAY_TINT) else p.background)
            .dragGuide(day.date)
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
        // Under the bars, for the finger only: the header says the same to a screen reader.
        if (touch != null) {
            Box(Modifier.fillMaxSize().combinedClickable(onLongClick = touch.hold, onClick = touch.open).clearAndSetSemantics {})
        }
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
                bar = touch != null,
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

/**
 * A day above the week's columns: short weekday (or its first letter when the short names do not fit, [narrow]) and
 * number; today in the accent, underlined; a tap opens the day.
 */
@Composable
fun DayHeader(day: CalendarDay, onOpenDay: (String) -> Unit, modifier: Modifier = Modifier, narrow: Boolean = false) {
    val p = palette
    val date = LocalDate.parse(day.date)
    val locale = appLocale()
    val description = buildString {
        append(date.format(dateFormat("EEEEdMMMM", locale)))
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
            .padding(top = 4.dp)
            .testTag(CalendarTags.dayHeader(day.date)),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val color = if (day.isToday) p.accent else p.textMuted
        Text(date.dayOfWeek.getDisplayName(if (narrow) TextStyle.NARROW else TextStyle.SHORT, locale), style = helmType.small, color = color, maxLines = 1, softWrap = false)
        Text(
            date.dayOfMonth.toString(),
            style = if (day.isToday) helmType.bodyStrong else helmType.body,
            color = if (day.isToday) p.accent else p.text,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
        // Today is marked by a line as well as by colour.
        Box(
            Modifier
                .padding(top = 4.dp)
                .size(width = 24.dp, height = 2.dp)
                .clip(CircleShape)
                .background(if (day.isToday) p.accent else Color.Transparent),
        )
    }
}

/** Whether every short weekday name ("pon.", "niedz.") fits a column [width] wide. */
@Composable
fun shortWeekdaysFit(width: Dp): Boolean {
    val measurer = rememberTextMeasurer()
    val locale = appLocale()
    val style = helmType.small
    val room = with(LocalDensity.current) { (width - HEADER_SPACE).roundToPx() }
    return remember(locale, style, room) {
        DayOfWeek.entries.all { measurer.measure(it.getDisplayName(TextStyle.SHORT, locale), style, softWrap = false).size.width <= room }
    }
}

/** Space kept either side of a weekday in its header. */
private val HEADER_SPACE = 4.dp

/** "All day" in the hours' column, beside the band of tasks without a time. */
@Composable
fun UntimedLabel(modifier: Modifier = Modifier) {
    Box(modifier.padding(end = 6.dp, top = 8.dp), contentAlignment = Alignment.TopEnd) {
        Text(stringResource(R.string.calendar_no_time_short), style = helmType.small, color = palette.textFaint, textAlign = TextAlign.End)
    }
}

/** One day's tasks without a time, in the band over the hours: [visible] of them, then "+n" that opens the day. */
@Composable
fun UntimedDay(
    day: CalendarDay,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    onOpenDay: (String) -> Unit,
    modifier: Modifier = Modifier,
    visible: Int = 2,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = 1.dp, vertical = 2.dp)) {
        val shown = if (day.untimed.size > visible) day.untimed.take(visible - 1) else day.untimed
        shown.forEach { EntryBlock(it, onOpen, onMove, Modifier.fillMaxWidth().padding(vertical = 1.dp)) }
        val hidden = day.untimed.size - shown.size
        if (hidden > 0) MoreEntries(hidden, day.date, onOpenDay)
    }
}

/** How high a task without a time is in the week of bars, and how its corners are rounded. */
private val SHORT_BAR = 6.dp
private val SHORT_BAR_SHAPE = RoundedCornerShape(2.dp)

/**
 * One day's tasks without a time in the week of bars: a short bar each in its colour, [visible] at most, then "+n".
 * A tap opens the day; a long press, its tasks with their titles.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun UntimedBars(day: CalendarDay, onOpenDay: (String) -> Unit, onHoldDay: (CalendarDay) -> Unit, modifier: Modifier = Modifier, visible: Int = 3) {
    val p = palette
    val untimed = day.untimed
    val touch = if (untimed.isEmpty()) {
        Modifier
    } else {
        val description = stringResource(R.string.calendar_untimed_described, untimed.joinToString(", ") { it.task.title })
        Modifier
            .combinedClickable(
                onClickLabel = stringResource(R.string.calendar_open_day),
                onLongClickLabel = stringResource(R.string.calendar_day_tasks),
                onLongClick = { onHoldDay(day) },
                onClick = { onOpenDay(day.date) },
            )
            .semantics(mergeDescendants = true) { contentDescription = description }
    }
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .then(touch)
            .padding(horizontal = 4.dp, vertical = 6.dp)
            .testTag(CalendarTags.untimedBars(day.date)),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        val shown = if (untimed.size > visible) untimed.take(visible - 1) else untimed
        shown.forEach { Box(Modifier.fillMaxWidth().height(SHORT_BAR).clip(SHORT_BAR_SHAPE).background(p.colorsOf(it).bar)) }
        val hidden = untimed.size - shown.size
        if (hidden > 0) Text(stringResource(R.string.calendar_more, hidden), style = helmType.small, color = p.textMuted, maxLines = 1, softWrap = false)
    }
}

/** While a task is dragged over [date] without a time (the headers, the band), that day is tinted there. */
@Composable
fun Modifier.untimedDrop(date: String): Modifier {
    val drag = LocalCalendarDrag.current ?: return this
    val tint = palette.accentSoft
    return drawBehind { if (drag.moved && drag.target == DropTarget(date, null)) drawRect(tint) }
}
