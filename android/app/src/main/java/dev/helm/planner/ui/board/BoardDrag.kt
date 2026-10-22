package dev.helm.planner.ui.board

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntSize
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus

/**
 * Dragging a card to another column: long-press a card, move it over a column (or its tab on
 * a phone) and let go. Positions are in root coordinates. The same moves are available without
 * dragging from each card's menu and as accessibility actions.
 */
@Stable
class BoardDragState {
    var task by mutableStateOf<Task?>(null)
        private set
    var pointer by mutableStateOf(Offset.Zero)
        private set

    /** Where the finger holds the card, from the card's top left corner. */
    var grab = Offset.Zero
        private set
    var cardSize = IntSize.Zero
        private set

    private val targets = mutableMapOf<TaskStatus, Rect>()

    /** The column under the finger while a card is dragged. */
    val hovered: TaskStatus?
        get() = if (task == null) null else targets.entries.firstOrNull { it.value.contains(pointer) }?.key

    fun setTarget(status: TaskStatus, bounds: Rect) {
        targets[status] = bounds
    }

    fun start(task: Task, cardOrigin: Offset, at: Offset, size: IntSize) {
        this.task = task
        grab = at
        cardSize = size
        pointer = cardOrigin + at
    }

    fun moveBy(delta: Offset) {
        pointer += delta
    }

    /** Ends the drag; the column the card was dropped on, if any. */
    fun end(): TaskStatus? = hovered.also { task = null }

    fun cancel() {
        task = null
    }
}

/** Makes this area a column a card can be dropped on. */
fun Modifier.dropTarget(drag: BoardDragState, status: TaskStatus): Modifier =
    onGloballyPositioned { drag.setTarget(status, it.boundsInRoot()) }

/** Long-press and drag [task] to another column; [onDrop] gets the new column. */
@Composable
fun Modifier.draggableCard(task: Task, drag: BoardDragState, onDrop: (TaskStatus) -> Unit): Modifier {
    val haptics = LocalHapticFeedback.current
    val currentTask by rememberUpdatedState(task)
    val currentOnDrop by rememberUpdatedState(onDrop)
    val layout = remember { CardLayout() }
    return onGloballyPositioned {
        layout.origin = it.positionInRoot()
        layout.size = it.size
    }.pointerInput(task.localId) {
        detectDragGesturesAfterLongPress(
            onDragStart = { at ->
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                drag.start(currentTask, layout.origin, at, layout.size)
            },
            onDrag = { change, amount ->
                change.consume()
                drag.moveBy(amount)
            },
            onDragEnd = {
                val target = drag.end()
                if (target != null && target != currentTask.status) currentOnDrop(target)
            },
            onDragCancel = drag::cancel,
        )
    }
}

private class CardLayout {
    var origin = Offset.Zero
    var size = IntSize.Zero
}
