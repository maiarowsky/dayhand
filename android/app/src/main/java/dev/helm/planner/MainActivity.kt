package dev.helm.planner

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.auth.PairingInput
import dev.helm.planner.auth.PairingLink
import dev.helm.planner.ui.connect.ConnectRoute
import dev.helm.planner.ui.settings.SettingsRoute
import dev.helm.planner.ui.settings.needsNotificationPermission
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayViewModel

class MainActivity : ComponentActivity() {
    /** A `helm://pair` link (QR code from `hlm pair`) waiting to fill in the Connect screen. */
    private var pairingLink by mutableStateOf<PairingLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as HelmApplication).container
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        if (savedInstanceState == null) pairingLink = linkOf(intent)
        setContent {
            HelmTheme { HelmRoot(container, versionName, pairingLink, onLinkUsed = { pairingLink = null }) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        linkOf(intent)?.let { pairingLink = it }
    }

    private fun linkOf(intent: Intent?): PairingLink? =
        intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString?.let(PairingInput::parseLink)
}

private enum class Screen { TODAY, SETTINGS, CONNECT, FIRST_CONNECT }

@Composable
private fun HelmRoot(
    container: AppContainer,
    versionName: String,
    pairingLink: PairingLink?,
    onLinkUsed: () -> Unit,
) {
    var screen by rememberSaveable { mutableStateOf(Screen.TODAY) }
    var firstRunChecked by rememberSaveable { mutableStateOf(false) }
    // At first start without a server, Connect comes first (once per launch at most).
    LaunchedEffect(Unit) {
        if (firstRunChecked) return@LaunchedEffect
        firstRunChecked = true
        val settings = container.settings.current()
        if (screen == Screen.TODAY && settings.backend == null && !settings.connectPromptDone) screen = Screen.FIRST_CONNECT
    }
    // A pairing link always opens Connect, filled in.
    LaunchedEffect(pairingLink) {
        if (pairingLink != null) screen = Screen.CONNECT
    }
    val context = LocalContext.current
    // Asked in context: the first task with a time is the first one that can ring.
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    when (screen) {
        Screen.TODAY -> {
            val viewModel = viewModel {
                TodayViewModel(container.repository, container.settings, container.network, container.liveSync)
            }
            val actions = remember(viewModel) {
                object : TodayActions by viewModel {
                    override fun openSettings() {
                        screen = Screen.SETTINGS
                    }

                    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?) {
                        viewModel.add(title, dueDate, dueTime, note)
                        if (dueTime != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                            needsNotificationPermission(context)
                        ) {
                            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    }
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.let { TodayScreen(it, actions) }
        }
        Screen.SETTINGS -> SettingsRoute(
            container,
            versionName,
            onBack = { screen = Screen.TODAY },
            onConnect = { screen = Screen.CONNECT },
        )
        Screen.CONNECT, Screen.FIRST_CONNECT -> ConnectRoute(
            container,
            link = pairingLink,
            firstRun = screen == Screen.FIRST_CONNECT,
            onDone = {
                onLinkUsed()
                screen = Screen.TODAY
            },
        )
    }
}
