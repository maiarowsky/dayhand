package dev.helm.planner.ui.today

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.BannerTone
import dev.helm.planner.ui.components.EmptyState
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.StatusBanner
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.palette
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
@Composable
fun TodayScreen(state: TodayUiState, actions: TodayActions, modifier: Modifier = Modifier) {
    val p = palette
    var adding by rememberSaveable { mutableStateOf(false) }
    val locale = Locale.getDefault()
    val date = LocalDate.parse(state.sections.date)
    Scaffold(
        modifier = modifier,
        containerColor = p.background,
        topBar = {
            LargeHeader(
                title = stringResource(R.string.today_title),
                subtitle = date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM", locale)),
            ) {
                HeaderIconButton(Icons.Filled.Settings, stringResource(R.string.open_settings), actions::openSettings, tint = p.textMuted)
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { adding = true },
                containerColor = p.accent,
                contentColor = p.onAccent,
                shape = HelmShapes.pill,
                modifier = Modifier.testTag(TodayTags.FAB),
            ) {
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
    val p = palette
    var doneExpanded by rememberSaveable { mutableStateOf(false) }
    val sections = state.sections
    LazyColumn(modifier.fillMaxSize(), contentPadding = contentPadding) {
        item { StatusLine(state.connection, state.pendingChanges, actions::openSettings) }
        if (sections.isEmpty) {
            item {
                EmptyState(
                    icon = Icons.Filled.CheckCircle,
                    title = stringResource(R.string.empty_today),
                    action = stringResource(R.string.add_task),
                    actionIcon = Icons.Filled.Add,
                    onAction = onAdd,
                    modifier = Modifier.testTag(TodayTags.EMPTY),
                )
            }
        }
        if (sections.overdue.isNotEmpty()) {
            item {
                SectionHeader(stringResource(R.string.section_overdue, sections.overdue.size), Modifier.testTag(TodayTags.OVERDUE), p.danger)
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
private fun SectionHeader(text: String, modifier: Modifier = Modifier, color: Color = palette.accent) {
    SectionLabel(
        text,
        color = color,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, top = 20.dp, bottom = 4.dp),
    )
}

@Composable
private fun DoneHeader(count: Int, expanded: Boolean, onToggle: () -> Unit) {
    val p = palette
    val stateText = stringResource(if (expanded) R.string.done_collapse else R.string.done_expand)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = HelmDimens.touchTarget)
            .padding(top = 12.dp)
            .clickable(onClickLabel = stateText, onClick = onToggle)
            .padding(horizontal = HelmDimens.screenMargin)
            .testTag(TodayTags.DONE)
            .semantics(mergeDescendants = true) {
                heading()
                stateDescription = stateText
            },
    ) {
        SectionLabel(stringResource(R.string.section_done, count), Modifier.weight(1f), color = p.textMuted)
        Icon(
            if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
            contentDescription = null,
            tint = p.textMuted,
        )
    }
}

/** The state of the connection when it needs a word: offline, changes waiting, no server, refused token. */
@Composable
private fun StatusLine(status: ConnectionStatus, pending: Int, openSettings: () -> Unit) {
    val text = when (status) {
        ConnectionStatus.OFFLINE -> stringResource(R.string.status_offline, pending)
        ConnectionStatus.OFFLINE_MODE -> stringResource(R.string.status_offline_mode, pending)
        ConnectionStatus.NOT_CONFIGURED -> stringResource(R.string.status_not_configured)
        ConnectionStatus.UNAUTHORIZED -> stringResource(R.string.status_unauthorized)
        ConnectionStatus.ERROR -> stringResource(R.string.status_error)
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING ->
            if (pending > 0) stringResource(R.string.status_sending, pending) else return
    }
    val tone = when (status) {
        ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> BannerTone.Danger
        ConnectionStatus.OFFLINE, ConnectionStatus.OFFLINE_MODE, ConnectionStatus.NOT_CONFIGURED -> BannerTone.Warning
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING -> BannerTone.Info
    }
    val needsSettings = status == ConnectionStatus.NOT_CONFIGURED || status == ConnectionStatus.UNAUTHORIZED
    StatusBanner(
        text = text,
        tone = tone,
        action = if (needsSettings) stringResource(R.string.open_settings) else null,
        onAction = openSettings,
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .testTag(TodayTags.STATUS),
    )
}
