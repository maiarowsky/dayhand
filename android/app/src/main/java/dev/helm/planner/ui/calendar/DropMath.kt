package dev.helm.planner.ui.calendar

import dev.helm.planner.domain.CalendarEntry
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

/** Where a dragged task lands: a [date] and a [time] (HH:MM), or no time for the band of tasks without one. */
data class DropTarget(val date: String, val time: String?)

/**
 * The rules of dragging a task on the calendar, apart from Compose so they are tested on the JVM: a block's top snaps
 * to a quarter of an hour, the column is the day under the finger, and the edges of the view move it on.
 */
object DropMath {
    const val SNAP_MINUTES = 15
    private const val MINUTES_PER_DAY = 24 * 60

    /** The latest start a drop gives: the last quarter of the day. */
    const val LAST_START = MINUTES_PER_DAY - SNAP_MINUTES

    /** The minute of the day [y] pixels below midnight, to the nearest quarter of an hour, within the day. */
    fun snap(y: Float, hourPx: Float): Int =
        ((y / hourPx * 60 / SNAP_MINUTES).roundToInt() * SNAP_MINUTES).coerceIn(0, LAST_START)

    /** HH:MM of a minute of the day, in ASCII digits whatever the language: it is the task's `dueTime`. */
    fun timeOf(minute: Int): String = String.format(Locale.ROOT, "%02d:%02d", minute / 60, minute % 60)

    /**
     * The day column (an index of the strip) at [x] pixels from the strip's left edge, when column [offset] (with a
     * fraction while the strip moves) is at that edge; left of the strip or right of it, the nearest of the [days]
     * columns in view.
     */
    fun column(x: Float, dayPx: Float, offset: Float, days: Int): Int =
        floor(offset + x.coerceIn(0f, days * dayPx - 1f) / dayPx).toInt()

    /** -1 within [edge] of the start of [length], 1 within [edge] of its end, else 0. */
    fun edge(at: Float, length: Float, edge: Float): Int = when {
        at < edge -> -1
        at > length - edge -> 1
        else -> 0
    }

    /**
     * How far the hours scroll in one frame with the finger at [y], when they show from [top] to [bottom]: up within
     * [edge] below the top, down within [edge] above the bottom (and below it), faster nearer the edge, at most [max].
     * Above the top (the band without a time) they stay.
     */
    fun scrollStep(y: Float, top: Float, bottom: Float, edge: Float, max: Float): Float = when {
        y < top -> 0f
        y < top + edge -> -max * (top + edge - y) / edge
        y > bottom - edge -> max * ((y - bottom + edge) / edge).coerceAtMost(1f)
        else -> 0f
    }

    /** The move a drop on [target] makes, or null when it leaves the task where it was. */
    fun moveOf(entry: CalendarEntry, target: DropTarget?): DropTarget? =
        target?.takeIf { it.date != entry.date || it.time != entry.time }
}
