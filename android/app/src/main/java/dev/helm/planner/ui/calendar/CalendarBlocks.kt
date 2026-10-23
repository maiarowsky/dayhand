package dev.helm.planner.ui.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.Palette
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object CalendarTags {
    const val SCREEN = "calendar"
    const val WEEK = "calendar_week"
    const val DAY = "calendar_day"
    const val MODE_WEEK = "calendar_mode_week"
    const val MODE_DAY = "calendar_mode_day"
    const val PREVIOUS = "calendar_previous"
    const val NEXT = "calendar_next"
    const val TODAY = "calendar_today"
    const val RANGE = "calendar_range"
    const val NOW_LINE = "calendar_now"
    const val MOVE_SHEET = "calendar_move"
    const val MOVE_CONFIRM = "calendar_move_confirm"
    const val MOVE_NO_TIME = "calendar_move_no_time"

    fun entry(key: String) = "calendar_entry:$key"
    fun dayHeader(date: String) = "calendar_day_header:$date"
    fun moveDay(date: String) = "calendar_move_day:$date"
}

/** Colours of an entry: overdue in the danger colour, done and later dates of a series quiet, the rest in the accent. */
private data class EntryColors(val background: Color, val bar: Color, val text: Color)

private fun Palette.colorsOf(entry: CalendarEntry) = when {
    entry.done -> EntryColors(surfaceRaised, textFaint, textMuted)
    entry.overdue -> EntryColors(dangerSoft, danger, text)
    entry.repeat -> EntryColors(surfaceRaised, accentDim, textMuted)
    else -> EntryColors(accentSoft, accent, text)
}

/** The title with a mark that does not rely on colour: "!" overdue, "↻" a later date of a series, "✓" done. */
private fun markedTitle(entry: CalendarEntry): String = when {
    entry.done -> "✓ ${entry.task.title}"
    entry.overdue -> "! ${entry.task.title}"
    entry.repeat -> "↻ ${entry.task.title}"
    else -> entry.task.title
}

/** What a screen reader says: title, day, time (or none), and its state. */
@Composable
fun entryDescription(entry: CalendarEntry): String {
    val day = LocalDate.parse(entry.date).format(DateTimeFormatter.ofPattern("EEEE d MMMM", appLocale()))
    val parts = buildList {
        add(entry.task.title)
        add(day)
        add(entry.time ?: stringResource(R.string.calendar_no_time))
        if (entry.overdue) add(stringResource(R.string.calendar_state_overdue))
        if (entry.done) add(stringResource(R.string.calendar_state_done))
        if (entry.repeat) add(stringResource(R.string.calendar_state_repeat))
    }
    return parts.joinToString(", ")
}

/**
 * One task in the calendar, at least 48 dp high: a tap opens its details; a long press (or the screen reader's
 * "Move" action) moves it, when it is the task's own date and not done.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun EntryBlock(
    entry: CalendarEntry,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
    showTime: Boolean = false,
    maxLines: Int = 2,
) {
    val p = palette
    val colors = p.colorsOf(entry)
    val description = entryDescription(entry)
    val moveLabel = stringResource(R.string.calendar_move_action)
    Row(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .height(IntrinsicSize.Min)
            .clip(HelmShapes.badge)
            .background(colors.background)
            .combinedClickable(
                onClickLabel = stringResource(R.string.calendar_open),
                onLongClickLabel = if (entry.movable) moveLabel else null,
                onLongClick = if (entry.movable) ({ onMove(entry) }) else null,
                onClick = { onOpen(entry) },
            )
            .semantics(mergeDescendants = true) {
                contentDescription = description
                if (entry.movable) customActions = listOf(CustomAccessibilityAction(moveLabel) { onMove(entry); true })
            }
            .testTag(CalendarTags.entry(entry.key)),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(colors.bar))
        Column(Modifier.align(Alignment.CenterVertically).padding(horizontal = 4.dp, vertical = 3.dp)) {
            if (showTime && entry.time != null) Text(entry.time, style = helmType.small, color = p.textMuted, maxLines = 1)
            Text(
                markedTitle(entry),
                style = helmType.smallStrong,
                color = colors.text,
                maxLines = maxLines,
                overflow = TextOverflow.Ellipsis,
                textDecoration = if (entry.done) TextDecoration.LineThrough else null,
            )
        }
    }
}

/** A task without a time in the day view: one full-width row. */
@Composable
fun EntryRow(entry: CalendarEntry, onOpen: (CalendarEntry) -> Unit, onMove: (CalendarEntry) -> Unit) {
    EntryBlock(
        entry,
        onOpen,
        onMove,
        Modifier
            .fillMaxWidth()
            .padding(horizontal = HelmDimens.screenMargin, vertical = 3.dp),
        maxLines = 3,
    )
}

/** "+3": more tasks than fit in a week's day; opens that day. */
@Composable
fun MoreEntries(count: Int, date: String, onOpenDay: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    val label = stringResource(R.string.calendar_more_described, count)
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.badge)
            .combinedClickable(onClickLabel = label, onClick = { onOpenDay(date) })
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text(stringResource(R.string.calendar_more, count), style = helmType.smallStrong, color = p.accent)
    }
}
