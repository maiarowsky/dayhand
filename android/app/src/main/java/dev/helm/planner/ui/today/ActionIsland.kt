package dev.helm.planner.ui.today

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

object IslandTags {
    const val TODAY = "island-today"
    const val TOMORROW = "island-tomorrow"
    const val OTHER_DAY = "island-other-day"
    const val ARCHIVE = "island-archive"
    const val SCRIM = "island-scrim"
}

private class IslandOption(val label: String, val icon: LineIcon, val tag: String, val primary: Boolean, val onClick: () -> Unit)

/**
 * The one round button in the corner of a task list. With nothing picked it adds a task ([onAdd]; hidden when null).
 * Once tasks are picked it opens their actions in an arc around itself (in a column when the text is large or the
 * screen narrow): to today, to tomorrow, to another day, archive. It sits above [tasks]' list and the bottom bar,
 * [bottomBarHeight] pixels high, and lets touches through wherever it draws nothing.
 */
@Composable
fun TaskActionIsland(
    selection: TaskSelection,
    tasks: List<Task>,
    today: LocalDate,
    actions: TodayActions,
    onAdd: (() -> Unit)?,
    bottomBarHeight: () -> Int,
    fabTag: String,
) {
    var picking by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(tasks) { selection.keepOnly(tasks.mapTo(HashSet()) { it.localId }) }

    fun picked() = tasks.filter { selection.isSelected(it.localId) }
    fun moveAll(day: LocalDate) {
        val date = day.toString()
        picked().filter { it.dueDate != date }.forEach { actions.moveTo(it.localId, date) }
        selection.clear()
    }

    val options = listOf(
        IslandOption(stringResource(R.string.move_to_today), LineIcon.Sun, IslandTags.TODAY, primary = true) { moveAll(today) },
        IslandOption(stringResource(R.string.move_to_tomorrow), LineIcon.Arrow, IslandTags.TOMORROW, primary = false) { moveAll(today.plusDays(1)) },
        IslandOption(stringResource(R.string.move_to_day), LineIcon.Calendar, IslandTags.OTHER_DAY, primary = false) {
            selection.showActions(false)
            picking = true
        },
        IslandOption(stringResource(R.string.archive), LineIcon.Archive, IslandTags.ARCHIVE, primary = false) {
            picked().forEach { actions.archive(it.localId) }
            selection.clear()
        },
    )

    val open = selection.actionsOpen
    Scrim(open) { selection.showActions(false) }
    if (selection.active || onAdd != null) {
        IslandLayout(open, options, bottomBarHeight) {
            IslandFab(selection, open, onAdd, Modifier.testTag(fabTag))
        }
    }
    if (picking) {
        DayPickerDialog(
            initial = picked().firstNotNullOfOrNull { it.dueDate }?.let(LocalDate::parse) ?: today,
            onDismiss = { picking = false },
            onPick = {
                picking = false
                moveAll(it)
            },
        )
    }
}

@Composable
private fun Scrim(visible: Boolean, onDismiss: () -> Unit) {
    AnimatedVisibility(visible, enter = fadeIn(tween(OPEN_FADE_MS)), exit = fadeOut(tween(CLOSE_MS))) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = SCRIM_ALPHA))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClickLabel = stringResource(R.string.selection_actions_close),
                    onClick = onDismiss,
                )
                .testTag(IslandTags.SCRIM),
        )
    }
}

@Composable
private fun IslandFab(selection: TaskSelection, open: Boolean, onAdd: (() -> Unit)?, modifier: Modifier) {
    val p = palette
    val description = when {
        open -> stringResource(R.string.selection_actions_close)
        selection.active -> stringResource(R.string.selection_actions)
        else -> stringResource(R.string.add_task)
    }
    FloatingActionButton(
        onClick = { if (selection.active) selection.showActions(!open) else onAdd?.invoke() },
        containerColor = p.accent,
        contentColor = p.onAccent,
        shape = HelmShapes.pill,
        modifier = modifier,
    ) {
        when {
            open -> Icon(Icons.Filled.Close, contentDescription = description)
            selection.active -> Box(Modifier.semantics { contentDescription = description }) {
                LineIconView(LineIcon.More, p.onAccent, size = 24.dp)
            }
            else -> Icon(Icons.Filled.Add, contentDescription = description)
        }
    }
}

/**
 * Lays the button out where Scaffold puts a floating button (16 dp from the end, above the bottom bar) and each
 * option on its way from the button to its place in the arc. The positions are read while placing, so the opening
 * animation moves the options without composing them again.
 */
@Composable
private fun IslandLayout(open: Boolean, options: List<IslandOption>, bottomBarHeight: () -> Int, fab: @Composable () -> Unit) {
    val reducedMotion = rememberReducedMotion()
    val progress = remember(options.size) { List(options.size) { Animatable(0f) } }
    var mounted by remember { mutableStateOf(open) }
    LaunchedEffect(open) {
        if (open) mounted = true
        progress.mapIndexed { index, value ->
            launch {
                if (open) {
                    delay(if (reducedMotion) 0L else index * STAGGER_MS)
                    value.animateTo(1f, if (reducedMotion) tween(OPEN_FADE_MS) else spring(OPEN_DAMPING, Spring.StiffnessMediumLow))
                } else {
                    value.animateTo(0f, tween(CLOSE_MS, easing = FastOutLinearInEasing))
                }
            }
        }.forEach { it.join() }
        if (!open) mounted = false
    }
    val density = LocalDensity.current
    val windowWidth = with(density) { LocalWindowInfo.current.containerSize.width.toDp() }
    val arc = density.fontScale < COLUMN_FONT_SCALE && windowWidth >= MIN_ARC_WIDTH
    val navigationBar = WindowInsets.navigationBars
    val safeDrawing = WindowInsets.safeDrawing
    Layout(
        content = {
            if (mounted) {
                options.forEachIndexed { index, option ->
                    OptionButton(option, arc, enabled = open, progress = { progress[index].value }, reducedMotion = reducedMotion)
                }
            }
            fab()
        },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val placeables = measurables.map { it.measure(loose) }
        val width = constraints.maxWidth
        val height = constraints.maxHeight
        layout(width, height) {
            val fab = placeables.last()
            val margin = FAB_MARGIN.roundToPx()
            val bottom = max(bottomBarHeight(), navigationBar.getBottom(density)) + margin
            val ltr = layoutDirection == LayoutDirection.Ltr
            val startInset = if (ltr) safeDrawing.getLeft(density, layoutDirection) else safeDrawing.getRight(density, layoutDirection)
            val endInset = if (ltr) safeDrawing.getRight(density, layoutDirection) else safeDrawing.getLeft(density, layoutDirection)
            val fabX = width - endInset - margin - fab.width
            val fabY = height - bottom - fab.height
            val centerX = fabX + fab.width / 2f
            val centerY = fabY + fab.height / 2f
            val circleHalf = OPTION_SIZE.toPx() / 2f
            val radius = ARC_RADIUS.toPx()
            val gap = COLUMN_GAP.toPx()
            var columnTop = fabY.toFloat()
            placeables.dropLast(1).forEachIndexed { index, option ->
                val p = if (reducedMotion) 1f else progress[index].value
                // In the arc the circle is the option's top; in the column a row of label and circle, centred.
                val circleCenter = if (arc) circleHalf else option.height / 2f
                val (targetX, targetY) = if (arc) {
                    val angle = Math.toRadians(ARC_START_DEG + index * ARC_SWEEP_DEG / (options.size - 1).coerceAtLeast(1))
                    (centerX + radius * cos(angle).toFloat()) to (centerY - radius * sin(angle).toFloat())
                } else {
                    columnTop -= gap + option.height
                    centerX to columnTop + circleCenter
                }
                val x = centerX + (targetX - centerX) * p
                val y = centerY + (targetY - centerY) * p
                val left = if (arc) x - option.width / 2f else x + circleHalf - option.width
                val clampedLeft = left.roundToInt()
                    .coerceAtMost(width - endInset - margin - option.width)
                    .coerceAtLeast(startInset + margin)
                option.placeRelative(clampedLeft, (y - circleCenter).roundToInt())
            }
            fab.placeRelative(fabX, fabY)
        }
    }
}

@Composable
private fun OptionButton(option: IslandOption, arc: Boolean, enabled: Boolean, progress: () -> Float, reducedMotion: Boolean) {
    val p = palette
    val label: @Composable () -> Unit = {
        Text(
            option.label,
            style = helmType.small,
            color = p.text,
            textAlign = if (arc) TextAlign.Center else TextAlign.End,
            maxLines = 2,
            modifier = Modifier
                .widthIn(max = if (arc) ARC_LABEL_MAX else COLUMN_LABEL_MAX)
                .clip(HelmShapes.pill)
                .background(p.surface)
                .padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
    val circle: @Composable () -> Unit = {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(OPTION_SIZE)
                .clip(CircleShape)
                .background(if (option.primary) p.accent else p.surfaceRaised),
        ) {
            LineIconView(option.icon, if (option.primary) p.onAccent else p.text)
        }
    }
    val modifier = Modifier
        .graphicsLayer {
            val value = progress().coerceIn(0f, 1f)
            alpha = value
            val scale = if (reducedMotion) 1f else OPTION_START_SCALE + (1f - OPTION_START_SCALE) * value
            scaleX = scale
            scaleY = scale
        }
        .clip(HelmShapes.card)
        .clickable(enabled = enabled, role = Role.Button, onClick = option.onClick)
        .testTag(option.tag)
    if (arc) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            circle()
            label()
        }
    } else {
        Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            label()
            circle()
        }
    }
}

private val FAB_MARGIN = 16.dp
private val OPTION_SIZE = 48.dp
private val ARC_LABEL_MAX = 120.dp
private val COLUMN_LABEL_MAX = 240.dp
private val ARC_RADIUS = 184.dp
private val COLUMN_GAP = 12.dp
private const val ARC_START_DEG = 90.0
/** Not a full quarter: the last option's label stays clear of the bottom bar. */
private const val ARC_SWEEP_DEG = 80.0
private const val OPTION_START_SCALE = 0.7f
private const val OPEN_DAMPING = 0.72f
private const val STAGGER_MS = 30L
private const val OPEN_FADE_MS = 150
private const val CLOSE_MS = 120
private const val SCRIM_ALPHA = 0.5f
/** From this font scale up, or in a window narrower than [MIN_ARC_WIDTH], the options stand in a column instead of an arc. */
private const val COLUMN_FONT_SCALE = 1.3f
private val MIN_ARC_WIDTH = 340.dp
