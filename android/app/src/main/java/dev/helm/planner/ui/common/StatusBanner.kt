package dev.helm.planner.ui.common

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.BannerTone
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.components.StatusBanner as ToneBanner

/**
 * The connection line at the top of Today and the board when it needs a word: offline, changes waiting, no server,
 * refused token; a warning or danger tone by how serious it is.
 */
@Composable
fun StatusBanner(status: ConnectionStatus, pending: Int, openSettings: () -> Unit, modifier: Modifier = Modifier) {
    val text = when (status) {
        ConnectionStatus.OFFLINE -> stringResource(R.string.status_offline, pending)
        ConnectionStatus.OFFLINE_MODE -> stringResource(R.string.status_offline_mode, pending)
        ConnectionStatus.NOT_CONFIGURED -> stringResource(R.string.status_not_configured)
        ConnectionStatus.UNAUTHORIZED -> stringResource(R.string.status_unauthorized)
        ConnectionStatus.ERROR -> stringResource(R.string.status_error)
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING ->
            if (pending > 0) stringResource(R.string.status_sending, pending) else return
    }
    val tone = when (status) {
        ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> BannerTone.Danger
        ConnectionStatus.OFFLINE, ConnectionStatus.OFFLINE_MODE, ConnectionStatus.NOT_CONFIGURED -> BannerTone.Warning
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING -> BannerTone.Info
    }
    val needsSettings = status == ConnectionStatus.NOT_CONFIGURED || status == ConnectionStatus.UNAUTHORIZED
    ToneBanner(
        text = text,
        tone = tone,
        action = if (needsSettings) stringResource(R.string.open_settings) else null,
        onAction = openSettings,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).then(modifier),
    )
}
