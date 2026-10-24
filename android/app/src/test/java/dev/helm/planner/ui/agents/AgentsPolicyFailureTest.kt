package dev.helm.planner.ui.agents

import dev.helm.planner.agents.AgentControlApi
import dev.helm.planner.agents.AgentControlTest
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.data.remote.HttpResponse
import dev.helm.planner.data.remote.HttpTaskRemote
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(Parameterized::class)
class AgentsPolicyFailureTest(private val failure: Failure) {
    enum class Failure { HTTP_401, HTTP_403, OFFLINE, TIMEOUT, NO_API }

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `a failed rule keeps its page and current policy until a retry succeeds`() {
        var failing = true
        var available = true
        val sent = mutableListOf<JsonObject>()
        val remote = HttpTaskRemote("http://server", "token", transport = { _, _, body ->
            val request = Json.parseToJsonElement(body).jsonObject
            val path = request.getValue("path").jsonPrimitive.content
            if (path == AgentControlApi.SET_POLICY) {
                sent += request
                if (!failing) {
                    HttpResponse(200, """{"status":"success","value":null}""")
                } else {
                    when (failure) {
                        Failure.HTTP_401 -> HttpResponse(401, "Unauthorized")
                        Failure.HTTP_403 -> HttpResponse(403, "Forbidden")
                        Failure.OFFLINE -> throw IOException("offline")
                        Failure.TIMEOUT -> throw SocketTimeoutException("timeout")
                        Failure.NO_API -> error("A missing API must not send a mutation")
                    }
                }
            } else {
                val value = when (path) {
                    AgentControlApi.GET_CONTROLS -> AgentControlTest.CONTROLS
                    AgentControlApi.LIST_APPROVALS -> AgentControlTest.APPROVALS
                    AgentControlApi.LIST_PROPOSALS -> AgentControlTest.PROPOSALS
                    else -> error("Unexpected query: $path")
                }
                HttpResponse(200, """{"status":"success","value":$value}""")
            }
        })
        val api = AgentControlApi(queries = remote, mutations = remote)
        val vm = AgentsViewModel(api = { if (available) api else null })
        val page = AgentsPage.Policy("k1", "*")
        val controls = vm.ui.value.controls
        assertEquals(PolicyRule.ASK, (controls as Section.Loaded).value.policies.first().rule)
        vm.open(page)
        available = failure != Failure.NO_API

        vm.setPolicy("k1", "*", PolicyRule.DENY)

        assertEquals(AgentsMessage.FAILED, vm.ui.value.message)
        assertEquals(page, vm.ui.value.page)
        assertEquals(controls, vm.ui.value.controls)
        assertFalse(vm.ui.value.busy)
        assertEquals(if (failure == Failure.NO_API) 0 else 1, sent.size)

        failing = false
        available = true
        vm.setPolicy("k1", "*", PolicyRule.DENY)

        assertEquals(AgentsMessage.POLICY_SET, vm.ui.value.message)
        assertEquals(AgentsPage.Main, vm.ui.value.page)
        assertFalse(vm.ui.value.busy)
        assertEquals(if (failure == Failure.NO_API) 1 else 2, sent.size)
        assertEquals(AgentControlApi.SET_POLICY, sent.last().getValue("path").jsonPrimitive.content)
        assertEquals(
            mapOf("apiKeyId" to "k1", "toolName" to "*", "rule" to "deny"),
            sent.last().getValue("args").jsonArray.single().jsonObject.mapValues { it.value.jsonPrimitive.content },
        )
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun failures() = Failure.entries.map { arrayOf(it) }
    }
}
