package dev.helm.planner.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import dev.helm.planner.R
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.connect.DisconnectDialog
import dev.helm.planner.ui.connect.serverRows
import dev.helm.planner.ui.today.ConnectionStatus

/**
 * The Server page. On this phone only: that it is so, Connect, and how a server of one's own is set up. Connected:
 * the connection state, the paired server with Disconnect. Then the time zone: the phone's without a server, the
 * server's with one (and, when they differ, a row that sets the server's to the phone's).
 */
@Composable
internal fun ServerOptions(data: SettingsData, actions: SettingsActions) {
    val settings = data.settings
    var confirming by rememberSaveable { mutableStateOf(false) }
    val rows = buildList<@Composable () -> Unit> {
        // On its own the phone has no connection to describe, only changes that wait for the server it had.
        if (!settings.isLocal || settings.pairingLost) add { ConnectionRow(data.connection, data.pendingChanges) }
        addAll(serverRows(settings, onConnect = actions::openConnect, onDisconnect = { confirming = true }))
    }
    ListGroup(null, rows)
    if (settings.isLocal) ListNote(stringResource(R.string.server_local_how))
    val zoneRows = buildList<@Composable () -> Unit> {
        add {
            ListRow(
                stringResource(R.string.settings_timezone_title),
                tag = SettingsTags.TIMEZONE,
                icon = LineIcon.Globe,
                note = stringResource(
                    if (settings.isLocal) R.string.settings_timezone_phone else R.string.settings_timezone,
                    settings.timezone,
                ),
            )
        }
        if (!settings.isLocal && settings.timezone != settings.phoneTimezone) {
            add {
                ListRow(
                    stringResource(R.string.settings_timezone_use_phone, settings.phoneTimezone),
                    tag = SettingsTags.USE_PHONE_TIMEZONE,
                    icon = LineIcon.Refresh,
                    titleColor = palette.accent,
                    note = stringResource(R.string.settings_timezone_differs),
                    onClick = actions::usePhoneTimezone,
                    chevron = false,
                )
            }
        }
    }
    ListGroup(null, zoneRows)
    if (confirming) {
        DisconnectDialog(settings, onDismiss = { confirming = false }, onConfirm = {
            confirming = false
            actions.disconnect()
        })
    }
}

/** The connection state in words, with the changes still waiting, read out when it changes. */
@Composable
private fun ConnectionRow(connection: ConnectionStatus, pending: Int) {
    val icon = when (connection) {
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING -> LineIcon.Cloud
        ConnectionStatus.OFFLINE, ConnectionStatus.LOCAL -> LineIcon.CloudOff
        ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> LineIcon.Warning
    }
    ListRow(
        stringResource(R.string.connection_label, stringResource(connectionText(connection))),
        tag = SettingsTags.CONNECTION,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        icon = icon,
        note = if (pending > 0) pluralStringResource(R.plurals.connection_pending, pending, pending) else null,
    )
}

internal fun connectionText(connection: ConnectionStatus): Int = when (connection) {
    ConnectionStatus.SYNCED -> R.string.connection_synced
    ConnectionStatus.CONNECTING -> R.string.connection_connecting
    ConnectionStatus.OFFLINE -> R.string.connection_offline
    ConnectionStatus.LOCAL -> R.string.connection_local
    ConnectionStatus.UNAUTHORIZED -> R.string.connection_unauthorized
    ConnectionStatus.ERROR -> R.string.connection_error
}
