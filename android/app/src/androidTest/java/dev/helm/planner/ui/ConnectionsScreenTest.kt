package dev.helm.planner.ui

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.connections.AgentConnection
import dev.helm.planner.connections.AgentScope
import dev.helm.planner.connections.ConnectionRequest
import dev.helm.planner.ui.connections.ApproveOutcome
import dev.helm.planner.ui.connections.ApproveState
import dev.helm.planner.ui.connections.ConnectionsActions
import dev.helm.planner.ui.connections.ConnectionsList
import dev.helm.planner.ui.connections.ConnectionsScreen
import dev.helm.planner.ui.connections.ConnectionsTags
import dev.helm.planner.ui.connections.ConnectionsUiState
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectionsScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private val claude = AgentConnection("g1", "Claude", "claude.ai", "claude.ai", setOf(AgentScope.READ, AgentScope.WRITE), 1, 2, true)
    private val request = ConnectionRequest("K7QF-M2XA", "Claude", "claude.ai", "claude.ai", false, setOf(AgentScope.READ, AgentScope.WRITE), 0, 0)

    private class Recorder : ConnectionsActions {
        val calls = mutableListOf<String>()
        override fun startApprove() { calls += "start" }
        override fun codeChanged(code: String) { calls += "code:$code" }
        override fun lookup() { calls += "lookup" }
        override fun setScope(scope: AgentScope, allowed: Boolean) { calls += "scope:$scope=$allowed" }
        override fun approve() { calls += "approve" }
        override fun refuse() { calls += "refuse" }
        override fun disconnect(connectionId: String) { calls += "disconnect:$connectionId" }
    }

    private fun show(state: ConnectionsUiState, actions: ConnectionsActions) =
        compose.setContent { HelmTheme { ConnectionsScreen(state, actions, onBack = {}) } }

    @Test
    fun listShowsWhereAnAgentComesFromAndDisconnectsAfterConfirming() {
        val actions = Recorder()
        show(ConnectionsUiState(list = ConnectionsList.Loaded(listOf(claude, claude.copy(id = "g2", active = false))), timeLabel = { "23 Oct 10:00" }), actions)
        compose.onNodeWithText(text(R.string.connections_from, "claude.ai") + " · " + text(R.string.connections_read_write) + " · " +
            text(R.string.connections_last_used, "23 Oct 10:00")).assertIsDisplayed()
        // Only active connections are listed.
        compose.onNodeWithTag(ConnectionsTags.ITEM + "g2").assertDoesNotExist()
        compose.onNodeWithTag(ConnectionsTags.ITEM + "g1").performClick()
        compose.onNodeWithText(text(R.string.connections_disconnect_title, "Claude")).assertIsDisplayed()
        compose.onNodeWithTag(ConnectionsTags.DISCONNECT).performClick()
        assertEquals(listOf("disconnect:g1"), actions.calls)
    }

    @Test
    fun emptyAndFailedLists() {
        var state by mutableStateOf(ConnectionsUiState(list = ConnectionsList.Loaded(emptyList())))
        compose.setContent { HelmTheme { ConnectionsScreen(state, Recorder(), onBack = {}) } }
        compose.onNodeWithText(text(R.string.connections_none)).assertIsDisplayed()
        state = ConnectionsUiState(list = ConnectionsList.Failed(unauthorized = true))
        compose.onNodeWithText(text(R.string.connections_unauthorized)).assertIsDisplayed()
        state = ConnectionsUiState(list = ConnectionsList.Failed(unauthorized = false))
        compose.onNodeWithText(text(R.string.connections_failed)).assertIsDisplayed()
    }

    @Test
    fun theCodeMustBeCompleteBeforeContinue() {
        val actions = Recorder()
        var state by mutableStateOf(ConnectionsUiState(approve = ApproveState.Entry()))
        compose.setContent { HelmTheme { ConnectionsScreen(state, actions, onBack = {}) } }
        compose.onNodeWithTag(ConnectionsTags.CONTINUE).assertIsNotEnabled()
        compose.onNodeWithTag(ConnectionsTags.CODE).performTextInput("k7qf")
        assertEquals("code:k7qf", actions.calls.last())
        state = ConnectionsUiState(approve = ApproveState.Entry(code = "k7qf m2xa"))
        compose.onNodeWithTag(ConnectionsTags.CONTINUE).assertIsEnabled().performClick()
        assertEquals("lookup", actions.calls.last())
        state = ConnectionsUiState(approve = ApproveState.Entry(code = "k7qf m2xa", error = dev.helm.planner.ui.connections.ApproveError.NOT_FOUND))
        compose.onNodeWithText(text(R.string.approve_not_found)).assertIsDisplayed()
    }

    @Test
    fun consentShowsWhoAndWhatAndSendsTheChoice() {
        val actions = Recorder()
        var state by mutableStateOf(ConnectionsUiState(approve = ApproveState.Consent(request)))
        compose.setContent { HelmTheme { ConnectionsScreen(state, actions, onBack = {}) } }
        compose.onNodeWithText(text(R.string.approve_asks, "Claude")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.approve_client_verified, "claude.ai")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.approve_returns_to, "claude.ai")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.approve_loopback_warning)).assertDoesNotExist()
        compose.onNodeWithTag(ConnectionsTags.OLD_WARNING).assertDoesNotExist()
        compose.onNodeWithTag(ConnectionsTags.SCOPE + "read").assertIsOn()
        compose.onNodeWithTag(ConnectionsTags.SCOPE + "write").assertIsOn().performClick()
        assertEquals("scope:WRITE=false", actions.calls.last())

        state = ConnectionsUiState(approve = ApproveState.Consent(request, scopes = emptySet()))
        compose.onNodeWithTag(ConnectionsTags.SCOPE + "write").assertIsOff()
        compose.onNodeWithTag(ConnectionsTags.CONFIRM).performScrollTo().assertIsNotEnabled()
        state = ConnectionsUiState(approve = ApproveState.Consent(request, scopes = setOf(AgentScope.READ)))
        compose.onNodeWithTag(ConnectionsTags.CONFIRM).performScrollTo().performClick()
        compose.onNodeWithTag(ConnectionsTags.REFUSE).performScrollTo().performClick()
        assertEquals(listOf("approve", "refuse"), actions.calls.takeLast(2))
    }

    @Test
    fun aSelfRegisteredLoopbackClientIsFlagged() {
        val loopback = request.copy(clientName = "Tool", clientHost = null, redirectHost = "localhost", loopback = true, scopes = setOf(AgentScope.READ))
        var state by mutableStateOf(ConnectionsUiState(approve = ApproveState.Consent(loopback)))
        compose.setContent { HelmTheme { ConnectionsScreen(state, Recorder(), onBack = {}) } }
        compose.onNodeWithText(text(R.string.approve_client_registered)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.approve_loopback_warning)).assertIsDisplayed()
        state = ConnectionsUiState(approve = ApproveState.Consent(loopback, old = true), timeLabel = { "10:00" })
        compose.onNodeWithText(text(R.string.approve_asked_at, "10:00")).assertIsDisplayed()
        compose.onNodeWithTag(ConnectionsTags.OLD_WARNING).assertIsDisplayed()
        // Only what was asked for can be granted.
        compose.onNodeWithTag(ConnectionsTags.SCOPE + "write").assertDoesNotExist()
    }

    @Test
    fun finishedSaysWhatHappens() {
        show(ConnectionsUiState(approve = ApproveState.Finished(ApproveOutcome.APPROVED)), Recorder())
        compose.onNodeWithText(text(R.string.approve_done)).assertIsDisplayed()
    }
}
