package dev.helm.planner.ui.task

import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.components.helmCheckboxColors
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object ChecklistTags {
    const val SECTION = "detail-checklist"
    const val FOLD = "detail-checklist-section"
    const val ADD = "detail-checklist-add"
    fun check(index: Int) = "detail-checklist-check-$index"
    fun item(index: Int) = "detail-checklist-item-$index"
}

/**
 * The checklist: one row per item with its checkbox, in order. Tapping the box ticks the item; tapping its text opens
 * it to rename, move or remove. "2 of 5 done" sits in the section title; the section is folded while it is empty.
 */
@Composable
internal fun ChecklistSection(task: Task, editable: Boolean, actions: TaskDetailActions) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val items = task.checklist
    val title = if (items.isEmpty()) {
        stringResource(R.string.detail_checklist)
    } else {
        stringResource(R.string.checklist_title_progress, stringResource(R.string.detail_checklist), items.count { it.done }, items.size)
    }
    FoldingSection(
        title,
        tag = ChecklistTags.FOLD,
        initiallyExpanded = items.isNotEmpty(),
        summary = if (items.isEmpty()) stringResource(R.string.checklist_empty) else null,
    ) {
        Column(Modifier.testTag(ChecklistTags.SECTION)) {
            items.forEachIndexed { index, item ->
                ChecklistRow(index, item, editable, onToggle = { actions.toggleItem(task.localId, item.id) }, onOpen = { editing = item.id })
            }
            if (items.isEmpty()) Placeholder(stringResource(R.string.checklist_empty))
            if (editable && items.size < TaskRules.MAX_CHECKLIST) {
                DetailAction(
                    stringResource(R.string.checklist_add),
                    { adding = true },
                    Icons.Filled.Add,
                    Modifier
                        .padding(top = 8.dp)
                        .testTag(ChecklistTags.ADD),
                )
            }
        }
    }
    if (adding) {
        TextEditDialog(
            title = stringResource(R.string.checklist_add),
            initial = "",
            maxLength = TaskRules.MAX_TITLE,
            onDismiss = { adding = false },
            onSave = {
                actions.addItem(task.localId, it)
                adding = false
            },
        )
    }
    val open = items.indexOfFirst { it.id == editing }
    if (open >= 0) {
        ItemDialog(
            item = items[open],
            canMoveUp = open > 0,
            canMoveDown = open < items.lastIndex,
            onDismiss = { editing = null },
            onRename = { actions.renameItem(task.localId, items[open].id, it); editing = null },
            onMove = { by -> actions.moveItem(task.localId, items[open].id, by) },
            onRemove = { actions.removeItem(task.localId, items[open].id); editing = null },
        )
    }
}

@Composable
private fun ChecklistRow(index: Int, item: ChecklistItem, editable: Boolean, onToggle: () -> Unit, onOpen: () -> Unit) {
    val p = palette
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = HelmDimens.touchTarget)) {
        // The whole 48 dp square is the touch target, announced with the item's text, as on the Today rows.
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(HelmDimens.touchTarget)
                .toggleable(value = item.done, enabled = editable, role = Role.Checkbox, onValueChange = { onToggle() })
                .semantics { contentDescription = item.title }
                .testTag(ChecklistTags.check(index)),
        ) {
            Checkbox(checked = item.done, onCheckedChange = null, enabled = editable, colors = helmCheckboxColors())
        }
        Text(
            item.title,
            style = helmType.valueSmall,
            color = if (item.done) p.textMuted else p.text,
            textDecoration = if (item.done) TextDecoration.LineThrough else null,
            modifier = Modifier
                .weight(1f)
                .heightIn(min = HelmDimens.touchTarget)
                .clickable(enabled = editable, onClickLabel = stringResource(R.string.checklist_edit_item)) { onOpen() }
                .padding(vertical = 12.dp)
                .testTag(ChecklistTags.item(index)),
        )
    }
}

/** One item: its text, and moving or removing it. */
@Composable
private fun ItemDialog(
    item: ChecklistItem,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onDismiss: () -> Unit,
    onRename: (String) -> Unit,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    TextEditDialog(
        title = stringResource(R.string.checklist_item),
        initial = item.title,
        maxLength = TaskRules.MAX_TITLE,
        onDismiss = onDismiss,
        onSave = onRename,
        extra = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 8.dp)) {
                TextAction(stringResource(R.string.checklist_move_up), { onMove(-1) }, enabled = canMoveUp, modifier = Modifier.testTag(EditorTags.ITEM_UP))
                TextAction(stringResource(R.string.checklist_move_down), { onMove(1) }, enabled = canMoveDown, modifier = Modifier.testTag(EditorTags.ITEM_DOWN))
                TextAction(stringResource(R.string.checklist_remove), onRemove, color = palette.danger, modifier = Modifier.testTag(EditorTags.ITEM_REMOVE))
            }
        },
    )
}
