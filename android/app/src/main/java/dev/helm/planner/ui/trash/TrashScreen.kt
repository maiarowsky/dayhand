package dev.helm.planner.ui.trash

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.components.EmptyState
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.task.TRASH_DAYS
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
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
@Composable
fun TrashScreen(state: TrashUiState, actions: TrashActions, modifier: Modifier = Modifier) {
    val today = LocalDate.parse(state.today)
    Column(modifier.fillMaxSize().background(palette.background)) {
        ScreenHeader(stringResource(R.string.trash_title), onBack = actions::back)
        LazyColumn(
            Modifier
                .weight(1f)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)),
            contentPadding = PaddingValues(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                if (state.tasks.isEmpty()) {
                    EmptyState(
                        Icons.Outlined.Delete,
                        pluralStringResource(R.plurals.trash_empty, TRASH_DAYS.toInt(), TRASH_DAYS),
                        Modifier.testTag(TrashTags.EMPTY),
                    )
                } else {
                    Text(
                        pluralStringResource(R.plurals.trash_hint, TRASH_DAYS.toInt(), TRASH_DAYS),
                        style = helmType.small,
                        color = palette.textMuted,
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                    )
                }
            }
            items(state.tasks, key = { it.localId }) { TrashRow(it, today, state.timezone, actions) }
        }
    }
}

@Composable
private fun TrashRow(task: Task, today: LocalDate, timezone: String, actions: TrashActions) {
    val p = palette
    val deleted = Instant.ofEpochMilli(task.deletedAt ?: 0).atZone(HelmDates.zone(timezone)).toLocalDate()
    val restoreText = stringResource(R.string.restore_described, task.title)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(HelmShapes.option)
            .background(p.surface)
            .padding(end = 4.dp)
            .testTag(TrashTags.row(task.localId)),
    ) {
        Column(
            Modifier
                .weight(1f)
                .heightIn(min = HelmDimens.rowMinHeight)
                .clickable(onClickLabel = stringResource(R.string.open_details)) { actions.openTask(task.localId) }
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(task.title, style = helmType.body, color = p.text)
            Text(
                stringResource(R.string.trash_deleted_on, dayLabel(deleted, today), dayLabel(deleted.plusDays(TRASH_DAYS), today)),
                style = helmType.small,
                color = p.textMuted,
            )
        }
        TextAction(
            stringResource(R.string.restore),
            onClick = { actions.restore(task.localId) },
            modifier = Modifier.semantics { contentDescription = restoreText },
        )
    }
}
