package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import dev.helm.planner.R
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.connect.ServerConnectionPanel
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.ConnectionStatus

/** Connection status, the paired server with Connect / Disconnect, offline test switch. */
@Composable
internal fun ServerSection(data: SettingsData, actions: SettingsActions) {
    val settings = data.settings
    CardSection(stringResource(R.string.settings_backend)) {
        ConnectionLine(data.connection, data.pendingChanges)
        ServerConnectionPanel(settings, onConnect = actions::openConnect, onDisconnect = actions::disconnect)
        SwitchRow(
            stringResource(R.string.settings_offline),
            checked = settings.offlineMode,
            onChange = actions::setOfflineMode,
            subtitle = stringResource(R.string.settings_offline_hint),
            modifier = Modifier.testTag(SettingsTags.OFFLINE),
        )
        Hint(stringResource(R.string.settings_timezone, settings.timezone))
    }
}

@Composable
private fun ConnectionLine(connection: ConnectionStatus, pending: Int) {
    val p = palette
    val ok = connection == ConnectionStatus.SYNCED
    val trouble = connection == ConnectionStatus.UNAUTHORIZED || connection == ConnectionStatus.ERROR
    Column(
        Modifier
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .testTag(SettingsTags.CONNECTION),
    ) {
        Text(
            stringResource(R.string.connection_label, stringResource(connectionText(connection))),
            style = helmType.bodyStrong,
            color = when {
                ok -> p.success
                trouble -> p.danger
                else -> p.text
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
