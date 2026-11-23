package dev.helm.planner.ui.today

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.TaskSearch
import dev.helm.planner.ui.common.dueLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate

object SearchTags {
    const val OPEN = "search-open"
    const val SHEET = "search-sheet"
    const val FIELD = "search-field"
    const val NONE = "search-none"
    fun result(localId: String) = "search-$localId"
}

/**
 * Search over every task in the plan, from the magnifier on Today: a field with the keyboard up and the tasks whose
 * title or notes contain the words ([TaskSearch]), each with its day or "Done". A tap opens the task.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(tasks: List<Task>, today: LocalDate, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    val p = palette
    var query by rememberSaveable { mutableStateOf("") }
    val found = remember(tasks, query) { TaskSearch.find(tasks, query) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus() }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = p.surface,
        contentColor = p.text,
        shape = HelmShapes.sheet,
        dragHandle = { BottomSheetDefaults.DragHandle(color = p.border) },
        modifier = Modifier.testTag(SearchTags.SHEET),
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).imePadding()) {
            HelmTextField(
                value = query,
                onValueChange = { query = it },
                label = stringResource(R.string.search_field),
                placeholder = stringResource(R.string.search_hint),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                modifier = Modifier
                    .padding(horizontal = HelmDimens.screenMargin)
                    .focusRequester(focus)
                    .testTag(SearchTags.FIELD),
            )
            if (query.isNotBlank() && found.isEmpty()) {
                Text(
                    stringResource(R.string.search_none),
                    style = helmType.body,
                    color = p.textMuted,
                    modifier = Modifier
                        .padding(horizontal = HelmDimens.screenMargin, vertical = 16.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite }
                        .testTag(SearchTags.NONE),
                )
            }
            LazyColumn(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                items(found, key = { it.localId }) { task ->
                    val day = if (task.status == TaskStatus.DONE) statusLabel(TaskStatus.DONE) else dueLabel(task, today)
                    ListRow(
                        task.title,
                        SearchTags.result(task.localId),
                        value = day ?: stringResource(R.string.search_no_day),
                        valueBelowTitle = true,
                        clickLabel = stringResource(R.string.open_details),
                        onClick = { onOpen(task.localId) },
                    )
                }
            }
        }
    }
}
