package dev.helm.planner

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.ui.settings.FontScreen
import dev.helm.planner.ui.settings.LicensesScreen
import dev.helm.planner.ui.settings.PaletteScreen
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
            HelmTheme(appearance, systemDark) { HelmRoot(container, versionName) }
        }
    }
}

private enum class Screen { TODAY, SETTINGS, COLORS, FONT, LICENSES }

@Composable
private fun HelmRoot(container: AppContainer, versionName: String) {
    var screen by rememberSaveable { mutableStateOf(Screen.TODAY) }
    val scope = rememberCoroutineScope()
    val appearance by container.appearance.appearance.collectAsStateWithLifecycle()
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
                    appearance = appearance,
                    onAppearance = container.appearance::save,
                    onOpenColors = { screen = Screen.COLORS },
                    onOpenFont = { screen = Screen.FONT },
                    onOpenLicenses = { screen = Screen.LICENSES },
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
        Screen.COLORS -> {
            BackHandler { screen = Screen.SETTINGS }
            PaletteScreen(appearance, container.appearance::save, onBack = { screen = Screen.SETTINGS })
        }
        Screen.FONT -> {
            BackHandler { screen = Screen.SETTINGS }
            FontScreen(appearance, container.appearance::save, onBack = { screen = Screen.SETTINGS })
        }
        Screen.LICENSES -> {
            BackHandler { screen = Screen.SETTINGS }
            LicensesScreen(onBack = { screen = Screen.SETTINGS })
        }
    }
}
