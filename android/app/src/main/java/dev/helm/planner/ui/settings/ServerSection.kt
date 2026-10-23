package dev.helm.planner.ui.settings

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import dev.helm.planner.R
import dev.helm.planner.ui.components.IconTone
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.helmSwitchColors
import dev.helm.planner.ui.connect.DisconnectDialog
import dev.helm.planner.ui.connect.serverRows
import dev.helm.planner.ui.today.ConnectionStatus

/** Connection status, the paired server with Connect / Disconnect, the offline test switch and the time zone. */
@Composable
internal fun ServerSection(data: SettingsData, actions: SettingsActions) {
    val settings = data.settings
    var confirming by rememberSaveable { mutableStateOf(false) }
    val rows = buildList<@Composable () -> Unit> {
        add { ConnectionRow(data.connection, data.pendingChanges) }
        addAll(serverRows(settings, onConnect = actions::openConnect, onDisconnect = { confirming = true }))
        add { OfflineRow(settings.offlineMode, actions::setOfflineMode) }
        add {
            ListRow(
                stringResource(R.string.settings_timezone_title),
                tag = SettingsTags.TIMEZONE,
                icon = SettingsIcons.Public,
                tone = IconTone.Neutral,
                subtitle = stringResource(R.string.settings_timezone, settings.timezone),
            )
        }
    }
    ListGroup(stringResource(R.string.settings_backend), rows)
    if (confirming) {
        DisconnectDialog(settings, onDismiss = { confirming = false }, onConfirm = {
            confirming = false
            actions.disconnect()
        })
    }
}

/** The connection state as the row's icon colour and its words, read out when it changes. */
@Composable
private fun ConnectionRow(connection: ConnectionStatus, pending: Int) {
    val (icon, tone) = when (connection) {
        ConnectionStatus.SYNCED -> SettingsIcons.CloudDone to IconTone.Success
        ConnectionStatus.CONNECTING -> SettingsIcons.Cloud to IconTone.Accent
        ConnectionStatus.OFFLINE, ConnectionStatus.OFFLINE_MODE -> SettingsIcons.CloudOff to IconTone.Warning
        ConnectionStatus.NOT_CONFIGURED -> SettingsIcons.CloudOff to IconTone.Neutral
        ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> Icons.Filled.Warning to IconTone.Danger
    }
    ListRow(
        stringResource(R.string.connection_label, stringResource(connectionText(connection))),
        tag = SettingsTags.CONNECTION,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        icon = icon,
        tone = tone,
        subtitle = if (pending > 0) pluralStringResource(R.plurals.connection_pending, pending, pending) else null,
    )
}

/** The offline test switch: the whole row toggles it and a screen reader hears one switch; only the switch shows the press. */
@Composable
private fun OfflineRow(checked: Boolean, onChange: (Boolean) -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    ListRow(
        stringResource(R.string.settings_offline),
        tag = SettingsTags.OFFLINE,
        modifier = Modifier.toggleable(
            value = checked,
            interactionSource = interaction,
            indication = null,
            role = Role.Switch,
            onValueChange = onChange,
        ),
        icon = SettingsIcons.CloudOff,
        tone = IconTone.Neutral,
        subtitle = stringResource(R.string.settings_offline_hint),
        trailing = {
            Switch(
                checked = checked,
                onCheckedChange = null,
                interactionSource = interaction,
                colors = helmSwitchColors(),
            )
        },
    )
}

private fun connectionText(connection: ConnectionStatus): Int = when (connection) {
    ConnectionStatus.SYNCED -> R.string.connection_synced
    ConnectionStatus.CONNECTING -> R.string.connection_connecting
    ConnectionStatus.OFFLINE -> R.string.connection_offline
    ConnectionStatus.OFFLINE_MODE -> R.string.connection_offline_mode
    ConnectionStatus.NOT_CONFIGURED -> R.string.connection_not_configured
    ConnectionStatus.UNAUTHORIZED -> R.string.connection_unauthorized
    ConnectionStatus.ERROR -> R.string.connection_error
}
