package dev.helm.planner

import android.Manifest
import android.graphics.Color
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.auth.PairingInput
import dev.helm.planner.auth.PairingLink
import dev.helm.planner.ui.projects.ProjectHost
import dev.helm.planner.ui.projects.ProjectsViewModel
import dev.helm.planner.ui.projects.ProjectsScreen
import dev.helm.planner.ui.projects.ProjectViewModel
import dev.helm.planner.ui.projects.ProjectScreen
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.components.ProjectFolderIcon
import dev.helm.planner.ui.agents.AgentsRoute
import dev.helm.planner.ui.connect.ConnectRoute
import dev.helm.planner.ui.board.BoardActions
import dev.helm.planner.ui.board.BoardScreen
import dev.helm.planner.ui.board.BoardViewModel
import dev.helm.planner.ui.calendar.CalendarActions
import dev.helm.planner.ui.calendar.CalendarScreen
import dev.helm.planner.ui.calendar.CalendarViewModel
import dev.helm.planner.ui.settings.SettingsRoute
import dev.helm.planner.ui.settings.needsNotificationPermission
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.task.TaskDetailViewModel
import dev.helm.planner.ui.components.HelmTab
import dev.helm.planner.ui.components.HelmTabBar
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.HealthCard
import dev.helm.planner.ui.today.HealthCardViewModel
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayViewModel
import dev.helm.planner.ui.trash.TrashActions
import dev.helm.planner.ui.trash.TrashScreen
import dev.helm.planner.ui.trash.TrashViewModel

class MainActivity : ComponentActivity() {
    /** A `dayhand://pair` (or older `helm://pair`) link (QR code from `dayhand pair`) waiting to fill in the Connect screen. */
    private var pairingLink by mutableStateOf<PairingLink?>(null)

    /** An approval request's notification was tapped: Agents opens over Today. */
    private var openAgents by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as HelmApplication).container
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        if (savedInstanceState == null) {
            pairingLink = linkOf(intent)
            openAgents = wantsAgents(intent)
        }
        setContent {
            val appearance by container.appearance.appearance.collectAsStateWithLifecycle()
            val systemDark = isSystemInDarkTheme()
            val light = appearance.palette(systemDark).light
            // Status and navigation bar icons follow the palette, not the system mode.
            LaunchedEffect(light) {
                val style = if (light) {
                    SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                } else {
                    SystemBarStyle.dark(Color.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            HelmTheme(appearance, systemDark) {
                ProjectHost(container.repository, container.settings) {
                    HelmRoot(container, versionName, pairingLink, onLinkUsed = { pairingLink = null }, openAgents, onAgentsOpened = { openAgents = false })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        linkOf(intent)?.let { pairingLink = it }
        if (wantsAgents(intent)) openAgents = true
    }

    private fun wantsAgents(intent: Intent?): Boolean = intent?.getStringExtra(EXTRA_OPEN) == OPEN_AGENTS

    companion object {
        /** What a notification opens; [OPEN_AGENTS] for an approval request. */
        const val EXTRA_OPEN = "dev.helm.planner.OPEN"
        const val OPEN_AGENTS = "agents"
    }

    private fun linkOf(intent: Intent?): PairingLink? =
        intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString?.let(PairingInput::parseLink)
}

/** Screens; a task's details are `task/<localId>`. Today, the calendar and the board are the main views. */
private object Route {
    const val TODAY = "today"
    const val CALENDAR = "calendar"
    const val BOARD = "board"
    const val TRASH = "trash"
    const val SETTINGS = "settings"
    const val CONNECT = "connect"
    const val AGENTS = "agents"
    const val PROJECTS = "projects"
    const val PROJECT = "project/"
    const val LABEL = "label/"
    fun project(localId: String?) = PROJECT + (localId ?: "none")
    fun label(name: String) = LABEL + android.net.Uri.encode(name)

    /** Connect shown by itself at the first start without a server (with "Not now"). */
    const val FIRST_CONNECT = "first-connect"
    private const val TASK = "task/"

    fun task(localId: String) = TASK + localId
    fun taskId(route: String): String? = route.removePrefix(TASK).takeIf { route.startsWith(TASK) }
}

@Composable
private fun HelmRoot(
    container: AppContainer,
    versionName: String,
    pairingLink: PairingLink?,
    onLinkUsed: () -> Unit,
    openAgents: Boolean,
    onAgentsOpened: () -> Unit,
) {
    // A back stack of routes; Today is always at the bottom, so Back from the calendar or the board returns to it.
    var stack by rememberSaveable { mutableStateOf(listOf(Route.TODAY)) }
    val route = stack.last()
    val open: (String) -> Unit = { stack = stack + it }
    val back: () -> Unit = { if (stack.size > 1) stack = stack.dropLast(1) }
    val selectTab: (String) -> Unit = { tab -> stack = if (tab == Route.TODAY) listOf(Route.TODAY) else listOf(Route.TODAY, tab) }
    BackHandler(enabled = stack.size > 1, onBack = back)
    val tabs: @Composable () -> Unit = { MainTabs(route, selectTab) }
    var firstRunChecked by rememberSaveable { mutableStateOf(false) }
    // At first start without a server, Connect comes first (once per launch at most).
    LaunchedEffect(Unit) {
        if (firstRunChecked) return@LaunchedEffect
        firstRunChecked = true
        val settings = container.settings.current()
        if (stack == listOf(Route.TODAY) && settings.backend == null && !settings.connectPromptDone) open(Route.FIRST_CONNECT)
    }
    // A pairing link always opens Connect, filled in.
    LaunchedEffect(pairingLink) {
        if (pairingLink != null && route != Route.CONNECT) open(Route.CONNECT)
    }
    LaunchedEffect(openAgents) {
        if (openAgents) {
            if (route != Route.AGENTS) open(Route.AGENTS)
            onAgentsOpened()
        }
    }
    val context = LocalContext.current
    // Asked in context: the first task with a time is the first one that can ring.
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val timeSet: (String?) -> Unit = { dueTime ->
        if (dueTime != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && needsNotificationPermission(context)) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    val taskId = Route.taskId(route)
    when {
        route == Route.TODAY -> {
            val viewModel = viewModel {
                TodayViewModel(container.repository, container.settings, container.network, container.liveSync)
            }
            val actions = remember(viewModel) {
                object : TodayActions by viewModel {
                    override fun openSettings() = open(Route.SETTINGS)
                    override fun openTask(localId: String) = open(Route.task(localId))
                    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) {
                        viewModel.add(title, dueDate, dueTime, note, projectId)
                        timeSet(dueTime)
                    }
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            val healthModel = viewModel { HealthCardViewModel(api = { container.settings.current().backend?.let(container::agentControlApi) }) }
            val health by healthModel.health.collectAsStateWithLifecycle()
            // Read again whenever the tasks change and when Dayhand comes back to the front.
            LaunchedEffect(state?.sections) { healthModel.refresh() }
            LifecycleResumeEffect(Unit) {
                healthModel.refresh()
                onPauseOrDispose {}
            }
            state?.let { TodayScreen(it, actions, bottomBar = tabs, header = { HealthCard(health, onReview = { open(Route.AGENTS) }) }) }
        }
        route == Route.CALENDAR -> {
            val viewModel = viewModel {
                CalendarViewModel(container.repository, container.settings, container.network, container.liveSync)
            }
            val actions = remember(viewModel) {
                object : CalendarActions by viewModel {
                    override fun openSettings() = open(Route.SETTINGS)
                    override fun openTask(localId: String) = open(Route.task(localId))
                    override fun move(localId: String, date: String, time: String?) {
                        viewModel.move(localId, date, time)
                        timeSet(time)
                    }
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.let { CalendarScreen(it, actions, bottomBar = tabs) }
        }
        route == Route.BOARD -> {
            val viewModel = viewModel {
                BoardViewModel(container.repository, container.settings, container.network, container.liveSync)
            }
            val actions = remember(viewModel) {
                object : BoardActions by viewModel {
                    override fun openSettings() = open(Route.SETTINGS)
                    override fun openTask(localId: String) = open(Route.task(localId))
                    override fun openTrash() = open(Route.TRASH)
                    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) {
                        viewModel.add(title, dueDate, dueTime, note, projectId)
                        timeSet(dueTime)
                    }
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.let { BoardScreen(it, actions, bottomBar = tabs) }
        }
        route == Route.PROJECTS -> {
            val model = viewModel(key = "projects-list") { ProjectsViewModel(container.repository, container.settings) }
            val state by model.state.collectAsStateWithLifecycle()
            state?.let { ProjectsScreen(it, { id -> open(Route.project(id)) }, { name -> open(Route.label(name)) },
                onTrash = { open(Route.TRASH) }, onSettings = { open(Route.SETTINGS) }, bottomBar = tabs) }
        }
        route.startsWith(Route.PROJECT) || route.startsWith(Route.LABEL) -> {
            val projectId = route.takeIf { it.startsWith(Route.PROJECT) }?.removePrefix(Route.PROJECT)?.takeUnless { it == "none" }
            val label = route.takeIf { it.startsWith(Route.LABEL) }?.removePrefix(Route.LABEL)?.let(android.net.Uri::decode)
            val model = viewModel(key = "project-screen-$route") { ProjectViewModel(container.repository, container.settings, projectId, label) }
            val state by model.state.collectAsStateWithLifecycle()
            val todayActions = remember(model) { object : TodayActions by model.todayActions {
                override fun openTask(localId: String) = open(Route.task(localId))
                override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) {
                    model.todayActions.add(title, dueDate, dueTime, note, projectId)
                    timeSet(dueTime)
                }
            } }
            val boardActions = remember(model) { object : BoardActions by model.boardActions {
                override fun openTask(localId: String) = open(Route.task(localId))
                override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) =
                    todayActions.add(title, dueDate, dueTime, note, projectId)
            } }
            state?.let { ProjectScreen(it, todayActions, boardActions, onBack = back, bottomBar = { MainTabs(Route.PROJECTS, selectTab) }) }
        }
        taskId != null -> {
            val viewModel = viewModel { TaskDetailViewModel(container.repository, container.settings, container.historySync) }
            LaunchedEffect(taskId) { viewModel.open(taskId) }
            val actions = remember(viewModel) {
                object : TaskDetailActions by viewModel {
                    override fun back() = back()
                    override fun setDue(localId: String, date: String?, time: String?) {
                        viewModel.setDue(localId, date, time)
                        timeSet(time)
                    }
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.takeIf { it.localId() == taskId }?.let { TaskDetailScreen(it, actions) }
        }
        route == Route.TRASH -> {
            val viewModel = viewModel { TrashViewModel(container.repository, container.settings) }
            val actions = remember(viewModel) {
                object : TrashActions by viewModel {
                    override fun openTask(localId: String) = open(Route.task(localId))
                    override fun back() = back()
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.let { TrashScreen(it, actions) }
        }
        route == Route.SETTINGS -> SettingsRoute(
            container,
            versionName,
            onBack = back,
            onConnect = { open(Route.CONNECT) },
        )
        route == Route.AGENTS -> AgentsRoute(container, onBack = back)
        route == Route.CONNECT || route == Route.FIRST_CONNECT -> ConnectRoute(
            container,
            link = pairingLink,
            firstRun = route == Route.FIRST_CONNECT,
            onDone = {
                onLinkUsed()
                stack = listOf(Route.TODAY)
            },
        )
    }
}

private fun TaskDetailUiState.localId(): String = when (this) {
    is TaskDetailUiState.Missing -> localId
    is TaskDetailUiState.Ready -> task.localId
}

/** Bottom navigation between the main views. */
@Composable
private fun MainTabs(current: String, onSelect: (String) -> Unit) {
    HelmTabBar {
        Tab(Route.TODAY, current, Icons.Filled.Home, R.string.today_title, onSelect)
        Tab(Route.CALENDAR, current, Icons.Filled.DateRange, R.string.calendar_title, onSelect)
        Tab(Route.BOARD, current, Icons.AutoMirrored.Filled.List, R.string.board_title, onSelect)
        Tab(Route.PROJECTS, current, ProjectFolderIcon, R.string.projects_title, onSelect)
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Tab(
    route: String,
    current: String,
    icon: ImageVector,
    @StringRes label: Int,
    onSelect: (String) -> Unit,
) {
    HelmTab(selected = current == route, icon = icon, label = stringResource(label), onClick = { if (current != route) onSelect(route) })
}
