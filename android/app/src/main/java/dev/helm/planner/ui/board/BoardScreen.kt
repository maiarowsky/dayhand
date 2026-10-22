package dev.helm.planner.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.ui.common.StatusBanner
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.today.QuickAddSheet
import java.time.LocalDate
import kotlin.math.roundToInt

object BoardTags {
    const val STATUS = "board-status"
    const val NOW = "board-now"
    const val FAB = "board-add"
    const val EMPTY = "board-empty"
    fun tab(status: TaskStatus) = "board-tab-${status.wire}"
    fun column(status: TaskStatus) = "board-column-${status.wire}"
    fun card(localId: String) = "board-card-$localId"
}

/** Columns side by side from this width; narrower screens show one column at a time under tabs. */
private val WIDE_BOARD = 600.dp

/** The board: to do / in progress / done, with the one "now" task leading "in progress". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardScreen(
    state: BoardUiState,
    actions: BoardActions,
    modifier: Modifier = Modifier,
    bottomBar: @Composable () -> Unit = {},
) {
    var adding by rememberSaveable { mutableStateOf(false) }
    val today = LocalDate.parse(state.columns.date)
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.board_title), modifier = Modifier.semantics { heading() }) },
                actions = {
                    IconButton(onClick = actions::openTrash, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.trash_title))
                    }
                    IconButton(onClick = actions::openSettings, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.open_settings))
                    }
                },
            )
        },
        bottomBar = bottomBar,
        floatingActionButton = {
            FloatingActionButton(onClick = { adding = true }, modifier = Modifier.testTag(BoardTags.FAB)) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.add_task))
            }
        },
    ) { padding ->
        val drag = remember { BoardDragState() }
        var rootOrigin by remember { mutableStateOf(Offset.Zero) }
        BoxWithConstraints(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .onGloballyPositioned { rootOrigin = it.positionInRoot() },
        ) {
            val wide = maxWidth >= WIDE_BOARD
            Column(Modifier.fillMaxSize()) {
                StatusBanner(state.connection, state.pendingChanges, actions::openSettings, Modifier.testTag(BoardTags.STATUS))
                if (wide) {
                    SideBySide(state, today, actions, drag)
                } else {
                    Tabbed(state, today, actions, drag)
                }
            }
            DragGhost(drag, rootOrigin, today)
        }
    }
    if (adding) {
        QuickAddSheet(
            today = today,
            onDismiss = { adding = false },
            onSave = { title, day, time, note ->
                actions.add(title, day, time, note)
                adding = false
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Tabbed(state: BoardUiState, today: LocalDate, actions: BoardActions, drag: BoardDragState) {
    var selected by rememberSaveable { mutableStateOf(TaskStatus.TODO) }
    // Scrollable, so a column name is never broken mid-word at the largest system font.
    PrimaryScrollableTabRow(selectedTabIndex = selected.ordinal, edgePadding = 0.dp) {
        TaskStatus.entries.forEach { status ->
            Tab(
                selected = selected == status,
                onClick = { selected = status },
                text = { Text(columnTitle(status, state.columns.column(status).size), maxLines = 1) },
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .dropTarget(drag, status)
                    .hoverHighlight(drag.hovered == status)
                    .testTag(BoardTags.tab(status)),
            )
        }
    }
    ColumnList(selected, state, today, actions, drag, Modifier.testTag(BoardTags.column(selected)))
}

@Composable
private fun SideBySide(state: BoardUiState, today: LocalDate, actions: BoardActions, drag: BoardDragState) {
    Row(Modifier.fillMaxSize()) {
        TaskStatus.entries.forEach { status ->
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .dropTarget(drag, status)
                    .hoverHighlight(drag.hovered == status)
                    .testTag(BoardTags.column(status)),
            ) {
                Text(
                    columnTitle(status, state.columns.column(status).size),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                        .semantics { heading() },
                )
                ColumnList(status, state, today, actions, drag, Modifier)
            }
        }
    }
}

@Composable
private fun ColumnList(
    status: TaskStatus,
    state: BoardUiState,
    today: LocalDate,
    actions: BoardActions,
    drag: BoardDragState,
    modifier: Modifier,
) {
    val tasks = state.columns.column(status)
    val now = state.columns.now.takeIf { status == TaskStatus.DOING }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp)) {
        if (tasks.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.board_empty_column),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp)
                        .testTag(BoardTags.EMPTY),
                )
            }
        }
        if (now != null) item(key = "now:${now.localId}") { NowBoardCard(now, today, actions, drag) }
        items(tasks.filter { it.localId != now?.localId }, key = { it.localId }) { BoardCard(it, today, actions, drag) }
    }
}

@Composable
private fun columnTitle(status: TaskStatus, count: Int) = stringResource(R.string.column_with_count, statusLabel(status), count)

@Composable
private fun Modifier.hoverHighlight(hovered: Boolean): Modifier =
    if (hovered) background(MaterialTheme.colorScheme.primaryContainer) else this

/** The card under the finger while it is dragged. */
@Composable
private fun DragGhost(drag: BoardDragState, rootOrigin: Offset, today: LocalDate) {
    val task: Task = drag.task ?: return
    val width = with(LocalDensity.current) { drag.cardSize.width.toDp() }
    Box(
        Modifier.offset {
            val at = drag.pointer - rootOrigin - drag.grab
            IntOffset(at.x.roundToInt(), at.y.roundToInt())
        },
    ) {
        Card(
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
            modifier = Modifier.width(width),
        ) {
            CardContent(task, today, Modifier.padding(16.dp))
        }
    }
}
