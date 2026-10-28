package dev.helm.planner.ui.today

import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.common.StatusBanner
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.ButtonTone
import dev.helm.planner.ui.components.EmptyState
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmButton
import dev.helm.planner.ui.components.HelmFab
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.common.SampleBanner
import dev.helm.planner.ui.common.StatusBanner
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object TodayTags {
    const val STATUS = "status"
    const val SAMPLE = "sample_banner"
    const val EMPTY = "empty"
    const val OVERDUE = "overdue"
    const val NOW = "now"
    const val TODAY = "today"
    const val DONE = "done"
    const val FAB = "add"
    const val PREVIOUS_DAY = "day-previous"
    const val NEXT_DAY = "day-next"
    fun row(localId: String) = "row-$localId"
}

/**
 * The Today screen: overdue, the one "now" task, today's tasks, then done (collapsed). The arrows in the header show
 * the day before or after, with its open tasks and the ones done on it; a tap on the header of another day comes
 * back to today.
 */
@Composable
fun TodayScreen(
    state: TodayUiState,
    actions: TodayActions,
    modifier: Modifier = Modifier,
    bottomBar: @Composable () -> Unit = {},
    /** Under the status lines, above the list: the plan health card. */
    header: @Composable () -> Unit = {},
    /** The moment quick add reads a date phrase at ("2pm" is today until 14:00, then tomorrow). */
    now: () -> Long = System::currentTimeMillis,
) {
    val p = palette
    var adding by rememberSaveable { mutableStateOf(false) }
    val today = LocalDate.parse(state.today)
    val shown = LocalDate.parse(state.sections.date)
    Scaffold(
        modifier = modifier,
        containerColor = p.background,
        topBar = { DayHeader(state.dayOffset, shown, today, actions) },
        bottomBar = bottomBar,
        floatingActionButton = {
            HelmFab(Icons.Filled.Add, stringResource(R.string.add_task), { adding = true }, Modifier.testTag(TodayTags.FAB))
        },
    ) { padding ->
        TodayList(state, actions, today, PaddingValues(bottom = 96.dp), Modifier.padding(padding), header, onAdd = { adding = true })
    }
    if (adding) {
        QuickAddSheet(
            timezone = state.timezone,
            now = now,
            defaultDay = state.sections.date.takeIf { state.dayOffset != 0 },
            onDismiss = { adding = false },
            onSave = { title, day, time, note, project ->
                actions.add(title, day, time, note, project)
                adding = false
            },
        )
    }
}

/**
 * "Today", "Tomorrow", "Yesterday" or the weekday, the full date under it, and the arrows to the day before and after
 * (each a 48 dp button with its name for a screen reader). On another day than today the title goes back to today.
 */
@Composable
private fun DayHeader(offset: Int, shown: LocalDate, today: LocalDate, actions: TodayActions) {
    val p = palette
    val locale = appLocale()
    val title = when (offset) {
        0 -> stringResource(R.string.today_title)
        1 -> stringResource(R.string.day_title_tomorrow)
        -1 -> stringResource(R.string.day_title_yesterday)
        else -> shown.format(DateTimeFormatter.ofPattern("EEEE", locale)).replaceFirstChar { it.titlecase(locale) }
    }
    LargeHeader(
        title = title,
        subtitle = shown.format(dateFormat(if (shown.year == today.year) "EEEEdMMMM" else "yEEEEdMMMM", locale)),
        onTitleClick = if (offset != 0) ({ actions.showDay(0) }) else null,
        titleClickLabel = stringResource(R.string.day_back_to_today),
    ) {
        HelmButton(
            null,
            { actions.showDay(offset - 1) },
            Modifier.testTag(TodayTags.PREVIOUS_DAY),
            tone = ButtonTone.Quiet,
            icon = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            description = stringResource(R.string.day_previous),
        )
        HelmButton(
            null,
            { actions.showDay(offset + 1) },
            Modifier.testTag(TodayTags.NEXT_DAY),
            tone = ButtonTone.Quiet,
            icon = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            description = stringResource(R.string.day_next),
        )
        HeaderIconButton(Icons.Filled.Settings, stringResource(R.string.open_settings), actions::openSettings, tint = p.textMuted)
    }
}

@Composable
private fun TodayList(
    state: TodayUiState,
    actions: TodayActions,
    today: LocalDate,
    contentPadding: PaddingValues,
    modifier: Modifier,
    header: @Composable () -> Unit,
    onAdd: () -> Unit,
) {
    // The banners stay above the list: as list items they could appear above the first visible row, off screen.
    Column(modifier.fillMaxSize()) {
        StatusBanner(state.connection, state.pendingChanges, actions::openSettings, Modifier.testTag(TodayTags.STATUS))
        if (state.sample) SampleBanner(actions::removeSample, Modifier.testTag(TodayTags.SAMPLE))
        header()
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
    val p = palette
    var doneExpanded by rememberSaveable { mutableStateOf(false) }
    val sections = state.sections
    val leaving = rememberLeavingTasks()
    // A ticked-off task stays a moment where it was (LeavingTasks); the rows under it then move up.
    val overdue = leaving.withLeaving(TodayTags.OVERDUE, sections.overdue)
    val todays = leaving.withLeaving(TodayTags.TODAY, sections.today)
    val nowTask = sections.now ?: leaving.leaving(TodayTags.NOW)
    val moving = if (leaving.reducedMotion) null else tween<IntOffset>(MOVE_MS)
    CompositionLocalProvider(LocalLeavingTasks provides leaving) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = contentPadding) {
        if (overdue.isEmpty() && nowTask == null && todays.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Filled.CheckCircle,
                    title = stringResource(if (state.dayOffset == 0) R.string.empty_today else R.string.empty_day),
                    action = stringResource(R.string.add_task),
                    actionIcon = Icons.Filled.Add,
                    onAction = onAdd,
                    modifier = Modifier.testTag(TodayTags.EMPTY),
                )
            }
        }
        if (overdue.isNotEmpty()) {
            item(key = TodayTags.OVERDUE) {
                SectionHeader(stringResource(R.string.section_overdue, sections.overdue.size), Modifier.testTag(TodayTags.OVERDUE), p.danger)
            }
            val rowActions = actions.keepingTicked(leaving, TodayTags.OVERDUE, overdue)
            items(overdue, key = { it.localId }) {
                Box(Modifier.animateItem(fadeInSpec = null, placementSpec = moving, fadeOutSpec = null)) {
                    OverdueRow(it, today, rowActions, state.blocked[it.localId])
                }
            }
        }
        nowTask?.let { now ->
            item(key = "now:${now.localId}") {
                NowCard(now, today, actions.keepingTicked(leaving, TodayTags.NOW, listOf(now)), state.blocked[now.localId])
            }
        }
        if (todays.isNotEmpty()) {
            item(key = TodayTags.TODAY) {
                val title = if (state.dayOffset == 0) stringResource(R.string.section_today) else stringResource(R.string.section_day_tasks)
                SectionHeader(title, Modifier.testTag(TodayTags.TODAY))
            }
            val rowActions = actions.keepingTicked(leaving, TodayTags.TODAY, todays)
            items(todays, key = { it.localId }) {
                Box(Modifier.animateItem(fadeInSpec = null, placementSpec = moving, fadeOutSpec = null)) {
                    TodayRow(it, today, rowActions, state.blocked[it.localId])
                }
            }
        }
        if (sections.done.isNotEmpty()) {
            item(key = TodayTags.DONE) { DoneHeader(sections.done.size, doneExpanded) { doneExpanded = !doneExpanded } }
            if (doneExpanded) items(sections.done, key = { "done:${it.localId}" }) { DoneRow(it, actions) }
        }
    }
    }
}

/** How long the rows under a ticked-off task take to move up into its place. */
private const val MOVE_MS = 160

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
