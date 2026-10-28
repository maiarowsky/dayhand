package dev.helm.planner.ui.today

import android.provider.Settings
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import dev.helm.planner.data.local.Task
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Tasks just ticked off, kept on screen for a moment so it is clear which one was ticked: the box fills, the title is
 * struck through, then the row fades and goes. The task is done the moment it is tapped ([TodayActions.complete] is
 * called at once); this only shows it. With the system's animations off nothing moves: the row stays ticked and
 * struck through for [CONFIRM_MS], then goes.
 */
@Stable
class LeavingTasks(private val scope: CoroutineScope, val reducedMotion: Boolean) {
    private class Leaving(val task: Task, val section: String, val index: Int)

    private val entries = mutableStateMapOf<String, Leaving>()

    fun isLeaving(localId: String): Boolean = localId in entries

    /** Keeps [task], at [index] of [section], on screen until its moment is over. */
    fun start(task: Task, section: String, index: Int) {
        if (task.localId in entries) return
        entries[task.localId] = Leaving(task, section, index)
        scope.launch {
            delay(if (reducedMotion) CONFIRM_MS else LEAVE_MS)
            entries.remove(task.localId)
        }
    }

    /** [tasks] of [section] with the tasks just ticked off there back in the places they were tapped in. */
    fun withLeaving(section: String, tasks: List<Task>): List<Task> {
        val gone = entries.values
            .filter { it.section == section && tasks.none { task -> task.localId == it.task.localId } }
            .sortedBy { it.index }
        if (gone.isEmpty()) return tasks
        return gone.fold(tasks) { list, leaving -> list.toMutableList().apply { add(leaving.index.coerceAtMost(size), leaving.task) } }
    }

    /** The task just ticked off in a section of one task (the "now" card), if any. */
    fun leaving(section: String): Task? = entries.values.firstOrNull { it.section == section }?.task

    companion object {
        /** The box fills and the title is struck through. */
        const val STRIKE_MS = 180

        /** Then the row fades; it goes when both are over and the rows under it move up. */
        const val FADE_MS = 180
        const val LEAVE_MS = (STRIKE_MS + FADE_MS).toLong()

        /** With animations off: how long the ticked row stays, still, before it goes. */
        const val CONFIRM_MS = 600L
    }
}

/** The tasks being ticked off on this screen; null where rows vanish at once (nothing provided). */
val LocalLeavingTasks = staticCompositionLocalOf<LeavingTasks?> { null }

/** A [LeavingTasks] for one list, aware of the system's animation setting. */
@Composable
fun rememberLeavingTasks(): LeavingTasks {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    return remember {
        val scale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        LeavingTasks(scope, reducedMotion = scale == 0f)
    }
}

/** These actions, except that ticking off a task of [tasks] (in [section]) first keeps its row for a moment. */
fun TodayActions.keepingTicked(leaving: LeavingTasks?, section: String, tasks: List<Task>): TodayActions {
    if (leaving == null) return this
    val actions = this
    return object : TodayActions by actions {
        override fun complete(localId: String) {
            val index = tasks.indexOfFirst { it.localId == localId }
            tasks.getOrNull(index)?.let { leaving.start(it, section, index) }
            actions.complete(localId)
        }
    }
}

/** How far the title of a row being ticked off is struck through (0 to 1), and how visible the row still is. */
class LeaveProgress(val strike: Float, val alpha: Float)

@Composable
fun leaveProgress(leaving: Boolean, reducedMotion: Boolean): LeaveProgress {
    if (reducedMotion) return LeaveProgress(if (leaving) 1f else 0f, 1f)
    val strike by animateFloatAsState(if (leaving) 1f else 0f, tween(LeavingTasks.STRIKE_MS), label = "strike")
    val alpha by animateFloatAsState(
        if (leaving) 0f else 1f,
        tween(LeavingTasks.FADE_MS, delayMillis = if (leaving) LeavingTasks.STRIKE_MS else 0),
        label = "fade",
    )
    return LeaveProgress(strike, alpha)
}

/** Fades a row being ticked off. */
fun Modifier.leaving(progress: LeaveProgress): Modifier = if (progress.alpha < 1f) alpha(progress.alpha) else this

/**
 * Strikes through the text laid out as [layout], line after line, as far as [progress] (0 to 1), in [color]. A full
 * strike looks like [androidx.compose.ui.text.style.TextDecoration.LineThrough].
 */
fun Modifier.strikeThrough(progress: Float, layout: () -> TextLayoutResult?, color: Color): Modifier = drawWithContent {
    drawContent()
    val text = layout() ?: return@drawWithContent
    if (progress <= 0f) return@drawWithContent
    val widths = (0 until text.lineCount).map { text.getLineRight(it) - text.getLineLeft(it) }
    var left = widths.sum() * progress
    for (line in 0 until text.lineCount) {
        if (left <= 0f) break
        val drawn = minOf(left, widths[line])
        val y = (text.getLineTop(line) + text.getLineBottom(line)) / 2
        val start = text.getLineLeft(line)
        drawLine(color, Offset(start, y), Offset(start + drawn, y), strokeWidth = 1.5.dp.toPx())
        left -= drawn
    }
}
