package dev.helm.planner.ui.today

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * The tasks picked on a list (a long press starts, taps add and remove) and whether the round button shows its
 * actions. Nothing picked is the list's normal state.
 */
@Stable
class TaskSelection internal constructor(ids: Set<String>, actionsOpen: Boolean) {
    var ids by mutableStateOf(ids)
        private set
    var actionsOpen by mutableStateOf(actionsOpen)
        private set

    val active: Boolean get() = ids.isNotEmpty()

    fun isSelected(localId: String): Boolean = localId in ids

    /** A long press: the first one picks the task and opens the actions, later ones add or remove a task. */
    fun longPress(localId: String) {
        if (active) toggle(localId) else {
            ids = setOf(localId)
            actionsOpen = true
        }
    }

    fun toggle(localId: String) {
        ids = if (localId in ids) ids - localId else ids + localId
        if (ids.isEmpty()) actionsOpen = false
    }

    fun selectAll(localIds: Collection<String>) {
        ids = ids + localIds
    }

    fun showActions(open: Boolean) {
        actionsOpen = open && active
    }

    /** Drops picked tasks that left the list (done, moved or synced away elsewhere). */
    fun keepOnly(present: Set<String>) {
        if (ids.all { it in present }) return
        ids = ids.filterTo(mutableSetOf()) { it in present }
        if (ids.isEmpty()) actionsOpen = false
    }

    fun clear() {
        ids = emptySet()
        actionsOpen = false
    }

    companion object {
        val Saver = Saver<TaskSelection, List<Any>>(
            save = { listOf(ArrayList(it.ids), it.actionsOpen) },
            restore = {
                @Suppress("UNCHECKED_CAST")
                TaskSelection((it[0] as List<String>).toSet(), it[1] as Boolean)
            },
        )
    }
}

/** A selection that survives rotation; Back closes the actions first, then ends the selection. */
@Composable
fun rememberTaskSelection(): TaskSelection {
    val selection = rememberSaveable(saver = TaskSelection.Saver) { TaskSelection(emptySet(), false) }
    BackHandler(enabled = selection.active) {
        if (selection.actionsOpen) selection.showActions(false) else selection.clear()
    }
    return selection
}

object SelectionTags {
    const val HEADER = "selection-header"
    const val CLEAR = "selection-clear"
    fun circle(localId: String) = "select-$localId"
}

/**
 * [header], or while [selecting] the [selectionHeader] in exactly its place and size, so the list under the finger
 * does not move when a long press starts picking.
 */
@Composable
fun HeaderOrSelection(selecting: Boolean, header: @Composable () -> Unit, selectionHeader: @Composable () -> Unit) {
    Layout(content = {
        header()
        if (selecting) selectionHeader()
    }) { measurables, constraints ->
        val normal = measurables[0].measure(constraints)
        val picking = measurables.getOrNull(1)?.measure(Constraints.fixed(normal.width, normal.height))
        layout(normal.width, normal.height) { (picking ?: normal).place(0, 0) }
    }
}

/** The header while tasks are picked: close, how many, and [onSelectAll] when given. */
@Composable
fun SelectionHeader(count: Int, onClear: () -> Unit, selectAllLabel: String? = null, onSelectAll: (() -> Unit)? = null) {
    val p = palette
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxSize()
            .background(p.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .padding(start = 4.dp, end = 8.dp)
            .testTag(SelectionTags.HEADER),
    ) {
        HeaderIconButton(Icons.Filled.Close, stringResource(R.string.selection_clear), onClear, Modifier.testTag(SelectionTags.CLEAR), tint = p.textMuted)
        Text(
            pluralStringResource(R.plurals.selected_count, count, count),
            style = helmType.title,
            color = p.text,
            maxLines = 1,
            modifier = Modifier
                .padding(start = 4.dp, end = 8.dp)
                .semantics { heading() },
        )
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            if (selectAllLabel != null && onSelectAll != null) TextAction(selectAllLabel, onSelectAll)
        }
    }
}

/** In place of a row's checkbox while picking: a circle, filled and ticked when the task is picked. */
@Composable
internal fun SelectCircle(localId: String, selected: Boolean, description: String, onToggle: () -> Unit) {
    val p = palette
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(HelmDimens.touchTarget)
            .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onToggle() })
            .semantics { contentDescription = description }
            .testTag(SelectionTags.circle(localId)),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .then(if (selected) Modifier.background(p.accent) else Modifier.border(2.dp, p.textMuted, CircleShape)),
        ) {
            if (selected) LineIconView(LineIcon.Check, p.onAccent, size = 16.dp)
        }
    }
}
