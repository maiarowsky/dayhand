package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.connections.AgentConnection
import dev.helm.planner.connections.AgentScope
import dev.helm.planner.connections.ConnectionRequest
import dev.helm.planner.ui.connections.ApproveOutcome
import dev.helm.planner.ui.connections.ApproveState
import dev.helm.planner.ui.connections.ConnectionsActions
import dev.helm.planner.ui.connections.ConnectionsList
import dev.helm.planner.ui.connections.ConnectionsScreen
import dev.helm.planner.ui.connections.ConnectionsUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Screenshots of Settings → Agent connections: the list, the code, the consent (Claude app, Claude Code, an old request), done. */
@RunWith(AndroidJUnit4::class)
class ConnectionsTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()
    private val day = 24 * 60 * 60 * 1000L
    private val now = 1_792_746_905_000L
    private val claude = ConnectionRequest("K7QF-M2XA", "Claude", "claude.ai", "claude.ai", false, setOf(AgentScope.READ, AgentScope.WRITE), now - 40_000, now + 560_000)

    private var shown by mutableStateOf<ConnectionsUiState?>(null)

    // A test may set its content only once; every page after the first only changes the state.
    private fun page(name: String, state: ConnectionsUiState) {
        if (shown == null) {
            compose.runOnUiThread { compose.activity.tourBars(config.dark) }
            compose.setContent {
                TourTheme(config) { shown?.let { ConnectionsScreen(it.copy(timeLabel = { "23 Oct 10:42" }), object : ConnectionsActions {}, onBack = {}) } }
            }
        }
        compose.runOnUiThread { shown = state }
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    @Test
    fun pages() {
        page(
            "40-connections-list",
            ConnectionsUiState(
                list = ConnectionsList.Loaded(
                    listOf(
                        AgentConnection("g1", "Claude", "claude.ai", "claude.ai", setOf(AgentScope.READ, AgentScope.WRITE), now - day, now, true),
                        AgentConnection("g2", "Claude Code", "claude.ai", "localhost", setOf(AgentScope.READ), now - 3 * day, null, true),
                    ),
                ),
            ),
        )
        page("41-connections-empty", ConnectionsUiState(list = ConnectionsList.Loaded(emptyList())))
        page("42-approve-code", ConnectionsUiState(approve = ApproveState.Entry(code = "K7QF-M2XA")))
        page("43-approve-consent", ConnectionsUiState(approve = ApproveState.Consent(claude)))
        page(
            "44-approve-consent-loopback",
            ConnectionsUiState(approve = ApproveState.Consent(claude.copy(clientName = "Claude Code", redirectHost = "127.0.0.1", loopback = true))),
        )
        page("46-approve-consent-old", ConnectionsUiState(approve = ApproveState.Consent(claude.copy(createdAt = now - 6 * 60_000), old = true)))
        page("45-approve-done", ConnectionsUiState(approve = ApproveState.Finished(ApproveOutcome.APPROVED)))
    }
}
