package dev.helm.planner.domain

import dev.helm.planner.data.local.AcceptanceItem
import dev.helm.planner.data.local.Converters
import dev.helm.planner.data.local.ProofCheck
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.RemoteTask
import dev.helm.planner.sync.SnapshotMerger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** Agent work on the phone (backend 0.10.0): read from the server, kept in Room, shown read-only. */
class AgentWorkTest {
    private val now = Instant.parse("2026-10-24T12:00:00Z").toEpochMilli()

    // A task as app:listAll sends it: numbers as JSON doubles, the claim holder with its key id.
    private val wire = """
        {"id":"s1","title":"Ship the export","status":"doing","isNow":false,"labels":[],"links":[],
         "createdAt":1.0,"updatedAt":2.0,
         "acceptance":[{"id":"a1","text":"CSV opens","met":true},{"id":"a2","text":"Docs updated","met":false}],
         "plan":"write, then test","dependsOn":["s0"],"blockedReason":"waiting",
         "proof":{"summary":"Shipped","links":[{"url":"https://example.com/pr/7","title":"PR"}],
                  "checks":[{"name":"unit tests","result":"pass","url":"https://ci.example/1"},{"name":"lint","result":"fail"}]},
         "claimedBy":{"keyId":"k1","name":"claude-code"},"claimExpiresAt":1793016600000.0}
    """.trimIndent()

    private fun task(block: Task.() -> Task = { this }) =
        Task(localId = "l1", serverId = "s1", title = "Ship", createdAt = 1, updatedAt = 1).block()

    @Test
    fun `the server's criteria, proof and claim are read and merged into the row`() {
        val remote = RemoteJson.task(Json.parseToJsonElement(wire).jsonObject)
        assertEquals(listOf(AcceptanceItem("a1", "CSV opens", true), AcceptanceItem("a2", "Docs updated", false)), remote.acceptance)
        assertEquals(
            TaskProof(
                summary = "Shipped",
                links = listOf(TaskLink("https://example.com/pr/7", "PR")),
                checks = listOf(ProofCheck("unit tests", "pass", "https://ci.example/1"), ProofCheck("lint", "fail")),
            ),
            remote.proof,
        )
        assertEquals("claude-code", remote.claimName)
        assertEquals(1_793_016_600_000L, remote.claimExpiresAt)
        val merged = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote), now).upserts.single()
        assertEquals(remote.acceptance, merged.acceptance)
        assertEquals(remote.proof, merged.proof)
        assertEquals("claude-code", merged.claimName)
    }

    @Test
    fun `a task from an older backend has none of it`() {
        val remote = RemoteJson.task(Json.parseToJsonElement("""{"id":"s2","title":"Old","status":"todo","createdAt":1,"updatedAt":1}""").jsonObject)
        assertEquals(emptyList<AcceptanceItem>(), remote.acceptance)
        assertNull(remote.proof)
        assertNull(remote.claimName)
        assertNull(remote.claimExpiresAt)
    }

    @Test
    fun `the claim shows while it lasts, in the user's time zone`() {
        val claimed = task { copy(claimName = "claude-code", claimExpiresAt = Instant.parse("2026-10-24T13:30:00Z").toEpochMilli()) }
        assertEquals(AgentWork.Claim("claude-code", "15:30"), AgentWork.activeClaim(claimed, now, "Europe/Warsaw"))
        assertEquals(AgentWork.Claim("claude-code", "13:30"), AgentWork.activeClaim(claimed, now, "UTC"))
        assertNull(AgentWork.activeClaim(claimed, Instant.parse("2026-10-24T13:30:00Z").toEpochMilli(), "UTC"))
        assertNull(AgentWork.activeClaim(claimed.copy(status = TaskStatus.DONE), now, "UTC"))
        assertNull(AgentWork.activeClaim(task(), now, "UTC"))
    }

    @Test
    fun `criteria met are counted`() {
        val withCriteria = task { copy(acceptance = listOf(AcceptanceItem("a1", "x", true), AcceptanceItem("a2", "y"))) }
        assertEquals(1 to 2, AgentWork.criteriaMet(withCriteria))
        assertEquals(0 to 0, AgentWork.criteriaMet(task()))
    }

    @Test
    fun `criteria and proof survive the Room columns`() {
        val converters = Converters()
        val items = listOf(AcceptanceItem("a1", "CSV opens", true))
        assertEquals(items, converters.acceptanceFromJson(converters.acceptanceToJson(items)))
        val proof = TaskProof(summary = "Shipped", checks = listOf(ProofCheck("ci", "pass")))
        assertEquals(proof, converters.proofFromJson(converters.proofToJson(proof)))
        assertNull(converters.proofToJson(null))
        assertEquals(emptyList<AcceptanceItem>(), converters.acceptanceFromJson("not json"))
    }
}
