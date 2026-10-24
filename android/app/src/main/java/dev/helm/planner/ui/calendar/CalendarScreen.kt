package dev.helm.planner.ui.calendar

import android.icu.text.DateIntervalFormat
import android.icu.util.DateInterval
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onPlaced
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
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.HeaderIconButton
import dev.helm.planner.ui.components.LargeHeader
import dev.helm.planner.ui.components.SectionLabel
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.text.FieldPosition
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.launch

enum class CalendarMode { WEEK, DAY }

/** Pages either side of this week (or today); far more than anyone swipes. */
private const val PAGES = 10_000
private const val CENTER = PAGES / 2

/**
 * The calendar: the week's hours, Monday to Sunday (tasks with a time on the hours, the rest in a band on top), or one
 * day. A swipe or the arrows turn the week. On a tablet or a phone on its side the week's tasks have their titles; on a
 * phone held upright they are bars (see [barsOnly]): a tap on a day opens it with the titles, a long press lists its
 * tasks ([DaySheet]). A tap on a task opens its details; a long press lifts it to drag to another day and time (or, let
 * go without moving, opens the move sheet), with Undo.
 */
@Composable
fun CalendarScreen(
    state: CalendarUiState,
    actions: CalendarActions,
    modifier: Modifier = Modifier,
    initialMode: CalendarMode = CalendarMode.WEEK,
    bottomBar: @Composable () -> Unit = {},
) {
    BoxWithConstraints(modifier) {
        CalendarContent(state, actions, barsOnly(maxWidth, gutterWidth()), initialMode, bottomBar)
    }
}

@Composable
private fun CalendarContent(
    state: CalendarUiState,
    actions: CalendarActions,
    bars: Boolean,
    initialMode: CalendarMode,
    bottomBar: @Composable () -> Unit,
) {
    val p = palette
    val locale = appLocale()
    val today = LocalDate.parse(state.today)
    var mode by rememberSaveable { mutableStateOf(initialMode) }
    var dayPage by rememberSaveable { mutableIntStateOf(CENTER) }
    var moving by remember { mutableStateOf<CalendarEntry?>(null) }
    var holding by rememberSaveable { mutableStateOf<String?>(null) }
    val drag = remember { CalendarDragState() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val strip = rememberWeekStripState(today)
    val dayPager = rememberPagerState(initialPage = dayPage) { PAGES }
    LaunchedEffect(dayPager.settledPage) { dayPage = dayPager.settledPage }
    SideEffect { drag.surfaceKey = { if (mode == CalendarMode.WEEK) WEEK_SURFACE else dayPager.currentPage } }

    val dayOf = { page: Int -> today.plusDays((page - CENTER).toLong()) }
    val openDay = { date: String ->
        val page = CENTER + ChronoUnit.DAYS.between(today, LocalDate.parse(date)).toInt()
        dayPage = page
        scope.launch { dayPager.scrollToPage(page) }
        mode = CalendarMode.DAY
    }
    // Back in the week, the day just looked at is in view.
    val showWeek = {
        val index = strip.indexOf(dayOf(dayPager.currentPage))
        if (index !in strip.firstDay until strip.firstDay + WEEK_DAYS) strip.snapTo(strip.weekOf(index))
        mode = CalendarMode.WEEK
    }
    val week = mode == CalendarMode.WEEK
    val subtitle = if (week) {
        dateRange(strip.date(strip.firstDay), strip.date(strip.firstDay + WEEK_DAYS - 1))
    } else {
        dayOf(dayPager.currentPage).format(dateFormat("yMMMMEEEEd", locale))
    }
    val step = { by: Int ->
        scope.launch {
            if (week) strip.animateTo(strip.firstDay + by * WEEK_DAYS) else dayPager.animateScrollToPage(dayPager.currentPage + by)
        }
    }
    val atHome = if (week) strip.firstDay == strip.home(today) else dayPager.currentPage == CENTER
    val goHome = { scope.launch { if (week) strip.animateTo(strip.home(today)) else dayPager.animateScrollToPage(CENTER) } }
    BackHandler(enabled = !week) { showWeek() }
    val moved = stringResource(R.string.calendar_moved)
    val undo = stringResource(R.string.calendar_undo)
    val noTime = stringResource(R.string.calendar_no_time)
    val dayAndTime = stringResource(R.string.day_and_time)
    val onMove = { entry: CalendarEntry, date: String, time: String? ->
        actions.move(entry.task.localId, date, time)
        moving = null
        val whenText = dayAndTime.format(LocalDate.parse(date).format(dateFormat("EEEdMMM", locale)), time ?: noTime)
        scope.launch {
            snackbar.currentSnackbarData?.dismiss()
            val result = snackbar.showSnackbar(moved.format(whenText), actionLabel = undo, duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed) actions.move(entry.task.localId, entry.date, entry.time)
        }
        Unit
    }

    Scaffold(
        modifier = Modifier.testTag(CalendarTags.SCREEN),
        containerColor = p.background,
        topBar = {
            Column {
                LargeHeader(stringResource(R.string.calendar_title), subtitle = subtitle) {
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
                ModeTabs(mode, onMode = { if (it == CalendarMode.WEEK) showWeek() else mode = it }, showToday = !atHome, onToday = { goHome() })
                StatusBanner(state.connection, state.pendingChanges, actions::openSettings)
            }
        },
        bottomBar = bottomBar,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        CalendarDragHost(
            drag,
            onDrop = { entry, at -> onMove(entry, at.date, at.time) },
            onHold = { moving = it },
            Modifier.padding(padding).fillMaxSize(),
            sideEdge = if (week && bars) NARROW_DRAG_EDGE else DRAG_EDGE,
        ) {
            if (week) {
                WeekView(
                    strip,
                    bars,
                    state.tasks,
                    state.today,
                    state.nowMinute,
                    { actions.openTask(it.task.localId) },
                    { moving = it },
                    openDay,
                    { holding = it.date },
                    Modifier.fillMaxSize().testTag(CalendarTags.WEEK),
                )
            } else {
                HorizontalPager(dayPager, Modifier.fillMaxSize().testTag(CalendarTags.DAY), key = { it }) { page ->
                    val date = dayOf(page)
                    val day = remember(state.tasks, state.today, page) { CalendarDays.days(state.tasks, date, 1, state.today).single() }
                    val overdue = remember(state.tasks, state.today, page) { CalendarDays.overdueBefore(state.tasks, date.toString(), state.today) }
                    DayPage(page, day, overdue, state.today, state.nowMinute, { actions.openTask(it.task.localId) }, { moving = it }) { by ->
                        dayPager.animateScrollToPage(page + by)
                    }
                }
                if (drag.moved) UntimedDrop(drag.target.let { it != null && it.time == null })
            }
        }
    }
    holding?.let { date ->
        val day = remember(state.tasks, state.today, date) { CalendarDays.days(state.tasks, LocalDate.parse(date), 1, state.today).single() }
        DaySheet(
            day,
            onDismiss = { holding = null },
            onOpen = {
                holding = null
                actions.openTask(it.task.localId)
            },
            onMove = {
                holding = null
                moving = it
            },
            onOpenDay = {
                holding = null
                openDay(it)
            },
        )
    }
    moving?.let { entry -> MoveSheet(entry, onDismiss = { moving = null }) { date, time -> onMove(entry, date, time) } }
}

/**
 * Week or day as two text tabs with a line under the chosen one (as the board's columns), and "Today" on the right
 * when the view is elsewhere.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModeTabs(mode: CalendarMode, onMode: (CalendarMode) -> Unit, showToday: Boolean, onToday: () -> Unit) {
    val p = palette
    Column {
        Row(
            Modifier.fillMaxWidth().padding(end = HelmDimens.screenMargin - 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PrimaryScrollableTabRow(
                selectedTabIndex = mode.ordinal,
                modifier = Modifier.weight(1f),
                edgePadding = HelmDimens.screenMargin - 16.dp,
                containerColor = p.background,
                contentColor = p.accent,
                divider = {},
            ) {
                CalendarMode.entries.forEach { m ->
                    Tab(
                        selected = mode == m,
                        onClick = { onMode(m) },
                        selectedContentColor = p.accent,
                        unselectedContentColor = p.textMuted,
                        text = {
                            Text(
                                stringResource(if (m == CalendarMode.WEEK) R.string.calendar_week else R.string.calendar_day),
                                style = helmType.smallStrong.copy(fontSize = helmType.body.fontSize),
                                maxLines = 1,
                            )
                        },
                        modifier = Modifier
                            .heightIn(min = HelmDimens.touchTarget)
                            .testTag(if (m == CalendarMode.WEEK) CalendarTags.MODE_WEEK else CalendarTags.MODE_DAY),
                    )
                }
            }
            if (showToday) TextAction(stringResource(R.string.calendar_go_today), onToday, modifier = Modifier.testTag(CalendarTags.TODAY))
        }
        HorizontalDivider(color = p.border)
    }
}

/** "Oct 19 – 25, 2026", "19.–25. Okt. 2026", "2026年10月19日～25日": the week as the app's language writes a range. */
@Composable
private fun dateRange(first: LocalDate, last: LocalDate): String {
    val format = DateIntervalFormat.getInstance("yMMMd", appLocale())
    // Noon, so a daylight saving change cannot move either day.
    val millis = { date: LocalDate -> date.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }
    return format.format(DateInterval(millis(first), millis(last)), StringBuffer(), FieldPosition(0)).toString()
}

/**
 * While a task is dragged in the day view, a row over the top of the day: dropped there (or on the lists above the
 * hours), it has no time. [hovered] when the task is over it.
 */
@Composable
private fun UntimedDrop(hovered: Boolean) {
    val p = palette
    Box(
        Modifier
            .fillMaxWidth()
            .height(HelmDimens.touchTarget)
            .background(if (hovered) p.accentSoft else p.surface)
            .drawBehind { drawLine(p.border, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1.dp.toPx()) }
            .padding(horizontal = HelmDimens.screenMargin)
            .testTag(CalendarTags.DROP_UNTIMED),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(stringResource(R.string.calendar_no_time_short), style = helmType.smallStrong, color = if (hovered) p.text else p.textMuted)
    }
}

@Composable
private fun DayPage(
    page: Int,
    day: CalendarDay,
    overdue: List<dev.helm.planner.data.local.Task>,
    today: String,
    nowMinute: Int,
    onOpen: (CalendarEntry) -> Unit,
    onMove: (CalendarEntry) -> Unit,
    step: suspend (by: Int) -> Unit,
) {
    val p = palette
    val listed = overdue.isNotEmpty() || day.untimed.isNotEmpty()
    // Lists (or the "nothing planned" line) start at the top; otherwise the hours start near now or 07:00.
    val start = with(LocalDensity.current) { if (listed || day.timed.isEmpty()) 0 else (HOUR_HEIGHT * firstHour(day, nowMinute) - HOUR_LABEL_ROOM).roundToPx().coerceAtLeast(0) }
    val scroll = rememberScrollState(start)
    val hours = rememberHoursDrop(page, scroll, band = HelmDimens.touchTarget, dateAt = { day.date }, step = step)
    Column(Modifier.fillMaxSize().onPlaced { hours.viewport = it }.verticalScroll(scroll)) {
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
        HourGrid(listOf(day), nowMinute, onOpen, onMove, Modifier.onPlaced { hours.hours = it }, showTime = true)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun DaySection(text: String, color: androidx.compose.ui.graphics.Color) {
    SectionLabel(text, Modifier.fillMaxWidth().padding(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, top = 12.dp, bottom = 4.dp), color = color)
}
