package dev.helm.planner.ui.connections

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.connections.AgentConnection
import dev.helm.planner.connections.AgentScope
import dev.helm.planner.connections.ConnectionCode
import dev.helm.planner.connections.ConnectionRequest
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.helmSwitchColors
import dev.helm.planner.ui.settings.SettingsPage
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object ConnectionsTags {
    const val PAGE = "connections_page"
    const val APPROVE_ROW = "connections_approve_row"
    const val ITEM = "connections_item_"
    const val STATUS = "connections_status"
    const val DISCONNECT = "connections_disconnect"
    const val APPROVE_PAGE = "approve_page"
    const val CODE = "approve_code"
    const val CONTINUE = "approve_continue"
    const val SCOPE = "approve_scope_"
    const val CONFIRM = "approve_confirm"
    const val REFUSE = "approve_refuse"
    const val OLD_WARNING = "approve_old_warning"
    const val MESSAGE = "approve_message"
}

sealed interface ConnectionsList {
    data object Loading : ConnectionsList
    data class Loaded(val connections: List<AgentConnection>) : ConnectionsList
    data class Failed(val unauthorized: Boolean) : ConnectionsList
}

enum class ApproveError { NOT_FOUND, RATE_LIMITED, FAILED, NOTHING_CHOSEN }

enum class ApproveOutcome { APPROVED, REFUSED, GONE }

/** The approval of a new connection: the code, then the consent, then what happened. */
sealed interface ApproveState {
    data class Entry(val code: String = "", val busy: Boolean = false, val error: ApproveError? = null) : ApproveState
    data class Consent(
        val request: ConnectionRequest,
        /** What the owner allows; starts as what the agent asked for. */
        val scopes: Set<AgentScope> = request.scopes,
        /** The page asked minutes ago: perhaps someone else's page, so the screen warns. */
        val old: Boolean = false,
        val busy: Boolean = false,
        val error: ApproveError? = null,
    ) : ApproveState
    data class Finished(val outcome: ApproveOutcome) : ApproveState
}

data class ConnectionsUiState(
    val list: ConnectionsList = ConnectionsList.Loading,
    /** Non-null while the approval pages are open. */
    val approve: ApproveState? = null,
    val disconnectFailed: Boolean = false,
    /** Formats a time for "last used" (the phone's zone and language). */
    val timeLabel: (Long) -> String = { it.toString() },
)

interface ConnectionsActions {
    fun startApprove() {}
    fun closeApprove() {}
    fun codeChanged(code: String) {}
    fun lookup() {}
    fun setScope(scope: AgentScope, allowed: Boolean) {}
    fun approve() {}
    fun refuse() {}
    fun disconnect(connectionId: String) {}
}

/**
 * Settings → Agent connections (docs/oauth.md): approve a new connection by the code its sign-in page shows, and see
 * and disconnect the connected agents. Calm rows like the rest of Settings; Back closes the approval first.
 */
@Composable
fun ConnectionsScreen(state: ConnectionsUiState, actions: ConnectionsActions, onBack: () -> Unit) {
    val approve = state.approve
    if (approve != null) {
        BackHandler(onBack = actions::closeApprove)
        ApprovePage(approve, state.timeLabel, actions)
        return
    }
    var confirming by rememberSaveable { mutableStateOf<String?>(null) }
    SettingsPage(stringResource(R.string.connections_title), onBack, ConnectionsTags.PAGE) {
        ListGroup(
            null,
            rows = listOf {
                ListRow(
                    stringResource(R.string.connections_approve_row),
                    ConnectionsTags.APPROVE_ROW,
                    icon = LineIcon.Check,
                    note = stringResource(R.string.connections_approve_note),
                    onClick = actions::startApprove,
                )
            },
        )
        ConnectionList(state, onSelect = { confirming = it })
        if (state.disconnectFailed) ListNote(stringResource(R.string.connections_disconnect_failed))
        ListNote(stringResource(R.string.connections_hint))
    }
    val chosen = (state.list as? ConnectionsList.Loaded)?.connections?.firstOrNull { it.id == confirming }
    if (chosen != null) {
        HelmDialog(
            title = stringResource(R.string.connections_disconnect_title, chosen.clientName),
            onDismiss = { confirming = null },
            confirm = stringResource(R.string.connections_disconnect),
            onConfirm = {
                confirming = null
                actions.disconnect(chosen.id)
            },
            dismiss = stringResource(android.R.string.cancel),
            destructive = true,
            confirmTag = ConnectionsTags.DISCONNECT,
        ) { Text(stringResource(R.string.connections_disconnect_text), style = helmType.body, color = palette.textMuted) }
    }
}

@Composable
private fun ConnectionList(state: ConnectionsUiState, onSelect: (String) -> Unit) {
    when (val list = state.list) {
        ConnectionsList.Loading -> ListGroup(
            null,
            rows = listOf {
                ListRow(
                    stringResource(R.string.connections_loading),
                    ConnectionsTags.STATUS,
                    trailing = { CircularProgressIndicator(color = palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp)) },
                )
            },
        )
        is ConnectionsList.Failed -> ListGroup(
            null,
            rows = listOf {
                val text = if (list.unauthorized) R.string.connections_unauthorized else R.string.connections_failed
                ListRow(stringResource(text), ConnectionsTags.STATUS, icon = LineIcon.Warning)
            },
        )
        is ConnectionsList.Loaded -> {
            val active = list.connections.filter { it.active }
            if (active.isEmpty()) {
                ListNote(stringResource(R.string.connections_none), Modifier.testTag(ConnectionsTags.STATUS))
            } else {
                ListGroup(
                    stringResource(R.string.connections_active),
                    rows = active.map { connection -> { ConnectionRow(connection, state.timeLabel) { onSelect(connection.id) } } },
                )
            }
        }
    }
}

@Composable
private fun ConnectionRow(connection: AgentConnection, timeLabel: (Long) -> String, onClick: () -> Unit) {
    val origin = connection.clientHost?.let { stringResource(R.string.connections_from, it) }
        ?: stringResource(R.string.connections_registered, connection.redirectHost)
    val access = stringResource(if (AgentScope.WRITE in connection.scopes) R.string.connections_read_write else R.string.connections_read_only)
    val used = connection.lastUsedAt?.let { stringResource(R.string.connections_last_used, timeLabel(it)) }
        ?: stringResource(R.string.connections_never_used)
    ListRow(
        connection.clientName,
        ConnectionsTags.ITEM + connection.id,
        icon = LineIcon.Link,
        note = "$origin · $access · $used",
        clickLabel = stringResource(R.string.connections_disconnect),
        chevron = false,
        onClick = onClick,
    )
}

@Composable
private fun ApprovePage(state: ApproveState, timeLabel: (Long) -> String, actions: ConnectionsActions) {
    SettingsPage(stringResource(R.string.approve_title), actions::closeApprove, ConnectionsTags.APPROVE_PAGE) {
        when (state) {
            is ApproveState.Entry -> CodeEntry(state, actions)
            is ApproveState.Consent -> Consent(state, timeLabel, actions)
            is ApproveState.Finished -> Finished(state.outcome, actions)
        }
    }
}

@Composable
private fun CodeEntry(state: ApproveState.Entry, actions: ConnectionsActions) {
    val ready = ConnectionCode.normalize(state.code) != null && !state.busy
    HelmTextField(
        value = state.code,
        onValueChange = actions::codeChanged,
        modifier = Modifier.testTag(ConnectionsTags.CODE),
        label = stringResource(R.string.approve_code_label),
        placeholder = "K7QF-M2XA",
        singleLine = true,
        isError = state.error != null,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Characters,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii,
            imeAction = ImeAction.Go,
        ),
        keyboardActions = KeyboardActions(onGo = { if (ready) actions.lookup() }),
    )
    ListNote(stringResource(R.string.approve_code_hint))
    ListGroup(
        null,
        rows = buildList<@Composable () -> Unit> {
            state.error?.let { add { Message(errorText(it), LineIcon.Warning) } }
            if (state.busy) add { Message(stringResource(R.string.approve_checking), null, busy = true) }
            add {
                ListRow(
                    stringResource(R.string.approve_continue),
                    ConnectionsTags.CONTINUE,
                    titleColor = palette.accent,
                    enabled = ready,
                    onClick = actions::lookup,
                )
            }
        },
    )
}

@Composable
private fun Consent(state: ApproveState.Consent, timeLabel: (Long) -> String, actions: ConnectionsActions) {
    val request = state.request
    Text(
        stringResource(R.string.approve_asks, request.clientName),
        style = helmType.title,
        color = palette.text,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    ListGroup(
        null,
        rows = buildList<@Composable () -> Unit> {
            add {
                val who = request.clientHost?.let { stringResource(R.string.approve_client_verified, it) }
                    ?: stringResource(R.string.approve_client_registered)
                ListRow(who, "approve_client", icon = LineIcon.Globe)
            }
            add { ListRow(stringResource(R.string.approve_returns_to, request.redirectHost), "approve_redirect", icon = LineIcon.Link) }
            add { ListRow(stringResource(R.string.approve_asked_at, timeLabel(request.createdAt)), "approve_asked", icon = LineIcon.Clock) }
            if (state.old) {
                add { ListRow(stringResource(R.string.approve_old_warning), ConnectionsTags.OLD_WARNING, icon = LineIcon.Warning, titleColor = palette.danger) }
            }
            if (request.loopback) {
                add { ListRow(stringResource(R.string.approve_loopback_warning), "approve_loopback", icon = LineIcon.Warning, titleColor = palette.danger) }
            }
        },
    )
    ListGroup(
        stringResource(R.string.approve_allow),
        rows = AgentScope.entries.filter { it in request.scopes }.map { scope ->
            { ScopeRow(scope, scope in state.scopes, enabled = !state.busy) { actions.setScope(scope, it) } }
        },
    )
    ListGroup(
        null,
        rows = buildList<@Composable () -> Unit> {
            state.error?.let { add { Message(errorText(it), LineIcon.Warning) } }
            add {
                ListRow(
                    stringResource(R.string.approve_confirm),
                    ConnectionsTags.CONFIRM,
                    icon = LineIcon.Check,
                    titleColor = palette.accent,
                    enabled = !state.busy && state.scopes.isNotEmpty(),
                    chevron = false,
                    onClick = actions::approve,
                )
            }
            add {
                ListRow(
                    stringResource(R.string.approve_refuse),
                    ConnectionsTags.REFUSE,
                    icon = LineIcon.Unlink,
                    titleColor = palette.danger,
                    enabled = !state.busy,
                    chevron = false,
                    onClick = actions::refuse,
                )
            }
        },
    )
}

/** One scope with a switch; the whole row toggles it and a screen reader hears one switch. */
@Composable
private fun ScopeRow(scope: AgentScope, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val title = stringResource(if (scope == AgentScope.READ) R.string.approve_scope_read else R.string.approve_scope_write)
    ListRow(
        title,
        ConnectionsTags.SCOPE + scope.name.lowercase(),
        modifier = Modifier.toggleable(checked, interaction, null, enabled = enabled, role = Role.Switch, onValueChange = onChange),
        note = if (scope == AgentScope.WRITE) stringResource(R.string.approve_scope_write_note) else null,
        enabled = enabled,
        trailing = { Switch(checked = checked, onCheckedChange = null, enabled = enabled, interactionSource = interaction, colors = helmSwitchColors()) },
    )
}

@Composable
private fun Finished(outcome: ApproveOutcome, actions: ConnectionsActions) {
    val text = when (outcome) {
        ApproveOutcome.APPROVED -> R.string.approve_done
        ApproveOutcome.REFUSED -> R.string.approve_refused
        ApproveOutcome.GONE -> R.string.approve_gone
    }
    ListGroup(
        null,
        rows = listOf(
            { Message(stringResource(text), if (outcome == ApproveOutcome.APPROVED) LineIcon.Check else LineIcon.Info) },
            { ListRow(stringResource(R.string.connections_title), "approve_back", titleColor = palette.accent, onClick = actions::closeApprove) },
        ),
    )
}

/** A status line in a group, read out when it appears. */
@Composable
private fun Message(text: String, icon: LineIcon?, busy: Boolean = false) {
    ListRow(
        text,
        ConnectionsTags.MESSAGE,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        icon = icon,
        trailing = if (busy) {
            { CircularProgressIndicator(color = palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp)) }
        } else {
            null
        },
    )
}

@Composable
private fun errorText(error: ApproveError): String = stringResource(
    when (error) {
        ApproveError.NOT_FOUND -> R.string.approve_not_found
        ApproveError.RATE_LIMITED -> R.string.approve_rate_limited
        ApproveError.FAILED -> R.string.approve_failed
        ApproveError.NOTHING_CHOSEN -> R.string.approve_nothing_chosen
    },
)
