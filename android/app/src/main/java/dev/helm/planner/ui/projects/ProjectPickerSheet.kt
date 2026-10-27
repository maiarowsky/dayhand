package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.ProjectRules
import dev.helm.planner.ui.components.ChoiceRow
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * One picker shared by quick add, task details and every task row/card menu. Archived projects cannot be assigned.
 * With no project yet it explains that and offers "New project" as a full button; the new project is picked at once.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectPickerSheet(selected: String?, onDismiss: () -> Unit, onPick: (String?) -> Unit,
                       exclude: String? = null, allowCreate: Boolean = true) {
    val context = LocalProjects.current
    val projects = context.projects.filter { it.assignable && it.localId != exclude }
    var search by rememberSaveable { mutableStateOf("") }
    var creating by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    val showSearch = projects.size > SEARCH_THRESHOLD
    androidx.compose.runtime.LaunchedEffect(showSearch) { if (!showSearch) search = "" }
    val query = search.takeIf { showSearch }.orEmpty()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.surface, contentColor = palette.text, shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = palette.border) }, modifier = Modifier.testTag("project-picker")) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.project_label), style = helmType.screenTitle)
            if (showSearch) HelmTextField(search, { search = it }, label = stringResource(R.string.project_search), singleLine = true,
                modifier = Modifier.testTag("project-search"))
            ChoiceRow(stringResource(R.string.project_no_project), selected == null, "project-pick-none", { onPick(null); onDismiss() })
            projects.filter { ProjectRules.nameKey(it.name).contains(ProjectRules.nameKey(query)) }.forEach { project ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ProjectMark(project)
                    Column(Modifier.weight(1f)) {
                        ChoiceRow(project.name, selected == project.localId, "project-pick-${project.localId}", { onPick(project.localId); onDismiss() })
                    }
                }
            }
            if (allowCreate) {
                // Without any project the sheet says why it offers only "No project", and creating one is the main action.
                val none = context.projects.none { it.selectable }
                if (none) Text(stringResource(R.string.project_picker_empty), style = helmType.valueSmall, color = palette.text,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp).testTag("project-picker-empty"))
                if (!creating) {
                    val tag = Modifier.testTag("project-picker-new")
                    if (none) PrimaryButton(stringResource(R.string.project_new), { creating = true }, tag, icon = Icons.Filled.Add)
                    else SecondaryButton(stringResource(R.string.project_new), { creating = true }, tag, color = palette.accent, icon = Icons.Filled.Add)
                } else {
                    HelmTextField(name, { name = it }, label = stringResource(R.string.project_name), singleLine = true, modifier = Modifier.testTag("project-picker-name"))
                    ListNote(stringResource(R.string.project_name_hint))
                    if (context.failed) ListNote(stringResource(if (context.connectionRequired) R.string.project_connection_required else R.string.project_failed))
                    PrimaryButton(stringResource(R.string.save), onClick = {
                        context.actions.create(ProjectDraft(name)) { onPick(it.localId); onDismiss() }
                    }, enabled = ProjectRules.validName(name, context.projects) && context.projects.size < ProjectRules.MAX_PROJECTS,
                        modifier = Modifier.testTag("project-picker-save"))
                }
            }
        }
    }
}

private const val SEARCH_THRESHOLD = 8
