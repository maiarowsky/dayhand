package dev.helm.planner.ui.connect

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.Credential
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListRow
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

/**
 * The rows of a server group: which server this phone is paired with, then Connect and / or Disconnect as rows that
 * act. [onDisconnect] only asks: the caller shows [DisconnectDialog] before anything is removed.
 */
fun serverRows(settings: AppSettings, onConnect: () -> Unit, onDisconnect: () -> Unit): List<@Composable () -> Unit> {
    val credential = settings.backend?.credential
    return buildList {
        add { ServerRow(settings) }
        if (credential !is Credential.Device) {
            add {
                ListRow(
                    stringResource(if (credential == null) R.string.server_connect else R.string.server_connect_code),
                    tag = ServerTags.CONNECT,
                    icon = LineIcon.Link,
                    titleColor = palette.accent,
                    onClick = onConnect,
                )
            }
        }
        if (credential != null) {
            add {
                ListRow(
                    stringResource(R.string.server_disconnect),
                    tag = ServerTags.DISCONNECT,
                    icon = LineIcon.Unlink,
                    titleColor = palette.danger,
                    onClick = onDisconnect,
                    chevron = false,
                )
            }
        }
    }
}

@Composable
private fun ServerRow(settings: AppSettings) {
    when (val credential = settings.backend?.credential) {
        is Credential.Device -> ListRow(
            stringResource(R.string.server_connected_to, hostOf(credential.serverUrl)),
            tag = ServerTags.SUMMARY,
            icon = LineIcon.Phone,
            note = stringResource(R.string.server_device, credential.deviceName),
        )
        is Credential.AppToken -> ListRow(
            stringResource(R.string.server_app_token),
            tag = ServerTags.SUMMARY,
            icon = LineIcon.Phone,
        )
        null -> ListRow(
            stringResource(if (settings.pairingLost) R.string.server_signed_out else R.string.server_not_connected),
            tag = ServerTags.SUMMARY,
            icon = if (settings.pairingLost) LineIcon.Warning else LineIcon.Phone,
        )
    }
}

/** Asks before disconnecting, naming the device id so it can be revoked on the server too. */
@Composable
fun DisconnectDialog(settings: AppSettings, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val deviceId = (settings.backend?.credential as? Credential.Device)?.deviceId.orEmpty()
    HelmDialog(
        title = stringResource(R.string.server_disconnect_title),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.server_disconnect),
        onConfirm = onConfirm,
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

private fun hostOf(url: String): String = try {
    URI(url).host ?: url
} catch (_: URISyntaxException) {
    url
}
