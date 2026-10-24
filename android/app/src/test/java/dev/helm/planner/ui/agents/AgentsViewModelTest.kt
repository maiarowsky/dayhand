package dev.helm.planner.ui.agents

import dev.helm.planner.agents.AgentControlApi
import dev.helm.planner.agents.AgentControlTest
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.ui.today.HealthCardViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AgentsViewModelTest {
    private val sent = mutableListOf<Pair<String, JsonObject>>()
    private var mutationAnswer: (String) -> SendResult = { SendResult.Applied(JsonObject(emptyMap())) }
    private var queriesOnline = true

    private val api = AgentControlApi(
        queries = { path, _ ->
            val body = when (path) {
                AgentControlApi.LIST_APPROVALS -> AgentControlTest.APPROVALS
                AgentControlApi.GET_CONTROLS -> AgentControlTest.CONTROLS
                AgentControlApi.LIST_PROPOSALS -> AgentControlTest.PROPOSALS
                AgentControlApi.HEALTH -> AgentControlTest.HEALTH
                else -> "null"
            }
            if (queriesOnline) SendResult.Applied(Json.parseToJsonElement(body)) else SendResult.Failed("offline")
        },
        mutations = { path, args ->
            sent += path to args
            mutationAnswer(path)
        },
        newClientId = { "c1" },
    )

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `the page reads the switch, the requests, the proposals and the policies`() {
        val vm = AgentsViewModel(api = { api })
        val ui = vm.ui.value
        assertTrue((ui.controls as Section.Loaded).value.paused)
        assertEquals(listOf("ap1", "ap2"), (ui.approvals as Section.Loaded).value.map { it.id })
        assertEquals(listOf("t1", "t2"), (ui.proposals as Section.Loaded).value.map { it.id })
    }

    @Test
    fun `without a server every part says why`() {
        val vm = AgentsViewModel(api = { null })
        assertEquals(Section.Failed(unauthorized = true), vm.ui.value.controls)
        assertEquals(Section.Failed(unauthorized = true), vm.ui.value.proposals)
    }

    @Test
    fun `deciding sends the option and the note, clears the notification and returns to the list`() {
        val cancelled = mutableListOf<String>()
        val vm = AgentsViewModel(api = { api }, cancelNotification = { cancelled += it })
        vm.open(AgentsPage.Approval("ap1"))
        vm.decide("ap1", "o2", "Monday")
        assertEquals(AgentControlApi.DECIDE_APPROVAL, sent.single().first)
        assertEquals("o2", sent.single().second.getValue("optionId").jsonPrimitive.content)
        assertEquals(listOf("ap1"), cancelled)
        assertEquals(AgentsPage.Main, vm.ui.value.page)
        assertEquals(AgentsMessage.DECIDED, vm.ui.value.message)
    }

    @Test
    fun `a request decided elsewhere says so, and no connection keeps the page to try again`() {
        val vm = AgentsViewModel(api = { api })
        mutationAnswer = { SendResult.Rejected("expired") }
        vm.open(AgentsPage.Approval("ap1"))
        vm.decide("ap1", "o1", null)
        assertEquals(AgentsMessage.DECIDE_REFUSED, vm.ui.value.message)
        assertEquals(AgentsPage.Main, vm.ui.value.page)

        mutationAnswer = { SendResult.Failed("offline") }
        vm.open(AgentsPage.Proposal("t1"))
        vm.accept("t1")
        assertEquals(AgentsMessage.FAILED, vm.ui.value.message)
        assertEquals(AgentsPage.Proposal("t1"), vm.ui.value.page)
    }

    @Test
    fun `merge goes back from the task list to the proposal, then into the chosen task`() {
        val vm = AgentsViewModel(api = { api })
        vm.open(AgentsPage.Proposal("t1"))
        vm.open(AgentsPage.Merge("t1"))
        vm.back()
        assertEquals(AgentsPage.Proposal("t1"), vm.ui.value.page)
        vm.back()
        assertEquals(AgentsPage.Main, vm.ui.value.page)

        vm.merge("t1", "s2")
        assertEquals(AgentControlApi.MERGE to "s2", sent.single().let { it.first to it.second.getValue("intoTaskId").jsonPrimitive.content })
        assertEquals(AgentsMessage.MERGED, vm.ui.value.message)
    }

    @Test
    fun `pausing shows the switch at once and says when it did not work`() {
        val vm = AgentsViewModel(api = { api })
        mutationAnswer = { SendResult.Failed("offline") }
        queriesOnline = false
        vm.setPaused(false)
        assertEquals("false", sent.single().second.getValue("paused").jsonPrimitive.content)
        assertEquals(AgentsMessage.PAUSE_FAILED, vm.ui.value.message)
    }

    @Test
    fun `a rule changed on its page goes to the server and the list says so`() {
        val vm = AgentsViewModel(api = { api })
        vm.open(AgentsPage.Policy("k1", "*"))
        vm.setPolicy("k1", "*", PolicyRule.DENY)
        val (path, args) = sent.single()
        assertEquals(AgentControlApi.SET_POLICY, path)
        assertEquals(mapOf("apiKeyId" to "k1", "toolName" to "*", "rule" to "deny"), args.mapValues { it.value.jsonPrimitive.content })
        assertEquals(AgentsPage.Main, vm.ui.value.page)
        assertEquals(AgentsMessage.POLICY_SET, vm.ui.value.message)
    }

    @Test
    fun `a refused rule says why in words, and no connection keeps its page`() {
        val vm = AgentsViewModel(api = { api })
        mutationAnswer = { SendResult.Rejected("API key k1 not found", "not_found") }
        vm.open(AgentsPage.Policy("k1", "*"))
        vm.setPolicy("k1", "*", PolicyRule.ASK)
        assertEquals(AgentsMessage.POLICY_KEY_GONE, vm.ui.value.message)
        assertEquals(AgentsPage.Main, vm.ui.value.page)

        mutationAnswer = { SendResult.Rejected("Policies are for agent keys", "invalid_argument") }
        vm.open(AgentsPage.Policy("k1", "delete_task"))
        vm.setPolicy("k1", "delete_task", PolicyRule.ALLOW)
        assertEquals(AgentsMessage.POLICY_REFUSED, vm.ui.value.message)

        mutationAnswer = { SendResult.Failed("offline") }
        vm.open(AgentsPage.Policy("k1", "delete_task"))
        vm.setPolicy("k1", "delete_task", PolicyRule.ALLOW)
        assertEquals(AgentsMessage.FAILED, vm.ui.value.message)
        assertEquals(AgentsPage.Policy("k1", "delete_task"), vm.ui.value.page)
    }

    @Test
    fun `tasks to merge into are open, known to the server, by due day`() {
        val tasks = MutableStateFlow(
            listOf(
                task("a", "Zebra", "2026-10-25"),
                task("b", "apple", null),
                task("c", "Done one", "2026-10-20", status = TaskStatus.DONE),
                task("d", "Local only", "2026-10-21", serverId = null),
                task("e", "Binned", "2026-10-21", deletedAt = 5),
                task("f", "Early", "2026-10-22"),
            ),
        )
        val vm = AgentsViewModel(api = { api }, tasks = tasks)
        assertEquals(listOf("sf", "sa", "sb"), vm.ui.value.targets.map { it.serverId })
    }

    @Test
    fun `the health card reads the report, keeps it when offline and hides without a server`() {
        var connected = true
        val card = HealthCardViewModel(api = { if (connected) api else null }, now = { 10 })
        assertNull(card.health.value)
        card.refresh()
        assertEquals(2, card.health.value?.overdue)
        queriesOnline = false
        card.refresh()
        assertEquals(2, card.health.value?.overdue)
        connected = false
        card.refresh()
        assertNull(card.health.value)
    }

    private fun task(
        id: String,
        title: String,
        due: String?,
        status: TaskStatus = TaskStatus.TODO,
        serverId: String? = "s$id",
        deletedAt: Long? = null,
    ) = Task(localId = id, serverId = serverId, title = title, dueDate = due, status = status, createdAt = 0, updatedAt = 0, deletedAt = deletedAt)
}
