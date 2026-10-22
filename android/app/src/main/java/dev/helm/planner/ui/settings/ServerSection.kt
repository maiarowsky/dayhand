package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.connect.ServerConnectionPanel
import dev.helm.planner.ui.today.ConnectionStatus

/** Connection status, the paired server with Connect / Disconnect, offline test switch. */
@Composable
internal fun ServerSection(data: SettingsData, actions: SettingsActions) {
    val settings = data.settings
    SectionHeader(stringResource(R.string.settings_backend))
    ConnectionLine(data.connection, data.pendingChanges)
    ServerConnectionPanel(settings, onConnect = actions::openConnect, onDisconnect = actions::disconnect)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .toggleable(value = settings.offlineMode, role = Role.Switch, onValueChange = actions::setOfflineMode)
            .testTag(SettingsTags.OFFLINE),
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(stringResource(R.string.settings_offline), style = MaterialTheme.typography.bodyLarge)
            Hint(stringResource(R.string.settings_offline_hint))
        }
        Switch(checked = settings.offlineMode, onCheckedChange = null)
    }
    Hint(stringResource(R.string.settings_timezone, settings.timezone))
}

@Composable
private fun ConnectionLine(connection: ConnectionStatus, pending: Int) {
    val ok = connection == ConnectionStatus.SYNCED
    val trouble = connection == ConnectionStatus.UNAUTHORIZED || connection == ConnectionStatus.ERROR
    Column(
        Modifier
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .testTag(SettingsTags.CONNECTION),
    ) {
        Text(
            stringResource(R.string.connection_label, stringResource(connectionText(connection))),
            style = MaterialTheme.typography.bodyLarge,
            color = when {
                ok -> MaterialTheme.colorScheme.primary
                trouble -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.onSurface
            },
        )
        if (pending > 0) Hint(pluralStringResource(R.plurals.connection_pending, pending, pending))
    }
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
