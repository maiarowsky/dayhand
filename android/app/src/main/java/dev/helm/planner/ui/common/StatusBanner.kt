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
 * The connection line at the top of Today and the board when it needs a word: offline, changes waiting, refused
 * token; a warning or danger tone by how serious it is. On this phone only ([ConnectionStatus.LOCAL]) is a way of
 * using Helm, not a problem, so it has no line.
 */
@Composable
fun StatusBanner(status: ConnectionStatus, pending: Int, openSettings: () -> Unit, modifier: Modifier = Modifier) {
    val text = when (status) {
        ConnectionStatus.OFFLINE -> stringResource(R.string.status_offline, pending)
        ConnectionStatus.UNAUTHORIZED -> stringResource(R.string.status_unauthorized)
        ConnectionStatus.ERROR -> stringResource(R.string.status_error)
        ConnectionStatus.LOCAL -> return
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING ->
            if (pending > 0) stringResource(R.string.status_sending, pending) else return
    }
    val tone = when (status) {
        ConnectionStatus.UNAUTHORIZED, ConnectionStatus.ERROR -> BannerTone.Danger
        ConnectionStatus.OFFLINE -> BannerTone.Warning
        ConnectionStatus.SYNCED, ConnectionStatus.CONNECTING, ConnectionStatus.LOCAL -> BannerTone.Info
    }
    val needsSettings = status == ConnectionStatus.UNAUTHORIZED
    ToneBanner(
        text = text,
        tone = tone,
        action = if (needsSettings) stringResource(R.string.open_settings) else null,
        onAction = openSettings,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).then(modifier),
    )
}

/** Says that the tasks on screen are the sample plan, with the one button that removes them all. */
@Composable
fun SampleBanner(onRemove: () -> Unit, modifier: Modifier = Modifier) {
    ToneBanner(
        text = stringResource(R.string.sample_banner),
        tone = BannerTone.Info,
        action = stringResource(R.string.sample_remove),
        onAction = onRemove,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).then(modifier),
    )
}
