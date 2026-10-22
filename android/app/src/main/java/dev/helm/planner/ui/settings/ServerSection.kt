package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.settings.SettingsInput
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.SwitchRow
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
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

    Section(stringResource(R.string.settings_backend)) {
        ConnectionLine(data.connection, data.pendingChanges)
        HelmTextField(
            value = url,
            onValueChange = { url = it; saved = false },
            label = stringResource(R.string.settings_url),
            supportingText = stringResource(
                if (url.isNotBlank() && normalizedUrl == null) R.string.settings_url_invalid else R.string.settings_url_hint,
            ),
            isError = url.isNotBlank() && normalizedUrl == null,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.testTag(SettingsTags.URL),
        )
        HelmTextField(
            value = token,
            onValueChange = { token = it.trim(); saved = false },
            label = stringResource(R.string.settings_token),
            placeholder = stringResource(R.string.settings_token_hint),
            supportingText = stringResource(
                when {
                    token.isNotBlank() && !tokenOk -> R.string.settings_token_invalid
                    settings.hasToken -> R.string.settings_token_saved
                    else -> R.string.settings_token_missing
                },
            ),
            isError = token.isNotBlank() && !tokenOk,
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
            modifier = Modifier.testTag(SettingsTags.TOKEN),
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            PrimaryButton(
                stringResource(R.string.save),
                onClick = {
                    actions.saveBackend(normalizedUrl!!, token.ifBlank { null })
                    token = ""
                    saved = true
                },
                enabled = normalizedUrl != null && tokenOk,
                fillWidth = false,
                modifier = Modifier.testTag(SettingsTags.SAVE),
            )
            if (saved) Text(stringResource(R.string.settings_saved), style = helmType.bodyStrong, color = palette.success)
        }
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
