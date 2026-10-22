package dev.helm.planner.ui.trash

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.task.TRASH_DAYS
import java.time.Instant
import java.time.LocalDate

object TrashTags {
    const val EMPTY = "trash-empty"
    fun row(localId: String) = "trash-$localId"
}

data class TrashUiState(val tasks: List<Task>, val today: String, val timezone: String)

interface TrashActions {
    fun restore(localId: String) {}
    fun openTask(localId: String) {}
    fun back() {}
}

/** Tasks in the trash, newest first; each can be restored for 30 days. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrashScreen(state: TrashUiState, actions: TrashActions, modifier: Modifier = Modifier) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.trash_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = actions::back, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        val today = LocalDate.parse(state.today)
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Text(
                    stringResource(if (state.tasks.isEmpty()) R.string.trash_empty else R.string.trash_hint, TRASH_DAYS),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(16.dp)
                        .then(if (state.tasks.isEmpty()) Modifier.testTag(TrashTags.EMPTY) else Modifier),
                )
            }
            items(state.tasks, key = { it.localId }) { TrashRow(it, today, state.timezone, actions) }
        }
    }
}

@Composable
private fun TrashRow(task: Task, today: LocalDate, timezone: String, actions: TrashActions) {
    val deleted = Instant.ofEpochMilli(task.deletedAt ?: 0).atZone(HelmDates.zone(timezone)).toLocalDate()
    val restoreText = stringResource(R.string.restore_described, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp)
            .testTag(TrashTags.row(task.localId)),
    ) {
        Column(
            Modifier
                .weight(1f)
                .heightIn(min = 48.dp)
                .clickable(onClickLabel = stringResource(R.string.open_details)) { actions.openTask(task.localId) }
                .padding(vertical = 8.dp),
        ) {
            Text(task.title, style = MaterialTheme.typography.bodyLarge)
            Text(
                stringResource(R.string.trash_deleted_on, dayLabel(deleted, today), dayLabel(deleted.plusDays(TRASH_DAYS), today)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(
            onClick = { actions.restore(task.localId) },
            modifier = Modifier
                .heightIn(min = 48.dp)
                .semantics { contentDescription = restoreText },
        ) { Text(stringResource(R.string.restore)) }
    }
}
