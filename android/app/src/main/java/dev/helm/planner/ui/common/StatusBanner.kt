package dev.helm.planner.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.today.ConnectionStatus

/** The connection line at the top of Today and the board: offline, waiting changes, token or server problems. */
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
    val needsSettings = status == ConnectionStatus.NOT_CONFIGURED || status == ConnectionStatus.UNAUTHORIZED
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
            if (needsSettings) {
                TextButton(onClick = openSettings, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.open_settings))
                }
            }
        }
    }
}
