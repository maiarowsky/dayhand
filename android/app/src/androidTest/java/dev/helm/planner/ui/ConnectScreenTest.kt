package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.auth.ConnectError
import dev.helm.planner.auth.PlanReplace
import dev.helm.planner.ui.connect.ConnectActions
import dev.helm.planner.ui.connect.ConnectPhase
import dev.helm.planner.ui.connect.ConnectScreen
import dev.helm.planner.ui.connect.ConnectTags
import dev.helm.planner.ui.connect.ConnectUiState
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        override fun confirmReplace() { calls += "replace" }
        override fun cancelReplace() { calls += "keep" }
        override fun useLocally(sample: Boolean) { calls += "local:$sample" }
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
    fun atFirstStartOnThisPhoneOnlyComesFirst() {
        val actions = Recorder()
        show(state(firstRun = true), actions)
        compose.onNodeWithText(text(R.string.welcome_title)).assertIsDisplayed()
        val local = compose.onNodeWithTag(ConnectTags.LOCAL_CARD).getUnclippedBoundsInRoot()
        val server = compose.onNodeWithTag(ConnectTags.SERVER_CARD).getUnclippedBoundsInRoot()
        assertTrue("the phone is the first choice", local.bottom <= server.top)
        // The form waits behind its card, so a new user sees two choices, not a server address.
        compose.onNodeWithTag(ConnectTags.ADDRESS).assertDoesNotExist()
        compose.onNodeWithTag(ConnectTags.LOCAL).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(ConnectTags.SAMPLE).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("local:false", "local:true"), actions.calls)
    }

    @Test
    fun atFirstStartTheServerCardOpensTheFormAndBackReturns() {
        val actions = Recorder()
        show(state(firstRun = true), actions)
        compose.onNodeWithTag(ConnectTags.OPEN_FORM).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(ConnectTags.ADDRESS).assertTextContains(DEFAULT)
        compose.onNodeWithText(text(R.string.connect_title)).assertIsDisplayed()
        compose.onNodeWithTag("back").performClick()
        compose.onNodeWithTag(ConnectTags.LOCAL_CARD).assertIsDisplayed()
        assertEquals(emptyList<String>(), actions.calls)
    }

    @Test
    fun aPairingLinkAtFirstStartShowsTheFormFilledIn() {
        show(state(firstRun = true, code = "E6M8-FE02-XSNT"))
        compose.onNodeWithTag(ConnectTags.CODE).assertTextContains("E6M8-FE02-XSNT")
        compose.onNodeWithTag(ConnectTags.CONNECT).assertIsEnabled()
    }

    @Test
    fun anotherServerAsksBeforeReplacingThePlan() {
        val actions = Recorder()
        val replace = PlanReplace("https://old-one.convex.site", "https://new-one.convex.site", tasks = 7, pending = 2)
        show(state(phase = ConnectPhase.ConfirmReplace(replace), code = "E6M8-FE02-XSNT"), actions)
        compose.onNodeWithText(text(R.string.replace_title)).assertIsDisplayed()
        val tasks = context.resources.getQuantityString(R.plurals.replace_tasks, 7, 7)
        compose.onNodeWithText(context.getString(R.string.replace_text, "old-one.convex.site", "new-one.convex.site", tasks)).assertIsDisplayed()
        val changes = context.resources.getQuantityString(R.plurals.replace_changes, 2, 2)
        compose.onNodeWithText(context.getString(R.string.replace_pending, changes, "old-one.convex.site")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.cancel)).performClick()
        compose.onNodeWithTag(ConnectTags.REPLACE_CONFIRM).performClick()
        assertEquals(listOf("keep", "replace"), actions.calls)
    }

    private companion object {
        const val DEFAULT = "https://example-deployment-123.eu-west-1.convex.site"
    }
}
