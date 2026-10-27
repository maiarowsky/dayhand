package dev.helm.planner.ui.threads

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.Threads
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.palette

object ThreadTags {
    const val LIST = "threads-list"
    const val EMPTY = "threads-empty"
    const val CLOSE = "thread-close"
    const val CLOSE_CONFIRM = "thread-close-confirm"
    const val OPEN_TASK = "thread-open-task"
    fun group(group: Threads.Group) = "threads-group-${group.name.lowercase()}"
    fun row(localId: String) = "thread-row-$localId"
    fun field(field: Threads.Field) = "thread-field-${field.name.lowercase()}"
}

/**
 * Open threads in three groups: to confirm (the assistant has finished), waiting for the owner, and in progress. The
 * header counts the first two, what the owner is asked for. A row opens the thread's details.
 */
@Composable
fun ThreadsScreen(state: ThreadsUiState, onThread: (String) -> Unit, onBack: () -> Unit, bottomBar: @Composable () -> Unit = {}) {
    val groups = state.groups
    Scaffold(containerColor = palette.background, bottomBar = bottomBar, topBar = {
        LargeHeader(stringResource(R.string.threads_title), subtitle = stringResource(R.string.threads_attention, groups.attention), onBack = onBack)
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = HelmDimens.screenMargin).padding(bottom = 24.dp).testTag(ThreadTags.LIST),
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap)) {
            if (groups.isEmpty()) ListNote(stringResource(R.string.threads_empty), Modifier.padding(top = 12.dp).testTag(ThreadTags.EMPTY))
            ThreadGroup(Threads.Group.TO_CONFIRM, R.string.thread_group_confirm, groups.toConfirm, state.now, palette.accent, onThread)
            ThreadGroup(Threads.Group.WAITING, R.string.thread_group_waiting, groups.waiting, state.now, palette.warning, onThread)
            ThreadGroup(Threads.Group.IN_PROGRESS, R.string.thread_group_progress, groups.inProgress, state.now, palette.textMuted, onThread)
        }
    }
}

@Composable
private fun ThreadGroup(group: Threads.Group, title: Int, threads: List<Threads.Thread>, now: Long, ageColor: Color, onThread: (String) -> Unit) {
    if (threads.isEmpty()) return
    ListGroup("${stringResource(title)} (${threads.size})", threads.map { thread -> @Composable {
        ListRow(thread.topic, ThreadTags.row(thread.task.localId), value = ageLabel(Threads.age(thread.task.updatedAt, now)),
            note = thread.headline, valueColor = ageColor, onClick = { onThread(thread.task.localId) })
    } }, Modifier.testTag(ThreadTags.group(group)))
}

@Composable
fun ageLabel(age: Threads.Age): String = when (age) {
    Threads.Age.Now -> stringResource(R.string.thread_age_now)
    is Threads.Age.Minutes -> stringResource(R.string.thread_age_minutes, age.value)
    is Threads.Age.Hours -> stringResource(R.string.thread_age_hours, age.value)
    is Threads.Age.Days -> stringResource(R.string.thread_age_days, age.value)
}
