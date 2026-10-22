package dev.helm.planner.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.auth.ConnectError

object ConnectTags {
    const val SCREEN = "connect"
    const val ADDRESS = "connect_address"
    const val CODE = "connect_code"
    const val CONNECT = "connect_button"
    const val SKIP = "connect_skip"
    const val MESSAGE = "connect_message"
}

data class ConnectUiState(
    /** Filled in from a pairing link, the last server or the built-in default. */
    val address: String,
    val code: String,
    val phase: ConnectPhase,
    /** Opened by itself at first start: offers to go on without a server. */
    val firstRun: Boolean,
    /** The server signed this phone out; said once at the top. */
    val signedOut: Boolean = false,
)

interface ConnectActions {
    fun connect(address: String, code: String) {}
    fun edited() {}
    fun close() {}
}

/** Pairing with a one-time code from `hlm pair`: server address, code, Connect (docs/pairing.md). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectScreen(state: ConnectUiState, actions: ConnectActions) {
    // A new pairing link replaces what was typed.
    var address by rememberSaveable(state.address) { mutableStateOf(state.address) }
    var code by rememberSaveable(state.code) { mutableStateOf(state.code) }
    val working = state.phase == ConnectPhase.Working
    val canConnect = !working && state.phase != ConnectPhase.Connected && address.isNotBlank() && code.isNotBlank()
    val submit = { if (canConnect) actions.connect(address, code) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.connect_title)) },
                navigationIcon = {
                    if (!state.firstRun) {
                        IconButton(onClick = actions::close, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                        }
                    }
                },
            )
        },
        modifier = Modifier.testTag(ConnectTags.SCREEN),
    ) { padding ->
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            if (state.signedOut) {
                Text(
                    stringResource(R.string.server_signed_out),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Text(stringResource(R.string.connect_intro), style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                value = address,
                onValueChange = { address = it; actions.edited() },
                label = { Text(stringResource(R.string.connect_address)) },
                supportingText = { Text(stringResource(R.string.connect_address_hint)) },
                isError = (state.phase as? ConnectPhase.Failed)?.error == ConnectError.BAD_ADDRESS,
                singleLine = true,
                enabled = !working,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth().testTag(ConnectTags.ADDRESS),
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it; actions.edited() },
                label = { Text(stringResource(R.string.connect_code)) },
                placeholder = { Text("ABCD-EFGH-JKMN") },
                supportingText = { Text(stringResource(R.string.connect_code_hint)) },
                isError = (state.phase as? ConnectPhase.Failed)?.error.let {
                    it == ConnectError.BAD_CODE || it == ConnectError.INVALID_CODE
                },
                singleLine = true,
                enabled = !working,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                modifier = Modifier.fillMaxWidth().testTag(ConnectTags.CODE),
            )
            PhaseMessage(state.phase)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Button(
                    onClick = submit,
                    enabled = canConnect,
                    modifier = Modifier.heightIn(min = 48.dp).testTag(ConnectTags.CONNECT),
                ) { Text(stringResource(R.string.connect_button)) }
                if (working) CircularProgressIndicator(modifier = Modifier.size(24.dp))
            }
            if (state.firstRun) {
                TextButton(
                    onClick = actions::close,
                    enabled = !working,
                    modifier = Modifier.heightIn(min = 48.dp).testTag(ConnectTags.SKIP),
                ) { Text(stringResource(R.string.connect_skip)) }
            }
        }
    }
}

@Composable
private fun PhaseMessage(phase: ConnectPhase) {
    val text = when (phase) {
        ConnectPhase.Idle -> return
        ConnectPhase.Working -> stringResource(R.string.connect_working)
        ConnectPhase.Connected -> stringResource(R.string.connect_done)
        is ConnectPhase.Failed -> errorText(phase)
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = if (phase is ConnectPhase.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(ConnectTags.MESSAGE),
    )
}

@Composable
private fun errorText(failed: ConnectPhase.Failed): String = when (failed.error) {
    ConnectError.BAD_ADDRESS -> stringResource(R.string.connect_error_address)
    ConnectError.BAD_CODE -> stringResource(R.string.connect_error_code)
    ConnectError.INVALID_CODE -> stringResource(R.string.connect_error_invalid)
    ConnectError.RATE_LIMITED -> failed.retryAfterSeconds?.let { seconds ->
        val minutes = ((seconds + 59) / 60).toInt().coerceAtLeast(1)
        pluralStringResource(R.plurals.connect_error_rate_limited_minutes, minutes, minutes)
    } ?: stringResource(R.string.connect_error_rate_limited)
    ConnectError.NO_NETWORK -> stringResource(R.string.connect_error_no_network)
    ConnectError.UNREACHABLE -> stringResource(R.string.connect_error_unreachable)
    ConnectError.NOT_HELM -> stringResource(R.string.connect_error_not_helm)
    ConnectError.SERVER_ERROR -> stringResource(R.string.connect_error_server)
}

