package dev.helm.planner.ui.connect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.AppContainer
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.auth.ConnectOutcome
import dev.helm.planner.auth.DevicePairing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface ConnectPhase {
    data object Idle : ConnectPhase
    data object Working : ConnectPhase
    data object Connected : ConnectPhase
    data class Failed(val error: ConnectError, val retryAfterSeconds: Long? = null) : ConnectPhase
}

/**
 * Pairs the phone and, once the server accepted the code, sends the changes made before
 * (they waited in the outbox); the live feed starts by itself for the new sign-in.
 */
class ConnectViewModel(private val container: AppContainer, private val deviceName: String) : ViewModel() {
    private val pairing = DevicePairing(
        api = container.pairingApi,
        isOnline = { container.network.online.first() },
        save = container.settings::saveDevice,
    )
    private val phase = MutableStateFlow<ConnectPhase>(ConnectPhase.Idle)
    val state: StateFlow<ConnectPhase> = phase.asStateFlow()

    fun connect(address: String, code: String) {
        if (phase.value == ConnectPhase.Working) return
        phase.value = ConnectPhase.Working
        viewModelScope.launch {
            phase.value = when (val outcome = pairing.connect(address, code, deviceName)) {
                ConnectOutcome.Connected -> {
                    container.outboxScheduler.restart()
                    ConnectPhase.Connected
                }
                is ConnectOutcome.Failed -> ConnectPhase.Failed(outcome.error, outcome.retryAfterSeconds)
            }
        }
    }

    /**
     * Leaving the screen. The view model lives as long as the activity, so the next visit
     * starts clean instead of closing at once on an old Connected or showing an old error.
     */
    fun reset() {
        if (phase.value != ConnectPhase.Working) phase.value = ConnectPhase.Idle
    }

    /** The user edited a field: an old error no longer describes what is typed. */
    fun edited() {
        if (phase.value is ConnectPhase.Failed) phase.value = ConnectPhase.Idle
    }

    /** Leaving the first-start prompt: it does not open by itself again. */
    fun dismissPrompt() {
        // Outlives this screen, which closes right away.
        container.backgroundScope.launch { container.settings.setConnectPromptDone() }
    }
}
