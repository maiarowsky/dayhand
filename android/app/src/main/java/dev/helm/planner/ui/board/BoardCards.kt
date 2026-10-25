package dev.helm.planner.ui.board

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.common.BlockedMark
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmMenu
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectBadge
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.ResumeNoteDialog
import java.time.LocalDate

/** A task on the board: tap for details, long-press and drag to another column, or move it from the menu. */
@Composable
fun BoardCard(task: Task, today: LocalDate, actions: BoardActions, drag: BoardDragState, blocked: AgentWork.Blocked? = null) {
    Card(
        onClick = { actions.openTask(task.localId) },
        colors = CardDefaults.cardColors(containerColor = palette.surface, contentColor = palette.text),
        shape = HelmShapes.option,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .alpha(if (drag.task?.localId == task.localId) DRAGGED_ALPHA else 1f)
            .draggableCard(task, drag) { actions.move(task.localId, it) }
            .moveActions(task, actions)
            .testTag(BoardTags.card(task.localId)),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp)) {
            CardContent(task, today, Modifier.weight(1f), blocked = blocked)
            MoveMenu(task, actions)
        }
    }
}

/** The single "now" task, highlighted, with where the work stopped (tap to edit). */
@Composable
fun NowBoardCard(task: Task, today: LocalDate, actions: BoardActions, drag: BoardDragState, blocked: AgentWork.Blocked? = null) {
    var editing by rememberSaveable { mutableStateOf(false) }
    val p = palette
    Card(
        onClick = { actions.openTask(task.localId) },
        colors = CardDefaults.cardColors(containerColor = p.accentSoft, contentColor = p.text),
        shape = HelmShapes.card,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .alpha(if (drag.task?.localId == task.localId) DRAGGED_ALPHA else 1f)
            .draggableCard(task, drag) { actions.move(task.localId, it) }
            .moveActions(task, actions)
            .testTag(BoardTags.NOW),
    ) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp, end = 4.dp)) {
            Column(Modifier.weight(1f)) {
                SectionLabel(stringResource(R.string.section_now))
                CardContent(task, today, Modifier, emphasized = true, blocked = blocked)
                val resume = task.resumeNote
                Text(
                    text = resume ?: stringResource(R.string.resume_empty),
                    style = helmType.small,
                    color = if (resume == null) p.textMuted else p.text,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable(onClickLabel = stringResource(R.string.resume_edit)) { editing = true }
                        .padding(vertical = 12.dp),
                )
            }
            MoveMenu(task, actions)
        }
    }
    if (editing) {
        ResumeNoteDialog(
            initial = task.resumeNote.orEmpty(),
            onDismiss = { editing = false },
            onSave = {
                actions.saveResumeNote(task.localId, it)
                editing = false
            },
        )
    }
}

/** Title (with "⛔" before it when [blocked]), the due day (red when overdue) and the labels. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CardContent(task: Task, today: LocalDate, modifier: Modifier, emphasized: Boolean = false, blocked: AgentWork.Blocked? = null) {
    Column(modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            blocked?.let { BlockedMark(it, task.localId, Modifier.padding(end = 6.dp)) }
            Text(
                task.title,
                style = if (emphasized) helmType.title else helmType.body,
                textDecoration = if (task.status == TaskStatus.DONE) TextDecoration.LineThrough else null,
                color = if (task.status == TaskStatus.DONE) palette.textMuted else palette.text,
            )
        }
        dueLabel(task, today)?.let { due ->
            val overdue = HelmDates.isOverdue(task, today.toString())
            Text(
                if (overdue) stringResource(R.string.overdue_due, due) else due,
                style = helmType.small,
                color = if (overdue) palette.danger else palette.textMuted,
            )
        }
        ProjectBadge(task)
        if (task.labels.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                task.labels.forEach { LabelTag(it) }
            }
        }
    }
}

/** A task label: the secondary colour on its own 16 % tint, small badge corners. */
@Composable
fun LabelTag(label: String, color: Color = palette.secondary) {
    Text(
        label,
        style = helmType.smallStrong,
        color = color,
        modifier = Modifier
            .background(color.copy(alpha = 0.16f), HelmShapes.badge)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** Moves without dragging: one menu per card, every other column plus "now". */
@Composable
private fun MoveMenu(task: Task, actions: BoardActions) {
    val projects = LocalProjects.current
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderIconButton(Icons.Filled.MoreVert, stringResource(R.string.more_actions, task.title), { open = true }, tint = palette.textMuted)
        HelmMenu(expanded = open, onDismiss = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.project_move), style = helmType.body, color = palette.text) },
                onClick = { open = false; projects.pickTask(task) }, modifier = Modifier.heightIn(min = 48.dp))
            moves(task).forEach { move ->
                DropdownMenuItem(
                    text = { Text(move.label(), style = helmType.body, color = palette.text) },
                    onClick = {
                        open = false
                        move.run(task, actions)
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
        }
    }
}

/** The same moves for screen readers, as custom actions on the card. */
@Composable
private fun Modifier.moveActions(task: Task, actions: BoardActions): Modifier {
    val labelled = moves(task).map { it.label() to it }
    val projects = LocalProjects.current
    val projectMove = stringResource(R.string.project_move)
    return semantics {
        customActions = listOf(CustomAccessibilityAction(projectMove) { projects.pickTask(task); true }) + labelled.map { (label, move) ->
            CustomAccessibilityAction(label) {
                move.run(task, actions)
                true
            }
        }
    }
}

private sealed interface Move {
    @Composable
    fun label(): String
    fun run(task: Task, actions: BoardActions)

    data class ToColumn(val status: TaskStatus) : Move {
        @Composable
        override fun label() = stringResource(R.string.move_to_column, statusLabel(status))
        override fun run(task: Task, actions: BoardActions) = actions.move(task.localId, status)
    }

    data class Simple(@param:StringRes val text: Int, val action: (Task, BoardActions) -> Unit) : Move {
        @Composable
        override fun label() = stringResource(text)
        override fun run(task: Task, actions: BoardActions) = action(task, actions)
    }
}

private fun moves(task: Task): List<Move> = buildList {
    TaskStatus.entries.filter { it != task.status }.forEach { add(Move.ToColumn(it)) }
    if (task.isNow) {
        add(Move.Simple(R.string.stop_now) { _, a -> a.clearNow() })
    } else if (task.status != TaskStatus.DONE) {
        add(Move.Simple(R.string.set_now) { t, a -> a.setNow(t.localId) })
    }
}

private const val DRAGGED_ALPHA = 0.4f
