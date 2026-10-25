package dev.helm.planner.ui.projects

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.theme.palette
import kotlin.math.abs

@Composable
internal fun ProjectReorder(project: Project, actions: ProjectActions) {
    val up = stringResource(R.string.checklist_move_up)
    val down = stringResource(R.string.checklist_move_down)
    val description = stringResource(R.string.project_reorder_handle, project.name)
    val row = with(LocalDensity.current) { 64.dp.toPx() }
    Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        LineIconView(LineIcon.List, palette.textMuted, Modifier.size(48.dp).semantics {
            contentDescription = description
            customActions = listOf(CustomAccessibilityAction(up) { actions.move(project, -1); true },
                CustomAccessibilityAction(down) { actions.move(project, 1); true })
        }.pointerInput(project.localId) {
            var distance = 0f
            detectDragGesturesAfterLongPress(onDragStart = { distance = 0f }, onDrag = { change, delta ->
                change.consume()
                distance += delta.y
                if (abs(distance) >= row) { actions.move(project, if (distance < 0) -1 else 1); distance = 0f }
            })
        })
        HeaderIconButton(Icons.Filled.KeyboardArrowUp, up, { actions.move(project, -1) })
        HeaderIconButton(Icons.Filled.KeyboardArrowDown, down, { actions.move(project, 1) })
    }
}
