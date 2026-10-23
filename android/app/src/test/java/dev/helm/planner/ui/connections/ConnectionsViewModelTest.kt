package dev.helm.planner.ui.connections

import dev.helm.planner.connections.AgentConnectionsApi
import dev.helm.planner.connections.AgentScope
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConnectionsViewModelTest {
    private val decisions = mutableListOf<JsonObject>()
    private var lookupAnswer = """{"status":"found","request":{"clientName":"Claude","clientHost":"claude.ai","redirectHost":"claude.ai","loopback":false,"scopes":["tasks:read","tasks:write"],"createdAt":1000,"expiresAt":601000}}"""

    private val api = AgentConnectionsApi(
        queries = { _, _ -> SendResult.Applied(Json.parseToJsonElement("[]")) },
        mutations = { path, args ->
            when (path) {
                AgentConnectionsApi.LOOKUP -> SendResult.Applied(Json.parseToJsonElement(lookupAnswer))
                AgentConnectionsApi.DECIDE -> {
                    decisions += args
                    SendResult.Applied(Json.parseToJsonElement("""{"status":"approved","scopes":["tasks:read"]}"""))
                }
                else -> SendResult.Applied(JsonObject(emptyMap()))
            }
        },
    )

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `code, consent with less than asked, approved`() {
        val vm = ConnectionsViewModel(api = { api })
        assertEquals(ConnectionsList.Loaded(emptyList()), vm.ui.value.list)
        vm.startApprove()
        vm.codeChanged("k7qf m2xa")
        vm.lookup()
        val consent = vm.ui.value.approve as ApproveState.Consent
        assertEquals("K7QF-M2XA", consent.request.code)
        assertEquals(setOf(AgentScope.READ, AgentScope.WRITE), consent.scopes)

        vm.setScope(AgentScope.WRITE, false)
        vm.approve()
        assertEquals(ApproveState.Finished(ApproveOutcome.APPROVED), vm.ui.value.approve)
        assertEquals(listOf("tasks:read"), decisions.single().getValue("scopes").jsonArray.map { it.jsonPrimitive.content })
        vm.closeApprove()
        assertEquals(null, vm.ui.value.approve)
    }

    @Test
    fun `nothing chosen is not sent, and a wrong code says so`() {
        val vm = ConnectionsViewModel(api = { api })
        vm.startApprove()
        vm.codeChanged("K7QF-M2XA")
        vm.lookup()
        vm.setScope(AgentScope.READ, false)
        vm.setScope(AgentScope.WRITE, false)
        vm.approve()
        assertEquals(ApproveError.NOTHING_CHOSEN, (vm.ui.value.approve as ApproveState.Consent).error)
        assertTrue(decisions.isEmpty())

        lookupAnswer = """{"status":"not_found"}"""
        vm.closeApprove()
        vm.startApprove()
        vm.codeChanged("K7QF-M2XA")
        vm.lookup()
        assertEquals(ApproveError.NOT_FOUND, (vm.ui.value.approve as ApproveState.Entry).error)
        vm.codeChanged("K7QF-M2X")
        assertEquals(null, (vm.ui.value.approve as ApproveState.Entry).error)
    }

    @Test
    fun `a request minutes old is flagged on the consent`() {
        var clock = 1000 + 60_000L
        val vm = ConnectionsViewModel(api = { api }, now = { clock })
        vm.startApprove()
        vm.codeChanged("K7QF-M2XA")
        vm.lookup()
        assertEquals(false, (vm.ui.value.approve as ApproveState.Consent).old)

        clock = 1000 + 4 * 60_000L
        vm.closeApprove()
        vm.startApprove()
        vm.codeChanged("K7QF-M2XA")
        vm.lookup()
        assertEquals(true, (vm.ui.value.approve as ApproveState.Consent).old)
    }

    @Test
    fun `a phone that is not paired says so in the list`() {
        val vm = ConnectionsViewModel(api = { null })
        assertEquals(ConnectionsList.Failed(unauthorized = true), vm.ui.value.list)
    }
}
