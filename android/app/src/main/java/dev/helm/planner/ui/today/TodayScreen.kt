package dev.helm.planner.ui.today

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.common.StatusBanner
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

object TodayTags {
    const val STATUS = "status"
    const val EMPTY = "empty"
    const val OVERDUE = "overdue"
    const val NOW = "now"
    const val TODAY = "today"
    const val DONE = "done"
    const val FAB = "add"
}

/** The Today screen: overdue, the one "now" task, today's tasks, then done (collapsed). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    state: TodayUiState,
    actions: TodayActions,
    modifier: Modifier = Modifier,
    bottomBar: @Composable () -> Unit = {},
) {
    var adding by rememberSaveable { mutableStateOf(false) }
    val locale = Locale.getDefault()
    val date = LocalDate.parse(state.sections.date)
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column(Modifier.semantics(mergeDescendants = true) { heading() }) {
                        Text(stringResource(R.string.today_title))
                        Text(
                            date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM", locale)),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = actions::openSettings, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.open_settings))
                    }
                },
            )
        },
        bottomBar = bottomBar,
        floatingActionButton = {
            FloatingActionButton(onClick = { adding = true }, modifier = Modifier.testTag(TodayTags.FAB)) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.add_task))
            }
        },
    ) { padding ->
        TodayList(state, actions, date, PaddingValues(bottom = 96.dp), Modifier.padding(padding), onAdd = { adding = true })
    }
    if (adding) {
        QuickAddSheet(
            today = date,
            onDismiss = { adding = false },
            onSave = { title, day, time, note ->
                actions.add(title, day, time, note)
                adding = false
            },
        )
    }
}

@Composable
private fun TodayList(
    state: TodayUiState,
    actions: TodayActions,
    today: LocalDate,
    contentPadding: PaddingValues,
    modifier: Modifier,
    onAdd: () -> Unit,
) {
    // The banner stays above the list: as a list item it could appear above the first visible row, off screen.
    Column(modifier.fillMaxSize()) {
        StatusBanner(state.connection, state.pendingChanges, actions::openSettings, Modifier.testTag(TodayTags.STATUS))
        TodayItems(state, actions, today, contentPadding, onAdd)
    }
}

@Composable
private fun TodayItems(
    state: TodayUiState,
    actions: TodayActions,
    today: LocalDate,
    contentPadding: PaddingValues,
    onAdd: () -> Unit,
) {
    var doneExpanded by rememberSaveable { mutableStateOf(false) }
    val sections = state.sections
    LazyColumn(Modifier.fillMaxSize(), contentPadding = contentPadding) {
        if (sections.isEmpty) item { EmptyState(onAdd) }
        if (sections.overdue.isNotEmpty()) {
            item {
                SectionHeader(
                    stringResource(R.string.section_overdue, sections.overdue.size),
                    Modifier.testTag(TodayTags.OVERDUE),
                    color = MaterialTheme.colorScheme.error,
                )
            }
            items(sections.overdue, key = { it.localId }) { OverdueRow(it, today, actions) }
        }
        sections.now?.let { now -> item(key = "now:${now.localId}") { NowCard(now, today, actions) } }
        if (sections.today.isNotEmpty()) {
            item { SectionHeader(stringResource(R.string.section_today), Modifier.testTag(TodayTags.TODAY)) }
            items(sections.today, key = { it.localId }) { TodayRow(it, today, actions) }
        }
        if (sections.done.isNotEmpty()) {
            item { DoneHeader(sections.done.size, doneExpanded) { doneExpanded = !doneExpanded } }
            if (doneExpanded) items(sections.done, key = { it.localId }) { DoneRow(it, actions) }
        }
    }
}

@Composable
private fun SectionHeader(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    Text(
        text = text.uppercase(Locale.getDefault()),
        style = MaterialTheme.typography.labelLarge,
        color = color,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp)
            .semantics { heading() },
    )
}

@Composable
private fun DoneHeader(count: Int, expanded: Boolean, onToggle: () -> Unit) {
    val stateText = stringResource(if (expanded) R.string.done_collapse else R.string.done_expand)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = stateText, onClick = onToggle)
            .padding(horizontal = 16.dp)
            .testTag(TodayTags.DONE)
            .semantics(mergeDescendants = true) {
                heading()
                stateDescription = stateText
            },
    ) {
        Text(
            stringResource(R.string.section_done, count).uppercase(Locale.getDefault()),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Icon(
            if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EmptyState(onAdd: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 48.dp)
            .testTag(TodayTags.EMPTY),
    ) {
        Text(
            stringResource(R.string.empty_today),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onAdd, modifier = Modifier.heightIn(min = 48.dp)) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.add_task))
        }
    }
}
