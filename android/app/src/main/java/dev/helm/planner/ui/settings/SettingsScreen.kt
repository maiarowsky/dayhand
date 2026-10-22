package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.settings.SettingsInput
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.Appearance

object SettingsTags {
    const val URL = "settings_url"
    const val TOKEN = "settings_token"
    const val SAVE = "settings_save"
    const val OFFLINE = "settings_offline"
}

/** Minimal settings for this step: backend address, app token (pasted, stored encrypted), offline test switch. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settings: AppSettings,
    versionName: String,
    appearance: Appearance,
    onAppearance: (Appearance) -> Unit,
    onOpenColors: () -> Unit,
    onOpenFont: () -> Unit,
    onOpenLicenses: () -> Unit,
    onSave: (url: String, token: String?) -> Unit,
    onOfflineMode: (Boolean) -> Unit,
    onBack: () -> Unit,
) {
    var url by rememberSaveable { mutableStateOf(settings.backend?.url.orEmpty()) }
    // The stored token is never put back into the field.
    var token by rememberSaveable { mutableStateOf("") }
    var saved by rememberSaveable { mutableStateOf(false) }
    val normalizedUrl = SettingsInput.normalizeUrl(url)
    val tokenOk = if (token.isBlank()) settings.hasToken else SettingsInput.isToken(token)
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(stringResource(R.string.settings_backend), style = MaterialTheme.typography.titleMedium)
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
                        onSave(normalizedUrl!!, token.ifBlank { null })
                        token = ""
                        saved = true
                    },
                    enabled = normalizedUrl != null && tokenOk,
                    modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.SAVE),
                ) { Text(stringResource(R.string.save)) }
                if (saved) Text(stringResource(R.string.settings_saved), color = MaterialTheme.colorScheme.primary)
            }
            HorizontalDivider()
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .toggleable(value = settings.offlineMode, role = Role.Switch, onValueChange = onOfflineMode)
                    .testTag(SettingsTags.OFFLINE),
            ) {
                Column(Modifier.weight(1f).padding(end = 16.dp)) {
                    Text(stringResource(R.string.settings_offline), style = MaterialTheme.typography.bodyLarge)
                    Text(
                        stringResource(R.string.settings_offline_hint),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = settings.offlineMode, onCheckedChange = null)
            }
            AppearanceGroup(appearance, onAppearance, onOpenColors, onOpenFont)
            ListGroup(
                title = stringResource(R.string.settings_about),
                rows = listOf({ ListRow(stringResource(R.string.licenses_title), "settings_licenses", onClick = onOpenLicenses) }),
            )
            HorizontalDivider()
            Text(stringResource(R.string.settings_timezone, settings.timezone), style = MaterialTheme.typography.bodyMedium)
            Text(
                stringResource(R.string.settings_version, versionName),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
