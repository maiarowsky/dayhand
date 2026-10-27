package dev.helm.planner.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * The labels in use, from the Projects menu: tap one for its tasks, hold it to make a project of it. They are kept
 * apart from the project list so that an account with labels and no projects does not look as if it had projects.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabelsSheet(labels: List<String>, openCount: (String) -> Int, onDismiss: () -> Unit, onLabel: (String) -> Unit, onConvert: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.background, contentColor = palette.text, shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = palette.border) }, modifier = Modifier.testTag("labels-sheet")) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap)) {
            Text(stringResource(R.string.detail_labels), style = helmType.screenTitle)
            ListNote(stringResource(R.string.labels_note))
            ListGroup(null, labels.map { label -> @Composable {
                ListRow("# $label", "project-label-$label", value = openCount(label).toString(), onClick = { onLabel(label) },
                    onLongClick = { onConvert(label) }, longClickLabel = stringResource(R.string.project_from_label))
            } })
        }
    }
}
