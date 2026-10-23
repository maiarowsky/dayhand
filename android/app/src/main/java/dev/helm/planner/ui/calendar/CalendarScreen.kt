package dev.helm.planner.ui.calendar

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.domain.CalendarDay
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.CalendarEntry
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.common.StatusBanner
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.launch

enum class CalendarMode { WEEK, DAY }

/** Pages either side of this week (or today); far more than anyone swipes. */
private const val PAGES = 10_000
private const val CENTER = PAGES / 2

/**
 * The calendar: a week of hours (tasks with a time on the hours, the rest in a band on top) or one day, swiped
 * week by week or day by day. A tap on a task opens its details; a long press moves it, with Undo.
 */
@Composable
fun CalendarScreen(
    state: CalendarUiState,
    actions: CalendarActions,
    modifier: Modifier = Modifier,
    initialMode: CalendarMode = CalendarMode.WEEK,
    bottomBar: @Composable () -> Unit = {},
) {
    val p = palette
    val locale = appLocale()
    val today = LocalDate.parse(state.today)
    var mode by rememberSaveable { mutableStateOf(initialMode) }
    var weekPage by rememberSaveable { mutableIntStateOf(CENTER) }
    var dayPage by rememberSaveable { mutableIntStateOf(CENTER) }
    var moving by remember { mutableStateOf<CalendarEntry?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val weekPager = rememberPagerState(initialPage = weekPage) { PAGES }
    val dayPager = rememberPagerState(initialPage = dayPage) { PAGES }
    LaunchedEffect(weekPager.settledPage) { weekPage = weekPager.settledPage }
    LaunchedEffect(dayPager.settledPage) { dayPage = dayPager.settledPage }
    BackHandler(enabled = mode == CalendarMode.DAY) { mode = CalendarMode.WEEK }

    val thisWeek = CalendarDays.weekStart(today)
    val weekOf = { page: Int -> thisWeek.plusWeeks((page - CENTER).toLong()) }
    val dayOf = { page: Int -> today.plusDays((page - CENTER).toLong()) }
    val openDay = { date: String ->
        val page = CENTER + ChronoUnit.DAYS.between(today, LocalDate.parse(date)).toInt()
        dayPage = page
        scope.launch { dayPager.scrollToPage(page) }
        mode = CalendarMode.DAY
    }
    val pager = if (mode == CalendarMode.WEEK) weekPager else dayPager
    val subtitle = if (mode == CalendarMode.WEEK) {
        weekRange(weekOf(weekPager.currentPage))
    } else {
        dayOf(dayPager.currentPage).format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
    }
    val step = { by: Int -> scope.launch { pager.animateScrollToPage(pager.currentPage + by) } }
    val moved = stringResource(R.string.calendar_moved)
    val undo = stringResource(R.string.calendar_undo)
    val noTime = stringResource(R.string.calendar_no_time)
    val onMove = { entry: CalendarEntry, date: String, time: String? ->
        actions.move(entry.task.localId, date, time)
        moving = null
        val whenText = LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEE d MMM", locale)) + ", " + (time ?: noTime)
        scope.launch {
            snackbar.currentSnackbarData?.dismiss()
            val result = snackbar.showSnackbar(moved.format(whenText), actionLabel = undo, duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed) actions.move(entry.task.localId, entry.date, entry.time)
        }
        Unit
    }

    Scaffold(
        modifier = modifier.testTag(CalendarTags.SCREEN),
        containerColor = p.background,
        topBar = {
            Column {
                LargeHeader(stringResource(R.string.calendar_title), subtitle = subtitle) {
                    val week = mode == CalendarMode.WEEK
                    HeaderIconButton(
                        Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                        stringResource(if (week) R.string.calendar_previous_week else R.string.calendar_previous_day),
                        { step(-1) },
                        Modifier.testTag(CalendarTags.PREVIOUS),
                        tint = p.textMuted,
                    )
                    HeaderIconButton(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        stringResource(if (week) R.string.calendar_next_week else R.string.calendar_next_day),
                        { step(1) },
                        Modifier.testTag(CalendarTags.NEXT),
                        tint = p.textMuted,
                    )
                    HeaderIconButton(Icons.Filled.Settings, stringResource(R.string.open_settings), actions::openSettings, tint = p.textMuted)
                }
                ModeRow(mode, onMode = { mode = it }, showToday = pager.currentPage != CENTER) {
                    scope.launch { pager.animateScrollToPage(CENTER) }
                }
                StatusBanner(state.connection, state.pendingChanges, actions::openSettings)
            }
        },
        bottomBar = bottomBar,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (mode == CalendarMode.WEEK) {
                HorizontalPager(weekPager, Modifier.fillMaxSize().testTag(CalendarTags.WEEK), key = { it }) { page ->
                    val days = remember(state.tasks, state.today, page) { CalendarDays.days(state.tasks, weekOf(page), 7, state.today) }
                    WeekPage(days, state.nowMinute, { actions.openTask(it.task.localId) }, { moving = it }, openDay)
                }
            } else {
                HorizontalPager(dayPager, Modifier.fillMaxSize().testTag(CalendarTags.DAY), key = { it }) { page ->
                    val date = dayOf(page)
                    val day = remember(state.tasks, state.today, page) { CalendarDays.days(state.tasks, date, 1, state.today).single() }
                    val overdue = remember(state.tasks, state.today, page) { CalendarDays.overdueBefore(state.tasks, date.toString(), state.today) }
                    DayPage(day, overdue, state.today, state.nowMinute, { actions.openTask(it.task.localId) }, { moving = it })
                }
            }
        }
    }
    moving?.let { entry -> MoveSheet(entry, onDismiss = { moving = null }) { date, time -> onMove(entry, date, time) } }
}

@Composable
private fun ModeRow(mode: CalendarMode, onMode: (CalendarMode) -> Unit, showToday: Boolean, onToday: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = HelmDimens.screenMargin, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HelmChip(stringResource(R.string.calendar_week), mode == CalendarMode.WEEK, { onMode(CalendarMode.WEEK) }, Modifier.testTag(CalendarTags.MODE_WEEK))
        HelmChip(stringResource(R.string.calendar_day), mode == CalendarMode.DAY, { onMode(CalendarMode.DAY) }, Modifier.testTag(CalendarTags.MODE_DAY))
        Spacer(Modifier.weight(1f))
        if (showToday) TextAction(stringResource(R.string.calendar_go_today), onToday, modifier = Modifier.testTag(CalendarTags.TODAY))
    }
}

/** "19 – 25 Oct 2026". */
@Composable
private fun weekRange(monday: LocalDate): String {
    val locale = appLocale()
    val sunday = monday.plusDays(6)
    val end = sunday.format(DateTimeFormatter.ofPattern("d MMM yyyy", locale))
    val start = monday.format(DateTimeFormatter.ofPattern(if (monday.month == sunday.month) "d" else "d MMM", locale))
    return "$start – $end"
}

@Composable
private fun WeekPage(
    days: List<CalendarDay>,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    onOpenDay: (String) -> Unit,
) {
    val start = with(LocalDensity.current) { (HOUR_HEIGHT * firstHour(days.firstOrNull { it.isToday }, nowMinute) - HOUR_LABEL_ROOM).roundToPx().coerceAtLeast(0) }
    Column(Modifier.fillMaxSize()) {
        DayHeaders(days, onOpenDay)
        UntimedBand(days, onOpen, onMove, onOpenDay)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState(start))) {
            HourGrid(days, nowMinute, onOpen, onMove)
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DayPage(
    day: CalendarDay,
    overdue: List<dev.helm.planner.data.local.Task>,
    today: String,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
) {
    val p = palette
    val listed = overdue.isNotEmpty() || day.untimed.isNotEmpty()
    // Lists (or the "nothing planned" line) start at the top; otherwise the hours start near now or 07:00.
    val start = with(LocalDensity.current) { if (listed || day.timed.isEmpty()) 0 else (HOUR_HEIGHT * firstHour(day, nowMinute) - HOUR_LABEL_ROOM).roundToPx().coerceAtLeast(0) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState(start))) {
        if (overdue.isNotEmpty()) {
            DaySection(stringResource(R.string.section_overdue, overdue.size), p.danger)
            overdue.forEach { task ->
                val entry = CalendarEntry(task, task.dueDate!!, task.dueTime, repeat = false, overdue = HelmDates.isOverdue(task, today), done = false)
                EntryRow(entry, onOpen, onMove)
            }
        }
        if (day.untimed.isNotEmpty()) {
            DaySection(stringResource(R.string.calendar_no_time), p.accent)
            day.untimed.forEach { EntryRow(it, onOpen, onMove) }
        }
        if (!listed && day.timed.isEmpty()) {
            Text(
                stringResource(R.string.calendar_empty_day),
                style = helmType.body,
                color = p.textMuted,
                modifier = Modifier.padding(horizontal = HelmDimens.screenMargin, vertical = 12.dp),
            )
        }
        if (listed) Spacer(Modifier.height(12.dp))
        HourGrid(listOf(day), nowMinute, onOpen, onMove, showTime = true)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun DaySection(text: String, color: androidx.compose.ui.graphics.Color) {
    SectionLabel(text, Modifier.fillMaxWidth().padding(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, top = 12.dp, bottom = 4.dp), color = color)
}
