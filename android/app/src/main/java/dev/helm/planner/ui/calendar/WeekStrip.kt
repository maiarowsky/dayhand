package dev.helm.planner.ui.calendar

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.core.exponentialDecay
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
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

/** Narrowest a day column gets at the normal font size, so a title shows a word or two per line, not syllables. */
val MIN_DAY_WIDTH: Dp = 104.dp
private const val MIN_DAYS = 3
private const val WEEK = 7

/** A swipe faster than this turns the week even when it moved less than half of it (as the pager did). */
private val FLING_VELOCITY = 400.dp

/**
 * How many days sit side by side in [width] next to the hours' [gutter]: as many as are at least [MIN_DAY_WIDTH] wide
 * (wider with a larger font), at least three (a phone) and at most a week (a tablet, a phone on its side).
 */
fun visibleDays(width: Dp, gutter: Dp, fontScale: Float): Int =
    ((width - gutter) / (MIN_DAY_WIDTH * fontScale.coerceAtLeast(1f))).toInt().coerceIn(MIN_DAYS, WEEK)

/** A week of columns turns a week at a time, Monday to Sunday; fewer columns move a day at a time. */
fun stepOf(days: Int): Int = if (days >= WEEK) WEEK else 1

/**
 * Where the week view is: the column [offset] days after [anchor] (the epoch day of a Monday) comes first, with a
 * fraction while the days move. Swipes drag it; [settle], [animateTo] and [snapTo] put it back on a whole day.
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

    /** Where "Today" goes: today first, or with a week of columns the week that has today. */
    fun home(today: LocalDate, days: Int): Int = indexOf(if (stepOf(days) == WEEK) CalendarDays.weekStart(today) else today)

    /** A column index that starts a step: any day, or a Monday with a week of columns. */
    fun startOfStep(index: Int, days: Int): Int = Math.floorDiv(index, stepOf(days)) * stepOf(days)

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

    /**
     * After a swipe that started on [from] at [velocityPx]: single days glide on (a fling at most a screen of [days]
     * further) and stop on a whole day; a week of columns turns to the next or previous week, or back.
     */
    suspend fun settle(velocityPx: Float, from: Int, days: Int, flingPx: Float) {
        val velocity = -velocityPx / dayPx
        val target = if (stepOf(days) == 1) {
            exponentialDecay<Float>().calculateTargetValue(offset, velocity).roundToInt().coerceIn(from - days, from + days)
        } else {
            val weeks = offset / WEEK
            WEEK * when {
                velocityPx < -flingPx -> floor(weeks + 1).toInt()
                velocityPx > flingPx -> ceil(weeks - 1).toInt()
                else -> weeks.roundToInt()
            }
        }
        animateTo(target, velocity)
    }
}

/** The week view's position, kept across rotation; with a week of columns it starts on Monday. */
@Composable
fun rememberWeekStripState(today: LocalDate, days: Int): WeekStripState {
    val state = rememberSaveable(
        saver = listSaver<WeekStripState, Any>(
            save = { listOf(it.anchor, it.firstDay) },
            restore = { WeekStripState(it[0] as Long, (it[1] as Int).toFloat()) },
        ),
    ) {
        WeekStripState(CalendarDays.weekStart(today).toEpochDay(), 0f).apply { snapTo(home(today, days)) }
    }
    // More or fewer columns (rotation, a resized window) keep the same days in view.
    LaunchedEffect(days) { state.snapTo(state.startOfStep(state.firstDay, days)) }
    return state
}

/**
 * The week: [days] columns of hours side by side with the times on the left, the day headers and the tasks without a
 * time pinned above them. Swiping moves the columns; the headers, the band and the hours move together.
 */
@Composable
fun WeekView(
    state: WeekStripState,
    days: Int,
    tasks: List<Task>,
    today: String,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    onOpenDay: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    val density = LocalDensity.current
    val flingPx = with(density) { FLING_VELOCITY.toPx() }
    val gutter = gutterWidth()
    // The days drawn: those in view and the one coming in from the right while the strip moves.
    val first by remember(state) { derivedStateOf { floor(state.offset).toInt() } }
    val shown = remember(tasks, today, first, days) { CalendarDays.days(tasks, state.date(first), days + 1, today) }
    var dragFrom by remember { mutableIntStateOf(0) }
    BoxWithConstraints(
        modifier.draggable(
            state,
            Orientation.Horizontal,
            onDragStarted = { dragFrom = state.firstDay },
            onDragStopped = { velocity -> state.settle(velocity, dragFrom, days, flingPx) },
        ),
    ) {
        val dayWidth = (maxWidth - gutter) / days
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
            dateAt = { x -> state.date(DropMath.column(x, state.dayPx, state.offset, days)).toString() },
            step = { by -> state.animateTo(state.firstDay + by * stepOf(days)) },
        )
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.width(gutter))
                DayStrip(state, first, shown, dayWidth, Modifier.weight(1f)) { DayHeader(it, onOpenDay, Modifier.fillMaxWidth().untimedDrop(it.date)) }
            }
            if (shown.any { it.untimed.isNotEmpty() }) {
                Row(Modifier.fillMaxWidth().background(p.surface)) {
                    UntimedLabel(Modifier.width(gutter))
                    DayStrip(state, first, shown, dayWidth, Modifier.weight(1f)) { UntimedDay(it, onOpen, onMove, onOpenDay, Modifier.untimedDrop(it.date)) }
                }
            }
            Column(Modifier.weight(1f).onPlaced { hours.viewport = it }.verticalScroll(scroll)) {
                Row(Modifier.fillMaxWidth().height(HOUR_HEIGHT * HOURS)) {
                    HourLabels(Modifier.width(gutter).fillMaxHeight(), shown.map { it.date })
                    DayStrip(state, first, shown, dayWidth, Modifier.weight(1f).fillMaxHeight().onPlaced { hours.hours = it }, Modifier.fillMaxHeight()) {
                        DayColumn(it, nowMinute, onOpen, onMove, showTime = false, Modifier.fillMaxSize())
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
