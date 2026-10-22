package dev.helm.planner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.ui.settings.SettingsScreen
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as HelmApplication).container
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            HelmTheme { HelmRoot(container, versionName) }
        }
    }
}

private enum class Screen { TODAY, SETTINGS }

@Composable
private fun HelmRoot(container: AppContainer, versionName: String) {
    var screen by rememberSaveable { mutableStateOf(Screen.TODAY) }
    val scope = rememberCoroutineScope()
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
                }
            }
            val state by viewModel.state.collectAsStateWithLifecycle()
            state?.let { TodayScreen(it, actions) }
        }
        Screen.SETTINGS -> {
            BackHandler { screen = Screen.TODAY }
            val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
            settings?.let { current ->
                SettingsScreen(
                    settings = current,
                    versionName = versionName,
                    onSave = { url, token ->
                        scope.launch {
                            container.settings.saveBackend(url, token)
                            container.outboxScheduler.restart()
                        }
                    },
                    onOfflineMode = { enabled ->
                        scope.launch {
                            container.settings.setOfflineMode(enabled)
                            if (!enabled) container.outboxScheduler.restart()
                        }
                    },
                    onBack = { screen = Screen.TODAY },
                )
            }
        }
    }
}
