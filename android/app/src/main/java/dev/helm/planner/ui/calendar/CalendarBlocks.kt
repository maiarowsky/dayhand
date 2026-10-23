package dev.helm.planner.ui.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
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

/** The coloured edge of a block, which carries its state (accent, danger, quiet). */
private val BAR_WIDTH = 3.dp

/** The block left in place while it is dragged. */
private const val DRAGGED_ALPHA = 0.4f

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
    const val MOVE_TIME = "calendar_move_time"
    const val MOVE_OTHER_DAY = "calendar_move_other_day"
    const val DROP_UNTIMED = "calendar_drop_untimed"
    const val DRAG_GUIDE = "calendar_drag_guide"
    const val DAY_SHEET = "calendar_day_sheet"
    const val DAY_SHEET_OPEN_DAY = "calendar_day_sheet_open_day"

    fun entry(key: String) = "calendar_entry:$key"
    fun dayHeader(date: String) = "calendar_day_header:$date"
    fun moveDay(date: String) = "calendar_move_day:$date"
    fun untimedBars(date: String) = "calendar_untimed_bars:$date"
    fun sheetEntry(key: String) = "calendar_sheet_entry:$key"
    fun sheetMove(key: String) = "calendar_sheet_move:$key"
}

/** Colours of an entry: overdue in the danger colour, done and later dates of a series quiet, the rest in the accent. */
internal data class EntryColors(val background: Color, val bar: Color, val text: Color)

internal fun Palette.colorsOf(entry: CalendarEntry) = when {
    entry.done -> EntryColors(surfaceRaised, textFaint, textMuted)
    entry.overdue -> EntryColors(dangerSoft, danger, text)
    entry.repeat -> EntryColors(surfaceRaised, accentDim, textMuted)
    else -> EntryColors(accentSoft, accent, text)
}

/** A mark that does not rely on colour: "!" overdue, "↻" a later date of a series, "✓" done; none for the rest. */
private fun markOf(entry: CalendarEntry): String? = when {
    entry.done -> "✓"
    entry.overdue -> "!"
    entry.repeat -> "↻"
    else -> null
}

/** The title with its mark. */
private fun markedTitle(entry: CalendarEntry): String {
    val mark = markOf(entry) ?: return entry.task.title
    // A no-break space keeps the mark on the line of the first word.
    return "$mark\u00A0${entry.task.title.trimStart()}"
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
 * One task in the calendar, at least 48 dp high: a tap opens its details; a long press lifts it to drag to another
 * day or time (see [CalendarDragHost]), and let go without moving (or the screen reader's "Move" action) opens the move
 * sheet; only when it is the task's own date and not done. A [bar] has no title (the week on a phone held upright).
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
    bar: Boolean = false,
    tag: String = CalendarTags.entry(entry.key),
) {
    val description = entryDescription(entry)
    val moveLabel = stringResource(R.string.calendar_move_action)
    val drag = LocalCalendarDrag.current
    val placed = remember { Placed() }
    val outer = modifier
        .onPlaced { placed.coordinates = it }
        .graphicsLayer { alpha = if (drag?.entry?.key == entry.key) DRAGGED_ALPHA else 1f }
    val behaviour = Modifier
        .combinedClickable(
            onClickLabel = stringResource(R.string.calendar_open),
            onLongClickLabel = if (entry.movable) moveLabel else null,
            onLongClick = if (entry.movable) ({ if (drag?.lift(entry, placed.coordinates) != true) onMove(entry) }) else null,
            onClick = { onOpen(entry) },
        )
        .semantics(mergeDescendants = true) {
            contentDescription = description
            if (entry.movable) customActions = listOf(CustomAccessibilityAction(moveLabel) { onMove(entry); true })
        }
        .testTag(tag)
    if (bar) BarFace(entry, outer, behaviour) else EntryFace(entry, if (showTime) entry.time else null, maxLines, outer, behaviour)
}

/** Where a block is, for lifting it. */
private class Placed {
    var coordinates: LayoutCoordinates? = null
}

/** How a block looks: its colours and edge, [time] (if any) over the title. [behaviour] goes inside the clip. */
@Composable
internal fun EntryFace(entry: CalendarEntry, time: String?, maxLines: Int, modifier: Modifier, behaviour: Modifier = Modifier) {
    val p = palette
    val colors = p.colorsOf(entry)
    Box(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.badge)
            .background(colors.background)
            .drawBehind { drawRect(colors.bar, size = Size(BAR_WIDTH.toPx(), size.height)) }
            .then(behaviour),
        contentAlignment = Alignment.CenterStart,
    ) {
        // No padding above and below: the lines are centred, and a half-hour block keeps two lines at a larger font.
        Column(Modifier.padding(start = BAR_WIDTH + 5.dp, end = 4.dp)) {
            if (time != null) Text(time, style = helmType.small, color = p.textMuted, maxLines = 1)
            WordTitle(
                markedTitle(entry),
                style = helmType.smallStrong,
                color = colors.text,
                maxLines = maxLines,
                textDecoration = if (entry.done) TextDecoration.LineThrough else null,
            )
        }
    }
}

/** How a bar looks: a block's colours and edge, with only its mark (if any) where the title would be. */
@Composable
private fun BarFace(entry: CalendarEntry, modifier: Modifier, behaviour: Modifier) {
    val colors = palette.colorsOf(entry)
    Box(
        modifier
            .heightIn(min = HelmDimens.touchTarget)
            .clip(HelmShapes.badge)
            .background(colors.background)
            .drawBehind { drawRect(colors.bar, size = Size(BAR_WIDTH.toPx(), size.height)) }
            .then(behaviour),
        contentAlignment = Alignment.TopCenter,
    ) {
        markOf(entry)?.let { Text(it, style = helmType.small, color = colors.bar, maxLines = 1, softWrap = false, modifier = Modifier.padding(start = BAR_WIDTH, top = 2.dp)) }
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
