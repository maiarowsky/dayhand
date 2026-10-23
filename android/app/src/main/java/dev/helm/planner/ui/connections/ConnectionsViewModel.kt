package dev.helm.planner.ui.connections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.AppContainer
import dev.helm.planner.connections.AgentConnectionsApi
import dev.helm.planner.connections.AgentScope
import dev.helm.planner.connections.ConnectionCode
import dev.helm.planner.connections.ConnectionsLoad
import dev.helm.planner.connections.Decision
import dev.helm.planner.connections.Lookup
import dev.helm.planner.ui.common.appLocale
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The connections page and the approval of a new connection. Nothing is cached: the list is read when the page opens
 * and after every change. [api] is null while the phone is not paired.
 */
class ConnectionsViewModel(
    private val api: suspend () -> AgentConnectionsApi?,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val state = MutableStateFlow(ConnectionsUiState())
    val ui: StateFlow<ConnectionsUiState> = state.asStateFlow()

    init {
        reload()
    }

    fun reload() = launch {
        val remote = api() ?: return@launch state.update { it.copy(list = ConnectionsList.Failed(unauthorized = true)) }
        val list = when (val load = remote.list()) {
            is ConnectionsLoad.Loaded -> ConnectionsList.Loaded(load.connections)
            ConnectionsLoad.Unauthorized -> ConnectionsList.Failed(unauthorized = true)
            is ConnectionsLoad.Failed -> ConnectionsList.Failed(unauthorized = false)
        }
        state.update { it.copy(list = list) }
    }

    fun startApprove() = state.update { it.copy(approve = ApproveState.Entry()) }

    fun closeApprove() {
        state.update { it.copy(approve = null) }
        reload()
    }

    fun codeChanged(code: String) = state.update { current ->
        val entry = current.approve as? ApproveState.Entry ?: return@update current
        current.copy(approve = entry.copy(code = code.take(MAX_CODE_INPUT), error = null))
    }

    fun lookup() = launch {
        val entry = state.value.approve as? ApproveState.Entry ?: return@launch
        val code = ConnectionCode.normalize(entry.code) ?: return@launch
        if (entry.busy) return@launch
        setApprove(entry.copy(busy = true, error = null))
        val remote = api() ?: return@launch setApprove(entry.copy(busy = false, error = ApproveError.FAILED))
        setApprove(
            when (val found = remote.lookup(code)) {
                is Lookup.Found -> ApproveState.Consent(found.request, old = now() - found.request.createdAt > OLD_REQUEST_MS)
                Lookup.NotFound -> entry.copy(busy = false, error = ApproveError.NOT_FOUND)
                is Lookup.RateLimited -> entry.copy(busy = false, error = ApproveError.RATE_LIMITED)
                Lookup.Unauthorized, is Lookup.Failed -> entry.copy(busy = false, error = ApproveError.FAILED)
            },
        )
    }

    fun setScope(scope: AgentScope, allowed: Boolean) = state.update { current ->
        val consent = current.approve as? ApproveState.Consent ?: return@update current
        val scopes = if (allowed) consent.scopes + scope else consent.scopes - scope
        current.copy(approve = consent.copy(scopes = scopes, error = null))
    }

    fun approve() = decide(approve = true)

    fun refuse() = decide(approve = false)

    private fun decide(approve: Boolean) = launch {
        val consent = state.value.approve as? ApproveState.Consent ?: return@launch
        if (consent.busy) return@launch
        if (approve && consent.scopes.isEmpty()) return@launch setApprove(consent.copy(error = ApproveError.NOTHING_CHOSEN))
        setApprove(consent.copy(busy = true, error = null))
        val remote = api() ?: return@launch setApprove(consent.copy(busy = false, error = ApproveError.FAILED))
        setApprove(
            when (remote.decide(consent.request.code, approve, consent.scopes)) {
                is Decision.Approved -> ApproveState.Finished(ApproveOutcome.APPROVED)
                Decision.Denied -> ApproveState.Finished(ApproveOutcome.REFUSED)
                Decision.Gone -> ApproveState.Finished(ApproveOutcome.GONE)
                is Decision.RateLimited -> consent.copy(busy = false, error = ApproveError.RATE_LIMITED)
                Decision.Unauthorized, is Decision.Failed -> consent.copy(busy = false, error = ApproveError.FAILED)
            },
        )
    }

    fun disconnect(connectionId: String) = launch {
        val revoked = api()?.revoke(connectionId) == true
        state.update { it.copy(disconnectFailed = !revoked) }
        reload()
    }

    private fun setApprove(approve: ApproveState) = state.update { it.copy(approve = approve) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val MAX_CODE_INPUT = 20

        /** A sign-in page the owner opened themselves is a minute or two old when its code is typed. */
        const val OLD_REQUEST_MS = 3 * 60 * 1000L
    }
}

/** Settings → Agent connections, signed in as the paired owner. */
@Composable
fun ConnectionsRoute(container: AppContainer, onBack: () -> Unit) {
    val viewModel = viewModel {
        ConnectionsViewModel(api = {
            val settings = container.settings.current()
            settings.backend?.let(container::connectionsApi)
        })
    }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val locale = appLocale()
    val format = remember(locale) { DateTimeFormatter.ofPattern("d MMM HH:mm", locale).withZone(ZoneId.systemDefault()) }
    val actions = remember(viewModel) {
        object : ConnectionsActions {
            override fun startApprove() = viewModel.startApprove()
            override fun closeApprove() = viewModel.closeApprove()
            override fun codeChanged(code: String) = viewModel.codeChanged(code)
            override fun lookup() = viewModel.lookup()
            override fun setScope(scope: AgentScope, allowed: Boolean) = viewModel.setScope(scope, allowed)
            override fun approve() = viewModel.approve()
            override fun refuse() = viewModel.refuse()
            override fun disconnect(connectionId: String) = viewModel.disconnect(connectionId)
        }
    }
    ConnectionsScreen(ui.copy(timeLabel = { format.format(Instant.ofEpochMilli(it)) }), actions, onBack)
}
