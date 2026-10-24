package dev.helm.planner.domain

import dev.helm.planner.data.local.AcceptanceItem
import dev.helm.planner.data.local.Converters
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
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
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Agent work on the phone (backend 0.10.0): read from the server, kept in Room, shown read-only. */
class AgentWorkTest {
    private val now = Instant.parse("2026-10-24T12:00:00Z").toEpochMilli()

    // A task as app:listAll sends it: numbers as JSON doubles, the claim holder with its key id.
    private val wire = """
        {"id":"s1","title":"Ship the export","status":"doing","isNow":false,"labels":[],"links":[],
         "createdAt":1.0,"updatedAt":2.0,"ref":12.0,
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
        assertNull(remote.ref)
        assertNull(remote.plan)
        assertEquals(emptyList<String>(), remote.dependsOn)
        assertNull(remote.blockedReason)
    }

    @Test
    fun `the number, plan, dependencies and blocked reason are read and merged into the row`() {
        val remote = RemoteJson.task(Json.parseToJsonElement(wire).jsonObject)
        assertEquals(12L, remote.ref)
        assertEquals("write, then test", remote.plan)
        assertEquals(listOf("s0"), remote.dependsOn)
        assertEquals("waiting", remote.blockedReason)
        val merged = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote), now).upserts.single()
        assertEquals(12L, merged.ref)
        assertEquals("write, then test", merged.plan)
        assertEquals(listOf("s0"), merged.dependsOn)
        assertEquals("waiting", merged.blockedReason)
        // Cleared on the server: the next snapshot clears them on the phone too.
        val cleared = remote.copy(updatedAt = 3, plan = null, dependsOn = emptyList(), blockedReason = null)
        val again = SnapshotMerger.merge(listOf(merged), emptyList(), listOf(cleared), now).upserts.single()
        assertNull(again.plan)
        assertEquals(emptyList<String>(), again.dependsOn)
        assertNull(again.blockedReason)
    }

    @Test
    fun `an ended claim waiting in the outbox is not brought back by a snapshot`() {
        val remote = RemoteJson.task(Json.parseToJsonElement(wire).jsonObject)
        val released = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote), now).upserts.single()
            .copy(claimName = null, claimExpiresAt = null)
        val pending = OutboxOp(opId = "r", mutation = Mutations.RELEASE, argsJson = "{}", taskLocalId = released.localId, clientId = "r", createdAt = 0)
        val newer = remote.copy(updatedAt = 3, title = "Renamed by the agent")
        val merged = SnapshotMerger.merge(listOf(released), listOf(pending), listOf(newer), now).upserts.single()
        assertNull(merged.claimName)
        assertNull(merged.claimExpiresAt)
        assertEquals("Renamed by the agent", merged.title)
        // Once the server has it, the server's word counts again.
        val after = SnapshotMerger.merge(listOf(merged), emptyList(), listOf(newer.copy(updatedAt = 4, claimName = null, claimExpiresAt = null)), now)
        assertNull(after.upserts.single().claimName)
    }

    @Test
    fun `dependencies are named from the phone's tasks, with how far each one is`() {
        val open = task { copy(localId = "l2", serverId = "s2", ref = 14, title = "Pay the VAT") }
        val done = task { copy(localId = "l3", serverId = "s3", ref = 12, title = "Send the invoice", status = TaskStatus.DONE) }
        val trashed = task { copy(localId = "l4", serverId = "s4", ref = 9, title = "Old draft", deletedAt = 5) }
        val waiting = task { copy(dependsOn = listOf("s3", "s2", "s4", "not-on-phone")) }
        val byServerId = listOf(open, done, trashed).associateBy { it.serverId!! }
        assertEquals(
            listOf(
                AgentWork.Dependency(12, "Send the invoice", AgentWork.DependencyState.DONE),
                AgentWork.Dependency(14, "Pay the VAT", AgentWork.DependencyState.OPEN),
                AgentWork.Dependency(9, "Old draft", AgentWork.DependencyState.IN_TRASH),
                AgentWork.Dependency(null, null, AgentWork.DependencyState.MISSING),
            ),
            AgentWork.dependencies(waiting, byServerId),
        )
    }

    @Test
    fun `the phone marks a task blocked by its reason or a known open dependency`() {
        val open = task { copy(localId = "l2", serverId = "s2", title = "Pay the VAT") }
        val done = open.copy(status = TaskStatus.DONE)
        val waiting = task { copy(dependsOn = listOf("s2", "gone")) }
        assertEquals(AgentWork.Blocked(null, 1), AgentWork.blocked(waiting, mapOf("s2" to open)))
        assertNull(AgentWork.blocked(waiting, mapOf("s2" to done)))
        assertNull(AgentWork.blocked(waiting, mapOf("s2" to open.copy(deletedAt = 5))))
        assertEquals(AgentWork.Blocked("waiting for the client", 0), AgentWork.blocked(task { copy(blockedReason = "waiting for the client") }, emptyMap()))
        assertEquals(AgentWork.Blocked("why", 1), AgentWork.blocked(waiting.copy(blockedReason = "why"), mapOf("s2" to open)))
        // A done task is not blocked any more, whatever its fields say.
        assertNull(AgentWork.blocked(waiting.copy(status = TaskStatus.DONE, blockedReason = "why"), mapOf("s2" to open)))
        assertNull(AgentWork.blocked(task(), emptyMap()))

        val all = AgentWork.blockedTasks(listOf(open, waiting, task { copy(localId = "l9", serverId = "s9") }))
        assertEquals(mapOf("l1" to AgentWork.Blocked(null, 1)), all)
        assertTrue(AgentWork.blockedTasks(emptyList()).isEmpty())
    }

    @Test
    fun `dependencies absent from the phone remain unknown and do not add blocked marks`() {
        val waiting = task { copy(dependsOn = listOf("proposal", "purged")) }
        assertEquals(
            List(2) { AgentWork.Dependency(null, null, AgentWork.DependencyState.MISSING) },
            AgentWork.dependencies(waiting, emptyMap()),
        )
        assertNull(AgentWork.blocked(waiting, emptyMap()))
        assertTrue(AgentWork.blockedTasks(listOf(waiting)).isEmpty())
        assertEquals(
            mapOf(waiting.localId to AgentWork.Blocked("waiting for approval", 0)),
            AgentWork.blockedTasks(listOf(waiting.copy(blockedReason = "waiting for approval"))),
        )
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
        assertEquals(listOf("s1", "s2"), converters.labelsFromJson(converters.labelsToJson(listOf("s1", "s2"))))
    }
}
