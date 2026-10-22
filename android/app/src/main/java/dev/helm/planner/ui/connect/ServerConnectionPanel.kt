package dev.helm.planner.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
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
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
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
    val p = palette
    var confirming by rememberSaveable { mutableStateOf(false) }
    val credential = settings.backend?.credential
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.testTag(ServerTags.SUMMARY)) {
        when (credential) {
            is Credential.Device -> {
                Text(stringResource(R.string.server_connected_to, hostOf(credential.serverUrl)), style = helmType.body, color = p.text)
                Text(stringResource(R.string.server_device, credential.deviceName), style = helmType.small, color = p.textMuted)
            }
            is Credential.AppToken -> Text(stringResource(R.string.server_app_token), style = helmType.body, color = p.text)
            null -> Text(
                stringResource(if (settings.pairingLost) R.string.server_signed_out else R.string.server_not_connected),
                style = helmType.body,
                color = if (settings.pairingLost) p.danger else p.text,
            )
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (credential !is Credential.Device) {
            SecondaryButton(
                stringResource(if (credential == null) R.string.server_connect else R.string.server_connect_code),
                onClick = onConnect,
                color = p.accent,
                modifier = Modifier.testTag(ServerTags.CONNECT),
            )
        }
        if (credential != null) {
            SecondaryButton(
                stringResource(R.string.server_disconnect),
                onClick = { confirming = true },
                color = p.danger,
                modifier = Modifier.testTag(ServerTags.DISCONNECT),
            )
        }
    }
    if (confirming) {
        val deviceId = (credential as? Credential.Device)?.deviceId.orEmpty()
        HelmDialog(
            title = stringResource(R.string.server_disconnect_title),
            onDismiss = { confirming = false },
            confirm = stringResource(R.string.server_disconnect),
            onConfirm = {
                confirming = false
                onDisconnect()
            },
            dismiss = stringResource(R.string.cancel),
            destructive = true,
            confirmTag = ServerTags.DISCONNECT_CONFIRM,
        ) {
            Text(
                if (deviceId.isEmpty()) stringResource(R.string.server_disconnect_text_no_id)
                else stringResource(R.string.server_disconnect_text, deviceId),
                style = helmType.body,
            )
        }
    }
}

private fun hostOf(url: String): String = try {
    URI(url).host ?: url
} catch (_: URISyntaxException) {
    url
}
