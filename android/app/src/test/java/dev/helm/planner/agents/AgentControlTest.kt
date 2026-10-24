package dev.helm.planner.agents

import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentControlTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun `an approval request as app listApprovals sends it`() {
        val list = AgentControlJson.approvals(json(APPROVALS))!!
        assertEquals(2, list.size)
        val asked = list[0]
        assertEquals("ap1", asked.id)
        assertEquals(4L, asked.taskRef)
        assertEquals("Release 2.4", asked.taskTitle)
        assertEquals("Deploy 2.4 to production", asked.action)
        assertEquals(listOf(ApprovalOption("o1", "Deploy now", "live in 10 minutes"), ApprovalOption("o2", "Wait", null)), asked.options)
        assertFalse(asked.reversible)
        assertEquals(ApprovalStatus.PENDING, asked.status)
        assertEquals("claude", asked.requestedBy)
        assertNull(asked.policyTool)
        assertNull(asked.decision)

        val held = list[1]
        assertEquals("complete_task", held.policyTool)
        assertEquals(ApprovalDecision("allow", "Allow once", "fine", 5000), held.decision)
        assertEquals(ApprovalStatus.DECIDED, held.status)
    }

    @Test
    fun `answers of another shape are not trusted`() {
        assertNull(AgentControlJson.approvals(json("[]")))
        assertEquals(emptyList<ApprovalRequest>(), AgentControlJson.approvals(json("""{"approvals":[{"id":"x"},{"id":"y","action":"a","options":[],"status":"pending"}]}""")))
        assertNull(AgentControlJson.controls(json("[]")))
        assertNull(AgentControlJson.proposals(json("{}")))
        assertNull(AgentControlJson.health(json("""{"at":1}""")))
    }

    @Test
    fun `controls, proposals and the health counts`() {
        val controls = AgentControlJson.controls(json(CONTROLS))!!
        assertTrue(controls.paused)
        assertEquals(1000L, controls.pausedAt)
        assertEquals("lunch", controls.reason)
        assertEquals(listOf(ToolPolicy("worker", "*", "ask"), ToolPolicy("worker", "delete_task", "deny")), controls.policies)

        val proposals = AgentControlJson.proposals(json(PROPOSALS))!!
        assertEquals(
            Proposal("t1", 7, "Fix checkout", "From the error", "Ann", "sentry", "CHECKOUT-42", "https://sentry.example/42", 2000),
            proposals[0],
        )
        // Only http(s) addresses open; the rest is shown without a link.
        assertNull(proposals[1].sourceUrl)
        assertNull(proposals[1].requestedBy)

        val health = AgentControlJson.health(json(HEALTH))!!
        assertEquals(
            PlanHealth(
                agentsPaused = false, overdue = 2, dueToday = 1, inProgress = 1, expiredClaims = 1, blocked = 1,
                awaitingApproval = 1, pendingApprovals = 3, proposals = 2, completedToday = 3, withoutProof = 1, oldestOpenDays = 20,
            ),
            health,
        )
    }

    @Test
    fun `decisions and proposal changes send what the app layer takes`() = runTest {
        val sent = mutableListOf<Pair<String, JsonObject>>()
        val api = AgentControlApi(
            queries = { _, _ -> SendResult.Failed("offline") },
            mutations = { path, args ->
                sent += path to args
                if (path == AgentControlApi.REJECT) SendResult.Rejected("Task not found") else SendResult.Applied(JsonObject(emptyMap()))
            },
            newClientId = { "c1" },
        )
        assertEquals(Change.Done, api.decide("ap1", "o2", "  next week "))
        assertEquals(Change.Done, api.decide("ap1", "o2", "   "))
        assertEquals(Change.Done, api.merge("t1", "t2"))
        assertEquals(Change.Refused("Task not found"), api.reject("t1", null))
        assertEquals(Change.Done, api.pause(true))
        assertEquals(Load.Failed("offline"), api.proposals())

        assertEquals(AgentControlApi.DECIDE_APPROVAL, sent[0].first)
        assertEquals("next week", sent[0].second.getValue("note").jsonPrimitive.content)
        assertFalse("note" in sent[1].second)
        assertEquals(mapOf("taskId" to "t1", "intoTaskId" to "t2", "clientId" to "c1"), sent[2].second.mapValues { it.value.jsonPrimitive.content })
        assertEquals(setOf("taskId", "clientId"), sent[3].second.keys)
        assertEquals("true", sent[4].second.getValue("paused").jsonPrimitive.content)
    }

    companion object {
        const val APPROVALS = """{"approvals":[
            {"id":"ap1","taskId":"t4","ref":4,"taskTitle":"Release 2.4","action":"Deploy 2.4 to production","detail":"Tests passed",
             "options":[{"id":"o1","label":"Deploy now","consequence":"live in 10 minutes"},{"id":"o2","label":"Wait","consequence":null}],
             "reversible":false,"status":"pending","expiresAt":90000,"createdAt":1000,"requestedBy":{"type":"agent","name":"claude"},
             "source":"agent","tool":null,"arguments":null,"used":false,"decision":null},
            {"id":"ap2","taskId":null,"ref":null,"taskTitle":null,"action":"worker wants to call complete_task","detail":null,
             "options":[{"id":"allow","label":"Allow once","consequence":null},{"id":"deny","label":"Deny","consequence":null}],
             "reversible":true,"status":"decided","expiresAt":60000,"createdAt":900,"requestedBy":{"type":"agent","name":"worker"},
             "source":"policy","tool":"complete_task","arguments":{"taskId":"#4"},"used":false,
             "decision":{"optionId":"allow","label":"Allow once","note":"fine","decidedAt":5000,"by":"app"}}]}"""

        const val CONTROLS = """{"paused":true,"pausedAt":1000,"pausedBy":"app","reason":"lunch","policies":[
            {"keyId":"k1","keyName":"worker","tool":"*","rule":"ask","updatedAt":1},
            {"keyId":"k1","keyName":"worker","tool":"delete_task","rule":"deny","updatedAt":2}]}"""

        const val PROPOSALS = """[
            {"id":"t1","ref":7,"title":"Fix checkout","note":"From the error","status":"todo","proposedAt":2000,"requestedBy":"Ann",
             "source":{"kind":"sentry","ref":"CHECKOUT-42","url":"https://sentry.example/42"}},
            {"id":"t2","title":"Read","proposedAt":1500,"source":{"kind":"mail","ref":"m1","url":"javascript:alert(1)"}}]"""

        const val HEALTH = """{"at":10,"date":"2026-10-24","timezone":"Europe/Warsaw","agentsPaused":false,
            "overdue":{"count":2,"tasks":[]},"dueToday":{"count":1,"tasks":[]},"inProgress":{"count":1,"tasks":[]},
            "expiredClaims":{"count":1,"tasks":[]},"blocked":{"count":1,"tasks":[]},
            "awaitingApproval":{"count":1,"tasks":[],"pendingApprovals":3},"proposals":{"count":2},
            "completedToday":{"count":3,"tasks":[],"withProof":2,"withoutProof":1},
            "oldestOpen":{"id":"t9","title":"Old","ageDays":20,"createdAt":0}}"""
    }
}
