package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.settings.SettingsInput
import dev.helm.planner.ui.today.ConnectionStatus

/** Backend address, app token (pasted, stored encrypted, never shown again), connection status, offline test switch. */
@Composable
internal fun ServerSection(data: SettingsData, actions: SettingsActions) {
    val settings = data.settings
    var url by rememberSaveable { mutableStateOf(settings.backend?.url.orEmpty()) }
    // The stored token is never put back into the field.
    var token by rememberSaveable { mutableStateOf("") }
    var saved by rememberSaveable { mutableStateOf(false) }
    val normalizedUrl = SettingsInput.normalizeUrl(url)
    val tokenOk = if (token.isBlank()) settings.hasToken else SettingsInput.isToken(token)

    SectionHeader(stringResource(R.string.settings_backend))
    ConnectionLine(data.connection, data.pendingChanges)
    OutlinedTextField(
        value = url,
        onValueChange = { url = it; saved = false },
        label = { Text(stringResource(R.string.settings_url)) },
        supportingText = {
            Text(stringResource(if (url.isNotBlank() && normalizedUrl == null) R.string.settings_url_invalid else R.string.settings_url_hint))
        },
        isError = url.isNotBlank() && normalizedUrl == null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().testTag(SettingsTags.URL),
    )
    OutlinedTextField(
        value = token,
        onValueChange = { token = it.trim(); saved = false },
        label = { Text(stringResource(R.string.settings_token)) },
        placeholder = { Text(stringResource(R.string.settings_token_hint)) },
        supportingText = {
            Text(
                stringResource(
                    when {
                        token.isNotBlank() && !tokenOk -> R.string.settings_token_invalid
                        settings.hasToken -> R.string.settings_token_saved
                        else -> R.string.settings_token_missing
                    },
                ),
            )
        },
        isError = token.isNotBlank() && !tokenOk,
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth().testTag(SettingsTags.TOKEN),
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Button(
            onClick = {
                actions.saveBackend(normalizedUrl!!, token.ifBlank { null })
                token = ""
                saved = true
            },
            enabled = normalizedUrl != null && tokenOk,
            modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.SAVE),
        ) { Text(stringResource(R.string.save)) }
        if (saved) Text(stringResource(R.string.settings_saved), color = MaterialTheme.colorScheme.primary)
    }
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
