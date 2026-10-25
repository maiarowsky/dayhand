package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Long-press and header menu share the same edit/archive/delete confirmations. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectManagement(project: Project, onDismiss: () -> Unit, onDeleted: () -> Unit = {}) {
    val context = LocalProjects.current
    var mode by rememberSaveable { mutableStateOf("menu") }
    var archiveTasks by rememberSaveable { mutableStateOf(false) }
    var target by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    when (mode) {
        "menu" -> ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surface, contentColor = palette.text, shape = HelmShapes.sheet) {
            Column(Modifier.padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp)) {
                Text(project.name, style = helmType.title)
                TextAction(stringResource(R.string.project_edit), { mode = "edit" })
                TextAction(stringResource(if (project.archived) R.string.restore else R.string.archive), {
                    if (project.archived) { context.actions.archive(project, false); onDismiss() } else mode = "archive"
                })
                TextAction(stringResource(R.string.project_delete), { mode = "delete" }, color = palette.danger)
            }
        }
        "edit" -> ProjectEditSheet(project, onDismiss = onDismiss)
        "archive" -> HelmDialog(stringResource(R.string.project_archive_title), onDismiss, stringResource(R.string.archive), {
            context.actions.archive(project, true, archiveTasks)
            onDismiss()
        }, dismiss = stringResource(R.string.cancel)) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.project_archive_hint), style = helmType.body)
                SwitchRow(stringResource(R.string.project_archive_tasks), archiveTasks, { archiveTasks = it })
            }
        }
        "delete" -> if (!picking) HelmDialog(stringResource(R.string.project_delete_title), onDismiss, stringResource(R.string.project_delete), {
            context.actions.delete(project, target) { onDismiss(); onDeleted() }
        }, dismiss = stringResource(R.string.cancel), destructive = true) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.project_delete_hint), style = helmType.body)
                Text(stringResource(R.string.project_destination), style = helmType.smallStrong)
                TextAction(context.projects.firstOrNull { it.localId == target }?.name ?: stringResource(R.string.project_no_project), { picking = true })
                if (context.failed) ListNote(stringResource(R.string.project_failed))
            }
        }
    }
    if (picking) ProjectPickerSheet(target, onDismiss = { picking = false }, onPick = { target = it }, exclude = project.localId, allowCreate = false)
}
