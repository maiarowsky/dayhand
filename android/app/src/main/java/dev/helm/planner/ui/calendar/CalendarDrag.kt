package dev.helm.planner.ui.calendar

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.ui.theme.HelmShapes
import kotlin.math.roundToInt
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** How close to an edge of the calendar the finger turns the days (left, right) or scrolls the hours (top, bottom). */
internal val DRAG_EDGE = 32.dp

/**
 * The left and right edges in the week of bars: the last day's column is narrow, so a wider edge would turn the week
 * under a task dropped on Sunday.
 */
internal val NARROW_DRAG_EDGE = 12.dp

/** The narrowest the lifted task gets under the finger, so its time and a word of its title can be read. */
private val GHOST_MIN_WIDTH = 72.dp

/** The fastest the hours scroll under a dragged task, per frame. */
private val SCROLL_STEP = 14.dp

/** How long the finger stays at the left or right edge before the days move on, and between moves. */
private const val EDGE_DWELL_MS = 600L

/** How long the finger stays near the top or bottom of the hours before they scroll: passing by does not scroll. */
private const val SCROLL_DELAY_MS = 200L

/**
 * The hours of one view as a drag sees them: the week's columns or one day's page. [viewport] is the scrolling area
 * as on screen, [hours] the 24 hours inside it (x 0 at the left of the first day column, y 0 at midnight). Above the
 * hours and in the [band] at the top of the viewport is the place for a task without a time.
 */
class HoursDrop(
    private val scroll: ScrollState,
    private val hourPx: Float,
    private val band: Float,
    private val dateAt: (x: Float) -> String,
    private val step: suspend (by: Int) -> Unit,
) {
    var viewport: LayoutCoordinates? = null
    var hours: LayoutCoordinates? = null

    /** Where a block with its top at [top] lands with the finger at [pointer], both in [host]'s coordinates. */
    fun targetAt(host: LayoutCoordinates, pointer: Offset, top: Float): DropTarget? {
        val view = viewport?.takeIf { it.isAttached } ?: return null
        val grid = hours?.takeIf { it.isAttached } ?: return null
        val inHours = grid.localPositionOf(host, pointer)
        val date = dateAt(inHours.x)
        val untimed = view.localPositionOf(host, pointer).y < band || inHours.y < 0f
        return if (untimed) DropTarget(date, null) else DropTarget(date, DropMath.timeOf(DropMath.snap(grid.localPositionOf(host, Offset(pointer.x, top)).y, hourPx)))
    }

    /** The visible hours, top to bottom, in [host]'s coordinates. */
    fun span(host: LayoutCoordinates): ClosedFloatingPointRange<Float>? {
        val view = viewport?.takeIf { it.isAttached } ?: return null
        return host.localPositionOf(view, Offset(0f, band)).y..host.localPositionOf(view, Offset(0f, view.size.height.toFloat())).y
    }

    fun scrollBy(px: Float) {
        scroll.dispatchRawDelta(px)
    }

    suspend fun stepBy(by: Int) = step(by)
}

/**
 * A task lifted by a long press and dragged over the calendar. The finger is followed by [CalendarDragHost], not by
 * the block, so the drag goes on when the days move under it and the block's own column leaves the screen.
 * Positions are in the host's coordinates.
 */
@Stable
class CalendarDragState {
    var entry by mutableStateOf<CalendarEntry?>(null)
        private set
    var pointer by mutableStateOf(Offset.Zero)
        private set

    /** Where the task would land; null until the finger moves. */
    var target by mutableStateOf<DropTarget?>(null)
        private set

    /** Whether the finger moved after the lift; let go without moving, the task's sheet opens instead. */
    var moved by mutableStateOf(false)
        private set

    /** Where the finger holds the block, from its top left corner, and the block's size. */
    var grab = Offset.Zero
        private set
    var size = IntSize.Zero
        private set

    internal var host: LayoutCoordinates? = null
    internal var slop = 0f

    /** The deepest the finger counts into a block for its time: a lifted band row is taller than half an hour. */
    internal var maxGrab = Float.MAX_VALUE

    /** The views' hours by key (the week, or a day's page); [surfaceKey] picks the one on screen. */
    internal val surfaces = mutableMapOf<Any, HoursDrop>()
    internal var surfaceKey: () -> Any? = { null }
    val surface: HoursDrop? get() = surfaceKey()?.let(surfaces::get)

    /** The finger on the calendar before a lift; null when none is down. */
    private var down: Offset? = null
    private var start = Offset.Zero

    /** Lifts [entry] from its [block] under the finger; false when no finger holds it (a screen reader's long press). */
    fun lift(entry: CalendarEntry, block: LayoutCoordinates?): Boolean {
        val at = down ?: return false
        val host = host?.takeIf { it.isAttached } ?: return false
        if (block == null || !block.isAttached) return false
        grab = at - host.localPositionOf(block, Offset.Zero)
        size = block.size
        start = at
        pointer = at
        moved = false
        target = null
        this.entry = entry
        return true
    }

    internal fun press(at: Offset) {
        down = at
        if (entry == null) return
        pointer = at
        if (!moved && (at - start).getDistance() > slop) moved = true
        if (moved) retarget()
    }

    internal fun retarget() {
        val host = host ?: return
        target = surface?.targetAt(host, pointer, pointer.y - grab.y.coerceAtMost(maxGrab))
    }

    /** Ends the drag when the finger lets go: the lifted entry, and whether it moved. */
    internal fun release(): Pair<CalendarEntry, Boolean>? {
        down = null
        val lifted = entry ?: return null
        val result = lifted to moved
        cancel()
        return result
    }

    internal fun cancel() {
        down = null
        entry = null
        target = null
        moved = false
    }

    /**
     * While a task is lifted: holding the finger within [sideEdge] of the left or right edge moves the days on (after
     * [EDGE_DWELL_MS]; for a task lifted at an edge, once the finger has been away from it), within [edge] of the top or
     * bottom of the hours they scroll every frame (after [SCROLL_DELAY_MS]). Elsewhere this waits for the finger instead
     * of running frames.
     */
    internal suspend fun follow(edge: Float, sideEdge: Float, maxStep: Float) = coroutineScope {
        var side = 0
        var since = 0L
        var armed = host?.let { DropMath.edge(start.x, it.size.width.toFloat(), sideEdge) == 0 } ?: false
        var scrollSince = -1L
        var stepping: Job? = null
        while (entry != null) {
            val host = host?.takeIf { it.isAttached }
            val hours = surface
            val at = if (host == null || !moved) 0 else DropMath.edge(pointer.x, host.size.width.toFloat(), sideEdge)
            if (moved && at == 0) armed = true
            val span = if (host == null) null else hours?.span(host)
            val dy = if (span == null || !moved) 0f else DropMath.scrollStep(pointer.y, span.start, span.endInclusive, edge, maxStep)
            if (hours == null || (at == 0 || !armed) && dy == 0f) {
                // Nothing moves on its own: wait for the finger rather than running frames.
                side = 0
                scrollSince = -1L
                val (p, m) = pointer to moved
                snapshotFlow { pointer != p || moved != m || entry == null }.first { it }
                continue
            }
            val now = withFrameMillis { it }
            if (at != side) {
                side = at
                since = now
            } else if (at != 0 && armed && now - since >= EDGE_DWELL_MS && stepping?.isActive != true) {
                since = now
                stepping = launch { hours.stepBy(at) }
            }
            when {
                dy == 0f -> scrollSince = -1L
                scrollSince < 0 -> scrollSince = now
                now - scrollSince >= SCROLL_DELAY_MS -> hours.scrollBy(dy)
            }
            retarget()
        }
    }
}

/** The drag in progress, for the blocks (to lift themselves) and the views (their hours, the guide line). */
val LocalCalendarDrag = staticCompositionLocalOf<CalendarDragState?> { null }

/**
 * The calendar's views under one finger: after a long press lifts a block, this follows the finger (before the
 * scrolling and swiping inside see it), draws the lifted block under it and, on letting go, calls [onDrop] with where
 * it landed, or [onHold] when the finger did not move (the move sheet, as before dragging existed). Held within
 * [sideEdge] of the left or right edge, the days move on.
 */
@Composable
fun CalendarDragHost(
    drag: CalendarDragState,
    onDrop: (CalendarEntry, DropTarget) -> Unit,
    onHold: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
    sideEdge: Dp = DRAG_EDGE,
    content: @Composable BoxScope.() -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val currentDrop by rememberUpdatedState(onDrop)
    val currentHold by rememberUpdatedState(onHold)
    drag.maxGrab = with(density) { (HOUR_HEIGHT / 2).toPx() }
    val lifted = drag.entry != null
    LaunchedEffect(drag, lifted) {
        if (lifted) drag.follow(with(density) { DRAG_EDGE.toPx() }, with(density) { sideEdge.toPx() }, with(density) { SCROLL_STEP.toPx() })
    }
    Box(
        modifier
            .onPlaced { drag.host = it }
            .pointerInput(drag) {
                drag.slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val first = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    drag.press(first.position)
                    var ended = false
                    try {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val change = event.changes.firstOrNull { it.id == first.id } ?: break
                            // A lifted task owns the finger: the hours do not scroll and the days do not swipe.
                            if (drag.entry != null) event.changes.forEach { it.consume() }
                            if (!change.pressed) break
                            drag.press(change.position)
                        }
                        ended = true
                        // The days may have moved on under a still finger.
                        if (drag.moved) drag.retarget()
                        val target = drag.target
                        val (entry, moved) = drag.release() ?: return@awaitEachGesture
                        val move = DropMath.moveOf(entry, target)
                        when {
                            !moved -> currentHold(entry)
                            move != null -> {
                                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                                currentDrop(entry, move)
                            }
                            else -> haptics.performHapticFeedback(HapticFeedbackType.GestureEnd)
                        }
                    } finally {
                        if (!ended) drag.cancel()
                    }
                }
            },
    ) {
        CompositionLocalProvider(LocalCalendarDrag provides drag) { content() }
        DragGhost(drag)
    }
}

/**
 * The lifted block under the finger, raised, saying where it would land; a narrow bar is drawn wider (at least
 * [GHOST_MIN_WIDTH], centred on where it was) with its time and title.
 */
@Composable
private fun DragGhost(drag: CalendarDragState) {
    val entry = drag.entry ?: return
    val density = LocalDensity.current
    val untimed = stringResource(R.string.calendar_no_time_short)
    val target = drag.target
    val label = if (target == null) entry.time else target.time ?: untimed
    val width = maxOf(with(density) { drag.size.width.toDp() }, GHOST_MIN_WIDTH)
    val wider = with(density) { width.toPx() } - drag.size.width
    EntryFace(
        entry,
        label,
        maxLines = 2,
        Modifier
            .offset {
                val at = drag.pointer - drag.grab
                IntOffset((at.x - wider / 2).roundToInt(), at.y.roundToInt())
            }
            .size(width, with(density) { drag.size.height.toDp() })
            .shadow(8.dp, HelmShapes.badge)
            .clearAndSetSemantics {},
    )
}

/**
 * The hours of a view for the drag, registered under [key] while on screen: [band] is the place for "no time" over
 * the top of its viewport, [dateAt] the day at a position from the left of its first day column, [step] moves the days.
 */
@Composable
fun rememberHoursDrop(key: Any, scroll: ScrollState, band: Dp, dateAt: (x: Float) -> String, step: suspend (by: Int) -> Unit): HoursDrop {
    val drag = LocalCalendarDrag.current
    val density = LocalDensity.current
    val currentDateAt by rememberUpdatedState(dateAt)
    val currentStep by rememberUpdatedState(step)
    val hourPx = with(density) { HOUR_HEIGHT.toPx() }
    val bandPx = with(density) { band.toPx() }
    val hours = remember(scroll, hourPx, bandPx) { HoursDrop(scroll, hourPx, bandPx, { currentDateAt(it) }, { currentStep(it) }) }
    if (drag != null) {
        DisposableEffect(drag, key, hours) {
            drag.surfaces[key] = hours
            onDispose { if (drag.surfaces[key] === hours) drag.surfaces.remove(key) }
        }
    }
    return hours
}
