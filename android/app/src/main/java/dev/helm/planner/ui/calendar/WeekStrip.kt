package dev.helm.planner.ui.calendar

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.MutatePriority
import androidx.compose.foundation.MutatorMutex
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.DragScope
import androidx.compose.foundation.gestures.DraggableState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.CalendarDay
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlinx.coroutines.coroutineScope

/**
 * Narrowest a day column gets for its tasks' titles. Narrower (a phone held upright: about 50 dp), the week shows its
 * tasks as bars without titles; a tablet or a phone on its side (from about 610 dp wide) keeps the titles.
 */
val TITLED_DAY_WIDTH: Dp = 80.dp
const val WEEK_DAYS = 7

/** A swipe faster than this turns the week even when it moved less than half of it (as the pager did). */
private val FLING_VELOCITY = 400.dp

/** Whether the week's seven columns in [width] next to the hours' [gutter] are too narrow for titles: bars instead. */
fun barsOnly(width: Dp, gutter: Dp): Boolean = (width - gutter) / WEEK_DAYS < TITLED_DAY_WIDTH

/**
 * Where the week view is: the column [offset] days after [anchor] (the epoch day of a Monday) comes first, with a
 * fraction while the days move. Swipes drag it; [settle], [animateTo] and [snapTo] put it back on a Monday.
 */
@Stable
class WeekStripState(val anchor: Long, offset: Float) : DraggableState {
    var offset by mutableFloatStateOf(offset)
        private set

    /** The first day in view, as an index from [anchor]. */
    val firstDay: Int by derivedStateOf { this.offset.roundToInt() }

    /** One day column in pixels, from the last layout. */
    internal var dayPx = 1f

    private val mutex = MutatorMutex()
    private val dragScope = object : DragScope {
        override fun dragBy(pixels: Float) = dispatchRawDelta(pixels)
    }

    fun date(index: Int): LocalDate = LocalDate.ofEpochDay(anchor + index)
    fun indexOf(date: LocalDate): Int = (date.toEpochDay() - anchor).toInt()

    /** Where "Today" goes: the week that has today. */
    fun home(today: LocalDate): Int = indexOf(CalendarDays.weekStart(today))

    /** The Monday of the week of a column index. */
    fun weekOf(index: Int): Int = Math.floorDiv(index, WEEK_DAYS) * WEEK_DAYS

    override fun dispatchRawDelta(delta: Float) {
        offset -= delta / dayPx
    }

    override suspend fun drag(dragPriority: MutatePriority, block: suspend DragScope.() -> Unit) = coroutineScope {
        mutex.mutateWith(dragScope, dragPriority, block)
    }

    fun snapTo(index: Int) {
        offset = index.toFloat()
    }

    suspend fun animateTo(index: Int, velocity: Float = 0f) = mutex.mutate {
        animate(offset, index.toFloat(), velocity, spring(stiffness = Spring.StiffnessMediumLow)) { value, _ -> offset = value }
    }

    /** After a swipe at [velocityPx]: on to the next or previous week, or back. */
    suspend fun settle(velocityPx: Float, flingPx: Float) {
        val weeks = offset / WEEK_DAYS
        val target = WEEK_DAYS * when {
            velocityPx < -flingPx -> floor(weeks + 1).toInt()
            velocityPx > flingPx -> ceil(weeks - 1).toInt()
            else -> weeks.roundToInt()
        }
        animateTo(target, -velocityPx / dayPx)
    }
}

/** The week view's position, kept across rotation, on the Monday of a week. */
@Composable
fun rememberWeekStripState(today: LocalDate): WeekStripState =
    rememberSaveable(
        saver = listSaver<WeekStripState, Any>(
            save = { listOf(it.anchor, it.firstDay) },
            restore = { WeekStripState(it[0] as Long, 0f).apply { snapTo(weekOf(it[1] as Int)) } },
        ),
    ) {
        WeekStripState(CalendarDays.weekStart(today).toEpochDay(), 0f).apply { snapTo(home(today)) }
    }

/**
 * The week, Monday to Sunday: seven columns of hours side by side with the times on the left, the day headers and the
 * tasks without a time pinned above them. Swiping turns the week; the headers, the band and the hours move together.
 * With [bars] (a phone held upright) the tasks are bars without titles, a tap on a day opens it and a long press on a
 * day opens its tasks with their titles ([onHoldDay]).
 */
@Composable
fun WeekView(
    state: WeekStripState,
    bars: Boolean,
    tasks: List<Task>,
    today: String,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    onOpenDay: (String) -> Unit,
    onHoldDay: (CalendarDay) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    val density = LocalDensity.current
    val flingPx = with(density) { FLING_VELOCITY.toPx() }
    val gutter = gutterWidth()
    // The days drawn: those in view and the one coming in from the right while the strip moves.
    val first by remember(state) { derivedStateOf { floor(state.offset).toInt() } }
    val shown = remember(tasks, today, first) { CalendarDays.days(tasks, state.date(first), WEEK_DAYS + 1, today) }
    BoxWithConstraints(
        modifier.draggable(state, Orientation.Horizontal, onDragStopped = { velocity -> state.settle(velocity, flingPx) }),
    ) {
        val dayWidth = (maxWidth - gutter) / WEEK_DAYS
        state.dayPx = with(density) { dayWidth.toPx() }
        val start = with(density) {
            (HOUR_HEIGHT * firstHour(shown.firstOrNull { it.isToday }, nowMinute) - HOUR_LABEL_ROOM).roundToPx().coerceAtLeast(0)
        }
        val scroll = rememberScrollState(start)
        // A task dragged above the hours (over the headers or the band) loses its time.
        val hours = rememberHoursDrop(
            WEEK_SURFACE,
            scroll,
            band = 0.dp,
            dateAt = { x -> state.date(DropMath.column(x, state.dayPx, state.offset, WEEK_DAYS)).toString() },
            step = { by -> state.animateTo(state.firstDay + by * WEEK_DAYS) },
        )
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.width(gutter))
                val narrow = !shortWeekdaysFit(dayWidth)
                DayStrip(state, first, shown, dayWidth, Modifier.weight(1f)) { DayHeader(it, onOpenDay, Modifier.fillMaxWidth().untimedDrop(it.date), narrow) }
            }
            if (shown.any { it.untimed.isNotEmpty() }) {
                Row(Modifier.fillMaxWidth().background(p.surface)) {
                    UntimedLabel(Modifier.width(gutter))
                    DayStrip(state, first, shown, dayWidth, Modifier.weight(1f)) {
                        if (bars) {
                            UntimedBars(it, onOpenDay, onHoldDay, Modifier.untimedDrop(it.date))
                        } else {
                            UntimedDay(it, onOpen, onMove, onOpenDay, Modifier.untimedDrop(it.date))
                        }
                    }
                }
            }
            Column(Modifier.weight(1f).onPlaced { hours.viewport = it }.verticalScroll(scroll)) {
                Row(Modifier.fillMaxWidth().height(HOUR_HEIGHT * HOURS)) {
                    HourLabels(Modifier.width(gutter).fillMaxHeight(), shown.map { it.date })
                    DayStrip(state, first, shown, dayWidth, Modifier.weight(1f).fillMaxHeight().onPlaced { hours.hours = it }, Modifier.fillMaxHeight()) { day ->
                        val touch = if (bars) DayTouch({ onOpenDay(day.date) }, if (day.hasTasks) ({ onHoldDay(day) }) else null) else null
                        DayColumn(day, nowMinute, onOpen, onMove, showTime = false, Modifier.fillMaxSize(), touch)
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** The week's hours in the drag. */
internal const val WEEK_SURFACE = "week"

/** One row of the week (headers, band or hours): each day at its place for the strip's offset, cut at the edges. */
@Composable
private fun DayStrip(
    state: WeekStripState,
    first: Int,
    shown: List<CalendarDay>,
    dayWidth: Dp,
    modifier: Modifier,
    columnModifier: Modifier = Modifier,
    content: @Composable (CalendarDay) -> Unit,
) {
    Box(modifier.clipToBounds()) {
        shown.forEachIndexed { i, day ->
            key(day.date) {
                // Read in the layout phase only, so moving the strip lays it out again without recomposing it.
                Box(Modifier.width(dayWidth).then(columnModifier).offset { IntOffset(((first + i - state.offset) * state.dayPx).roundToInt(), 0) }) {
                    content(day)
                }
            }
        }
    }
}
