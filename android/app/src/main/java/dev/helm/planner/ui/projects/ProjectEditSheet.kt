package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.domain.ProjectRules
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProjectEditSheet(project: Project? = null, onDismiss: () -> Unit, onSaved: (Project) -> Unit = {}) {
    val context = LocalProjects.current
    var name by rememberSaveable { mutableStateOf(project?.name.orEmpty()) }
    var color by rememberSaveable { mutableStateOf(project?.color) }
    var icon by rememberSaveable { mutableStateOf(project?.icon.orEmpty()) }
    var note by rememberSaveable { mutableStateOf(project?.note.orEmpty()) }
    val valid = ProjectRules.validName(name, context.projects, project?.localId) && ProjectRules.validIcon(icon) && note.length <= ProjectRules.MAX_NOTE
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.surface, contentColor = palette.text, shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = palette.border) }) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(if (project == null) R.string.project_new else R.string.project_edit), style = helmType.screenTitle)
            HelmTextField(name, { name = it }, label = stringResource(R.string.project_name), singleLine = true,
                modifier = Modifier.testTag("project-name"))
            ListNote(stringResource(R.string.project_name_hint))
            if (context.failed) ListNote(stringResource(if (context.connectionRequired) R.string.project_connection_required else R.string.project_failed))
            PrimaryButton(stringResource(R.string.save), onClick = {
                val draft = ProjectDraft(name, color, icon, note)
                if (project == null) context.actions.create(draft) { onSaved(it); onDismiss() }
                else context.actions.edit(project, draft, onDismiss)
            }, enabled = valid, modifier = Modifier.testTag("project-save"))
            SectionLabel(stringResource(R.string.project_color))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HelmChip(stringResource(R.string.project_none_color), selected = color == null, onClick = { color = null })
                ProjectRules.colors.forEachIndexed { index, token ->
                    HelmChip(stringResource(colorNames[index]), selected = color == token, onClick = { color = token },
                        modifier = Modifier.testTag("project-color-$token"), leadingContent = {
                            ProjectMark(Project(localId = token, name = token, color = token, position = 0.0, createdAt = 0, updatedAt = 0))
                        })
                }
            }
            HelmTextField(icon, { icon = it }, label = stringResource(R.string.project_icon), singleLine = true)
            HelmTextField(note, { note = it }, label = stringResource(R.string.project_note), minLines = 2)
        }
    }
}

private val colorNames = listOf(R.string.project_color_red, R.string.project_color_orange, R.string.project_color_amber,
    R.string.project_color_green, R.string.project_color_teal, R.string.project_color_cyan, R.string.project_color_blue,
    R.string.project_color_indigo, R.string.project_color_purple, R.string.project_color_pink, R.string.project_color_brown, R.string.project_color_gray)
