package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.ui.connect.ConnectActions
import dev.helm.planner.ui.connect.ConnectPhase
import dev.helm.planner.ui.connect.ConnectScreen
import dev.helm.planner.ui.connect.ConnectTags
import dev.helm.planner.ui.connect.ConnectUiState
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int) = context.getString(id)

    private class Recorder : ConnectActions {
        val calls = mutableListOf<String>()
        override fun connect(address: String, code: String) { calls += "connect:$address:$code" }
        override fun close() { calls += "close" }
    }

    private fun show(state: ConnectUiState, actions: ConnectActions = Recorder()) {
        compose.setContent { HelmTheme { ConnectScreen(state, actions) } }
    }

    private fun state(phase: ConnectPhase = ConnectPhase.Idle, code: String = "", firstRun: Boolean = false) =
        ConnectUiState(address = DEFAULT, code = code, phase = phase, firstRun = firstRun)

    @Test
    fun addressIsFilledInAndConnectWaitsForACode() {
        val actions = Recorder()
        show(state(), actions)
        compose.onNodeWithTag(ConnectTags.ADDRESS).assertTextContains(DEFAULT)
        compose.onNodeWithTag(ConnectTags.CONNECT).assertIsNotEnabled()
        compose.onNodeWithTag(ConnectTags.CODE).performTextInput("e6m8 fe02 xsnt")
        compose.onNodeWithTag(ConnectTags.CONNECT).assertIsEnabled().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("connect:$DEFAULT:e6m8 fe02 xsnt"), actions.calls)
    }

    @Test
    fun theAddressCanBeChanged() {
        val actions = Recorder()
        show(state(code = "E6M8-FE02-XSNT"), actions)
        compose.onNodeWithTag(ConnectTags.ADDRESS).performTextClearance()
        compose.onNodeWithTag(ConnectTags.ADDRESS).performTextInput("http://10.0.2.2:3211")
        compose.onNodeWithTag(ConnectTags.CONNECT).performClick()
        assertEquals(listOf("connect:http://10.0.2.2:3211:E6M8-FE02-XSNT"), actions.calls)
    }

    @Test
    fun errorsAreSaidInWords() {
        val cases = mapOf(
            ConnectError.INVALID_CODE to R.string.connect_error_invalid,
            ConnectError.NO_NETWORK to R.string.connect_error_no_network,
            ConnectError.UNREACHABLE to R.string.connect_error_unreachable,
            ConnectError.BAD_CODE to R.string.connect_error_code,
            ConnectError.NOT_HELM to R.string.connect_error_not_helm,
        )
        var phase by mutableStateOf<ConnectPhase>(ConnectPhase.Idle)
        compose.setContent { HelmTheme { ConnectScreen(state(phase = phase, code = "x"), Recorder()) } }
        for ((error, message) in cases) {
            phase = ConnectPhase.Failed(error)
            compose.onNodeWithTag(ConnectTags.MESSAGE).assertTextContains(text(message))
        }
        phase = ConnectPhase.Failed(ConnectError.RATE_LIMITED, retryAfterSeconds = 300)
        compose.onNodeWithTag(ConnectTags.MESSAGE).assertTextContains("5", substring = true)
    }

    @Test
    fun whileConnectingTheButtonIsOff() {
        show(state(phase = ConnectPhase.Working, code = "E6M8-FE02-XSNT"))
        compose.onNodeWithTag(ConnectTags.CONNECT).assertIsNotEnabled()
        compose.onNodeWithTag(ConnectTags.MESSAGE).assertTextContains(text(R.string.connect_working))
    }

    @Test
    fun atFirstStartHelmCanBeUsedWithoutAServer() {
        val actions = Recorder()
        show(state(firstRun = true), actions)
        compose.onNodeWithTag(ConnectTags.SKIP).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("close"), actions.calls)
    }

    private companion object {
        const val DEFAULT = "https://impressive-grouse-796.eu-west-1.convex.site"
    }
}
