package dev.helm.planner.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.Credential
import java.net.URI
import java.net.URISyntaxException

object ServerTags {
    const val CONNECT = "server_connect"
    const val DISCONNECT = "server_disconnect"
    const val DISCONNECT_CONFIRM = "server_disconnect_confirm"
    const val SUMMARY = "server_summary"
}

/** Which server this phone is paired with, and the buttons to connect or disconnect. */
@Composable
fun ServerConnectionPanel(settings: AppSettings, onConnect: () -> Unit, onDisconnect: () -> Unit) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    val credential = settings.backend?.credential
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.testTag(ServerTags.SUMMARY)) {
        when (credential) {
            is Credential.Device -> {
                Text(stringResource(R.string.server_connected_to, hostOf(credential.serverUrl)), style = MaterialTheme.typography.bodyLarge)
                Text(
                    stringResource(R.string.server_device, credential.deviceName),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            is Credential.AppToken -> Text(stringResource(R.string.server_app_token), style = MaterialTheme.typography.bodyLarge)
            null -> Text(
                stringResource(if (settings.pairingLost) R.string.server_signed_out else R.string.server_not_connected),
                style = MaterialTheme.typography.bodyLarge,
                color = if (settings.pairingLost) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (credential !is Credential.Device) {
            Button(onClick = onConnect, modifier = Modifier.heightIn(min = 48.dp).testTag(ServerTags.CONNECT)) {
                Text(stringResource(if (credential == null) R.string.server_connect else R.string.server_connect_code))
            }
        }
        if (credential != null) {
            OutlinedButton(
                onClick = { confirming = true },
                modifier = Modifier.heightIn(min = 48.dp).testTag(ServerTags.DISCONNECT),
            ) { Text(stringResource(R.string.server_disconnect)) }
        }
    }
    if (confirming) {
        val deviceId = (credential as? Credential.Device)?.deviceId.orEmpty()
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.server_disconnect_title)) },
            text = {
                Text(
                    if (deviceId.isEmpty()) stringResource(R.string.server_disconnect_text_no_id)
                    else stringResource(R.string.server_disconnect_text, deviceId),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        onDisconnect()
                    },
                    modifier = Modifier.testTag(ServerTags.DISCONNECT_CONFIRM),
                ) { Text(stringResource(R.string.server_disconnect)) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

private fun hostOf(url: String): String = try {
    URI(url).host ?: url
} catch (_: URISyntaxException) {
    url
}
