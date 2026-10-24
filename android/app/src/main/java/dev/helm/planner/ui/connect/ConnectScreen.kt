package dev.helm.planner.ui.connect

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.ui.components.BannerTone
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.StatusBanner
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object ConnectTags {
    const val SCREEN = "connect"
    const val LOCAL_CARD = "connect_local_card"
    const val LOCAL = "connect_local"
    const val SAMPLE = "connect_sample"
    const val SERVER_CARD = "connect_server_card"
    const val OPEN_FORM = "connect_open_form"
    const val ADDRESS = "connect_address"
    const val CODE = "connect_code"
    const val CONNECT = "connect_button"
    const val MESSAGE = "connect_message"
    const val REPLACE_CONFIRM = "connect_replace_confirm"
}

data class ConnectUiState(
    /** Filled in from a pairing link, the last server or the built-in default (empty when there is none). */
    val address: String,
    val code: String,
    val phase: ConnectPhase,
    /** Opened by itself at first start: offers Dayhand on this phone only first, the server second. */
    val firstRun: Boolean,
    /** The server signed this phone out; said once at the top. */
    val signedOut: Boolean = false,
)

interface ConnectActions {
    fun connect(address: String, code: String) {}
    fun confirmReplace() {}
    fun cancelReplace() {}
    fun useLocally(sample: Boolean) {}
    fun edited() {}
    fun close() {}
}

/**
 * Where the plan lives. At first start: on this phone only (empty, or with the sample plan), or a server of one's
 * own, whose card opens the pairing form. From Settings or a pairing link: the form, server address and the
 * one-time code from `dayhand pair` (docs/pairing.md).
 */
@Composable
fun ConnectScreen(state: ConnectUiState, actions: ConnectActions) {
    // At first start the form waits behind its card, unless a pairing link already brought a code. Connect and the
    // first start share this call site, so the choice is remembered per kind of visit.
    var opened by rememberSaveable(state.firstRun) { mutableStateOf(state.code.isNotEmpty()) }
    val formOpen = !state.firstRun || opened
    BackHandler(enabled = state.firstRun && opened) { opened = false }
    val back: (() -> Unit)? = when {
        state.firstRun && opened -> { { opened = false } }
        state.firstRun -> null
        else -> actions::close
    }
    val title = stringResource(if (formOpen) R.string.connect_title else R.string.welcome_title)
    Column(Modifier.fillMaxSize().background(palette.background).testTag(ConnectTags.SCREEN)) {
        ScreenHeader(title, onBack = back)
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .imePadding()
                .padding(horizontal = HelmDimens.screenMargin),
        ) {
            if (state.signedOut) StatusBanner(stringResource(R.string.server_signed_out), BannerTone.Danger)
            if (formOpen) ServerForm(state, actions) else Choices(state.phase != ConnectPhase.Working, actions) { opened = true }
            Spacer(Modifier.height(24.dp))
        }
    }
    (state.phase as? ConnectPhase.ConfirmReplace)?.let { ReplacePlanDialog(it.replace, actions::cancelReplace, actions::confirmReplace) }
}

/** The two ways to use Dayhand, the phone first: it needs nothing and is what a new user wants. */
@Composable
private fun ColumnScope.Choices(enabled: Boolean, actions: ConnectActions, openForm: () -> Unit) {
    val p = palette
    Text(stringResource(R.string.welcome_intro), style = helmType.body, color = p.text)
    ChoiceCard(LineIcon.Phone, stringResource(R.string.local_title), stringResource(R.string.local_body), ConnectTags.LOCAL_CARD) {
        PrimaryButton(
            stringResource(R.string.local_start),
            onClick = { actions.useLocally(sample = false) },
            enabled = enabled,
            modifier = Modifier.testTag(ConnectTags.LOCAL),
        )
        SecondaryButton(
            stringResource(R.string.local_sample),
            onClick = { actions.useLocally(sample = true) },
            enabled = enabled,
            color = p.accent,
            modifier = Modifier.fillMaxWidth().testTag(ConnectTags.SAMPLE),
        )
    }
    ChoiceCard(LineIcon.Cloud, stringResource(R.string.server_title), stringResource(R.string.server_body), ConnectTags.SERVER_CARD) {
        SecondaryButton(
            stringResource(R.string.server_title),
            onClick = openForm,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().testTag(ConnectTags.OPEN_FORM),
        )
    }
}

/** Server address, pairing code, Connect, and what happened in words. */
@Composable
private fun ColumnScope.ServerForm(state: ConnectUiState, actions: ConnectActions) {
    val p = palette
    // A new pairing link replaces what was typed.
    var address by rememberSaveable(state.address) { mutableStateOf(state.address) }
    var code by rememberSaveable(state.code) { mutableStateOf(state.code) }
    val working = state.phase == ConnectPhase.Working
    val canConnect = !working && state.phase != ConnectPhase.Connected && address.isNotBlank() && code.isNotBlank()
    val submit = { if (canConnect) actions.connect(address, code) }
    Text(stringResource(R.string.connect_intro), style = helmType.body, color = p.text)
    HelmTextField(
        value = address,
        onValueChange = { address = it; actions.edited() },
        label = stringResource(R.string.connect_address),
        supportingText = stringResource(R.string.connect_address_hint),
        isError = (state.phase as? ConnectPhase.Failed)?.error == ConnectError.BAD_ADDRESS,
        singleLine = true,
        enabled = !working,
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Uri,
            autoCorrectEnabled = false,
            imeAction = ImeAction.Next,
        ),
        modifier = Modifier.testTag(ConnectTags.ADDRESS),
    )
    HelmTextField(
        value = code,
        onValueChange = { code = it; actions.edited() },
        label = stringResource(R.string.connect_code),
        placeholder = "ABCD-EFGH-JKMN",
        supportingText = stringResource(R.string.connect_code_hint),
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
        modifier = Modifier.testTag(ConnectTags.CODE),
    )
    PhaseMessage(state.phase)
    PrimaryButton(
        stringResource(R.string.connect_button),
        onClick = submit,
        enabled = canConnect,
        modifier = Modifier.testTag(ConnectTags.CONNECT),
    )
    if (working) {
        CircularProgressIndicator(color = p.accent, modifier = Modifier.size(24.dp).align(Alignment.CenterHorizontally))
    }
}

@Composable
private fun PhaseMessage(phase: ConnectPhase) {
    val p = palette
    val text = when (phase) {
        ConnectPhase.Idle, is ConnectPhase.ConfirmReplace -> return
        ConnectPhase.Working -> stringResource(R.string.connect_working)
        ConnectPhase.Connected -> stringResource(R.string.connect_done)
        is ConnectPhase.Failed -> errorText(phase)
    }
    Text(
        text,
        style = helmType.bodyStrong,
        color = when (phase) {
            is ConnectPhase.Failed -> p.danger
            ConnectPhase.Connected -> p.success
            else -> p.text
        },
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
