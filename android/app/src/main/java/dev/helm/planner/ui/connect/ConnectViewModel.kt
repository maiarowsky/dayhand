package dev.helm.planner.ui.connect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.AppContainer
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.auth.ConnectOutcome
import dev.helm.planner.auth.DevicePairing
import dev.helm.planner.auth.PlanReplace
import dev.helm.planner.auth.PlanSwitch
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.sample.SamplePlan
import dev.helm.planner.sample.SampleText
import java.time.LocalDate
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

    /** The code is for another server than the one whose plan is on the phone: asked before the code is used. */
    data class ConfirmReplace(val replace: PlanReplace) : ConnectPhase
}

/**
 * Pairs the phone and, once the server accepted the code, sends the changes made before
 * (they waited in the outbox); the live feed starts by itself for the new sign-in. Sample tasks
 * stay behind, and the plan of another server ([PlanSwitch]) is removed first, so neither reaches
 * the new server.
 */
class ConnectViewModel(
    private val container: AppContainer,
    private val deviceName: String,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    /** Set while pairing after the user agreed to replace the plan on the phone. */
    private var replacing = false
    private var waiting: Pair<String, String>? = null
    private val pairing = DevicePairing(
        api = container.pairingApi,
        isOnline = { container.network.online.first() },
        save = { convexUrl, device ->
            // Before the sign-in is stored, so neither the outbox nor the live feed can see what goes.
            container.repository.removeSample()
            if (replacing) container.repository.clearAll()
            container.settings.saveDevice(convexUrl, device)
        },
    )
    private val phase = MutableStateFlow<ConnectPhase>(ConnectPhase.Idle)
    val state: StateFlow<ConnectPhase> = phase.asStateFlow()

    fun connect(address: String, code: String) {
        if (phase.value == ConnectPhase.Working) return
        phase.value = ConnectPhase.Working
        viewModelScope.launch {
            val (tasks, pending) = container.repository.planSize()
            val replace = PlanSwitch.check(container.settings.current().serverUrl, address, tasks, pending)
            if (replace == null) {
                pair(address, code, replacePlan = false)
            } else {
                waiting = address to code
                phase.value = ConnectPhase.ConfirmReplace(replace)
            }
        }
    }

    /** The user agreed to replace the plan on the phone with the new server's. */
    fun confirmReplace() {
        val (address, code) = waiting ?: return
        waiting = null
        phase.value = ConnectPhase.Working
        viewModelScope.launch { pair(address, code, replacePlan = true) }
    }

    fun cancelReplace() {
        waiting = null
        phase.value = ConnectPhase.Idle
    }

    private suspend fun pair(address: String, code: String, replacePlan: Boolean) {
        replacing = replacePlan
        phase.value = when (val outcome = pairing.connect(address, code, deviceName)) {
            ConnectOutcome.Connected -> {
                container.outboxScheduler.restart()
                ConnectPhase.Connected
            }
            is ConnectOutcome.Failed -> ConnectPhase.Failed(outcome.error, outcome.retryAfterSeconds)
        }
        replacing = false
    }

    /**
     * Helm on this phone only, empty or with the sample plan in the app's language ([text]). Outlives this screen,
     * which closes right away.
     */
    fun useLocally(sample: Boolean, text: (SampleText) -> String) {
        container.backgroundScope.launch {
            container.settings.setConnectPromptDone()
            if (!sample) return@launch
            val timezone = container.settings.current().timezone
            val now = clock()
            val today = LocalDate.parse(HelmDates.localDate(now, timezone))
            container.repository.loadSample(SamplePlan.tasks(today, now, HelmDates.zone(timezone), text))
        }
    }

    /**
     * Leaving the screen. The view model lives as long as the activity, so the next visit
     * starts clean instead of closing at once on an old Connected or showing an old error.
     */
    fun reset() {
        if (phase.value != ConnectPhase.Working) phase.value = ConnectPhase.Idle
        waiting = null
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
