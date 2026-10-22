package dev.helm.planner.ui.connect

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.AppContainer
import dev.helm.planner.BuildConfig
import dev.helm.planner.auth.PairingLink

/**
 * The Connect screen with its data: the address comes from a pairing link, else the server
 * used last, else the built-in default (`BuildConfig.DEFAULT_SERVER_URL`).
 */
@Composable
fun ConnectRoute(container: AppContainer, link: PairingLink?, firstRun: Boolean, onDone: () -> Unit) {
    val viewModel = viewModel { ConnectViewModel(container, deviceName = Build.MODEL.orEmpty()) }
    val phase by viewModel.state.collectAsStateWithLifecycle()
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val close = {
        if (firstRun) viewModel.dismissPrompt()
        viewModel.reset()
        onDone()
    }
    BackHandler(onBack = close)
    LaunchedEffect(phase) {
        if (phase == ConnectPhase.Connected) {
            viewModel.reset()
            onDone()
        }
    }
    val actions = remember(viewModel) {
        object : ConnectActions {
            override fun connect(address: String, code: String) = viewModel.connect(address, code)
            override fun edited() = viewModel.edited()
            override fun close() = close()
        }
    }
    val s = settings ?: return
    ConnectScreen(
        ConnectUiState(
            address = link?.serverUrl ?: s.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL,
            code = link?.code.orEmpty(),
            phase = phase,
            firstRun = firstRun,
            signedOut = s.pairingLost,
        ),
        actions,
    )
}
