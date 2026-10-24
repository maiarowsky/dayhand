package dev.helm.planner.ui.agents

import dev.helm.planner.agents.AgentControlApi
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * A refresh that started earlier must never show its answer over a newer one. The fake server keeps one rule and
 * one switch; a read of the controls copies them when it arrives but answers only when the test lets it, so the
 * test chooses which answer is the last to reach the phone.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AgentsRefreshRaceTest {
    private var serverRule = PolicyRule.ASK
    private var serverPaused = false
    private var holdReads = false
    private var holdMutation: CompletableDeferred<Unit>? = null
    private val pendingReads = mutableListOf<CompletableDeferred<Unit>>()

    private val api = AgentControlApi(
        queries = { path, _ ->
            val body = when (path) {
                AgentControlApi.GET_CONTROLS -> controlsBody().also { if (holdReads) hold() }
                AgentControlApi.LIST_APPROVALS -> """{"approvals":[]}"""
                AgentControlApi.LIST_PROPOSALS -> "[]"
                else -> "null"
            }
            SendResult.Applied(Json.parseToJsonElement(body))
        },
        mutations = { path, args ->
            holdMutation?.await()
            when (path) {
                AgentControlApi.SET_POLICY -> serverRule = PolicyRule.of(args.getValue("rule").jsonPrimitive.content)!!
                AgentControlApi.PAUSE -> serverPaused = args.getValue("paused").jsonPrimitive.boolean
            }
            SendResult.Applied(JsonObject(emptyMap()))
        },
    )

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `a rule stays disabled until the refresh after it has finished`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.setPolicy("k1", "delete_task", PolicyRule.DENY)
        assertTrue(vm.ui.value.busy)
        answerReadsNewestFirst()
        assertFalse(vm.ui.value.busy)
        assertEquals(PolicyRule.DENY, vm.shownRule())
    }

    @Test
    fun `a second rule while the first one refreshes never leaves an older rule on the page`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.setPolicy("k1", "delete_task", PolicyRule.DENY)
        vm.setPolicy("k1", "delete_task", PolicyRule.ALLOW)
        answerReadsNewestFirst()
        assertEquals(serverRule, vm.shownRule())
        assertFalse(vm.ui.value.busy)
    }

    @Test
    fun `a reload that began before a rule was set cannot bring the old rule back`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.reload()
        vm.setPolicy("k1", "delete_task", PolicyRule.DENY)
        answerReadsNewestFirst()
        assertEquals(PolicyRule.DENY, serverRule)
        assertEquals(PolicyRule.DENY, vm.shownRule())
    }

    @Test
    fun `flipping the switch again while it refreshes never leaves the older position on the page`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.setPaused(true)
        vm.setPaused(false)
        answerReadsNewestFirst()
        assertEquals(serverPaused, vm.shownPaused())
        assertFalse(vm.ui.value.busy)
    }

    @Test
    fun `a reload that began before the switch was flipped cannot undo it while the change is on its way`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.reload()
        holdMutation = CompletableDeferred()
        vm.setPaused(true)
        assertTrue(vm.shownPaused())

        // The reload read the switch off; its answer arrives while the change is still being sent.
        answerReadsNewestFirst()
        assertTrue(vm.shownPaused())

        holdMutation?.complete(Unit)
        answerReadsNewestFirst()
        assertTrue(serverPaused)
        assertTrue(vm.shownPaused())
        assertFalse(vm.ui.value.busy)
    }

    @Test
    fun `a reload that began before the switch was flipped cannot undo it after the change`() {
        val vm = AgentsViewModel(api = { api })
        holdReads = true
        vm.reload()
        vm.setPaused(true)
        answerReadsNewestFirst()
        assertTrue(serverPaused)
        assertTrue(vm.shownPaused())
    }

    private fun controlsBody() =
        """{"paused":$serverPaused,"pausedBy":"app","reason":null,"policies":""" +
            """[{"keyId":"k1","keyName":"worker","tool":"delete_task","rule":"${serverRule.wire}","updatedAt":1}]}"""

    private suspend fun hold() = CompletableDeferred<Unit>().also { pendingReads += it }.await()

    /** Answers the reads that wait, the latest one first, until none is left (an answer can start another read). */
    private fun answerReadsNewestFirst() {
        while (pendingReads.isNotEmpty()) pendingReads.removeAt(pendingReads.lastIndex).complete(Unit)
    }

    private fun AgentsViewModel.shownRule() =
        (ui.value.controls as Section.Loaded).value.policies.single { it.tool == "delete_task" }.rule

    private fun AgentsViewModel.shownPaused() = (ui.value.controls as Section.Loaded).value.paused
}
