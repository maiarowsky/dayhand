package dev.helm.planner.sync

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteTask
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SnapshotMergerTest {
    private val now = 1_000_000L

    private fun remote(id: String, updatedAt: Long, block: RemoteTask.() -> RemoteTask = { this }) = RemoteTask(
        id = id, clientId = null, title = "Server $id", note = null, dueDate = "2026-10-22", dueTime = null,
        status = "todo", isNow = false, resumeNote = null, completedAt = null, archivedAt = null,
        createdAt = 1, updatedAt = updatedAt,
    ).block()

    private fun row(localId: String, serverId: String?, serverUpdatedAt: Long?, block: Task.() -> Task = { this }) = Task(
        localId = localId, serverId = serverId, clientId = localId, title = "Local $localId", dueDate = "2026-10-22",
        createdAt = 1, updatedAt = now, serverUpdatedAt = serverUpdatedAt,
    ).block()

    private fun op(mutation: String, localId: String?, args: String = "{}") =
        OutboxOp(opId = "op-$mutation-$localId", mutation = mutation, argsJson = args, taskLocalId = localId, clientId = "c", createdAt = 0)

    @Test
    fun `a task created elsewhere is inserted under its server id`() {
        val plan = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote("s1", 10)), now)
        val task = plan.upserts.single()
        assertEquals("s1", task.localId)
        assertEquals("s1", task.serverId)
        assertEquals(10L, task.serverUpdatedAt)
    }

    @Test
    fun `a task created here is matched by its clientId even before the add was acknowledged`() {
        val local = row("local-1", serverId = null, serverUpdatedAt = null)
        val server = remote("s9", 10) { copy(clientId = "local-1", title = "Local local-1") }
        val plan = SnapshotMerger.merge(listOf(local), listOf(op(Mutations.ADD, "local-1")), listOf(server), now)
        val merged = plan.upserts.single()
        assertEquals("local-1", merged.localId)
        assertEquals("s9", merged.serverId)
        assertTrue(plan.deletes.isEmpty())
    }

    @Test
    fun `a claim on a newly added task is visible before and after add acknowledgment`() {
        val local = row("local-1", serverId = null, serverUpdatedAt = null)
        val server = remote("s9", 10) {
            copy(clientId = "local-1", claimName = "agent", claimExpiresAt = now + 60_000)
        }
        val pending = op(Mutations.ADD, local.localId)
        val merged = SnapshotMerger.merge(listOf(local), listOf(pending), listOf(server), now).upserts.single()
        assertEquals("agent", merged.claimName)
        assertEquals(now + 60_000, merged.claimExpiresAt)
        assertEquals(local.title, merged.title)
        assertEquals(server.updatedAt, merged.serverUpdatedAt)
        val repeated = SnapshotMerger.merge(listOf(merged), emptyList(), listOf(server), now)
        assertTrue(repeated.upserts.isEmpty())
        assertTrue(repeated.deletes.isEmpty())
    }

    @Test
    fun `fallback dirty fields do not mask server claims`() {
        val local = row("a", "s1", 10)
        val server = remote("s1", 20) { copy(claimName = "agent", claimExpiresAt = now + 60_000) }
        for (pending in listOf(op("unknown", "a"), op(Mutations.UPDATE, "a", "not json"))) {
            val merged = SnapshotMerger.merge(listOf(local), listOf(pending), listOf(server), now).upserts.single()
            assertEquals("agent", merged.claimName)
            assertEquals(now + 60_000, merged.claimExpiresAt)
            assertEquals(local.title, merged.title)
        }
    }

    @Test
    fun `fields with a change still waiting keep the local value, the others take the server's`() {
        val local = row("a", "s1", serverUpdatedAt = 10) { copy(status = TaskStatus.DONE, completedAt = 500) }
        val server = remote("s1", 20) { copy(title = "Renamed by the agent", dueDate = "2026-10-24") }
        val merged = SnapshotMerger.merge(listOf(local), listOf(op(Mutations.COMPLETE, "a")), listOf(server), now).upserts.single()
        assertEquals(TaskStatus.DONE, merged.status)
        assertEquals(500L, merged.completedAt)
        assertEquals("Renamed by the agent", merged.title)
        assertEquals("2026-10-24", merged.dueDate)
        assertEquals(20L, merged.serverUpdatedAt)
    }

    @Test
    fun `without waiting changes the newer server copy wins`() {
        val local = row("a", "s1", serverUpdatedAt = 10) { copy(dueDate = "2026-10-23") }
        val merged = SnapshotMerger.merge(listOf(local), emptyList(), listOf(remote("s1", 30)), now).upserts.single()
        assertEquals("2026-10-22", merged.dueDate)
        assertEquals("Server s1", merged.title)
    }

    @Test
    fun `an older or repeated snapshot never undoes a newer state`() {
        val local = row("a", "s1", serverUpdatedAt = 30) { copy(title = "Newest") }
        val plan = SnapshotMerger.merge(listOf(local), emptyList(), listOf(remote("s1", 20), ), now)
        assertTrue(plan.upserts.isEmpty())
        assertTrue(plan.deletes.isEmpty())
    }

    @Test
    fun `a waiting setNow keeps the now flag of every task`() {
        val target = row("a", "s1", 10) { copy(isNow = true, status = TaskStatus.DOING) }
        val previous = row("b", "s2", 10) { copy(isNow = false) }
        val server = listOf(remote("s1", 10), remote("s2", 20) { copy(isNow = true, title = "Agent edit") })
        val plan = SnapshotMerger.merge(listOf(target, previous), listOf(op(Mutations.SET_NOW, "a")), server, now)
        val b = plan.upserts.single { it.localId == "b" }
        assertEquals(false, b.isNow)
        assertEquals("Agent edit", b.title)
    }

    @Test
    fun `an update of the resume note keeps only that field local`() {
        val local = row("a", "s1", 10) { copy(resumeNote = "page 4") }
        val server = remote("s1", 20) { copy(resumeNote = "page 3", title = "New title") }
        val pending = op(Mutations.UPDATE, "a", """{"resumeNote":"page 4","clientId":"c"}""")
        val merged = SnapshotMerger.merge(listOf(local), listOf(pending), listOf(server), now).upserts.single()
        assertEquals("page 4", merged.resumeNote)
        assertEquals("New title", merged.title)
    }

    @Test
    fun `a task gone from the server is deleted unless it has waiting changes or is too fresh`() {
        val gone = row("gone", "s1", 10)
        val waiting = row("waiting", "s2", 10)
        val justAcked = row("fresh", "s3", serverUpdatedAt = null) { copy(updatedAt = now - 1_000) }
        val orphan = row("orphan", null, null) { copy(updatedAt = now - SnapshotMerger.UNSEEN_GRACE_MS - 1) }
        val plan = SnapshotMerger.merge(
            listOf(gone, waiting, justAcked, orphan),
            listOf(op(Mutations.ARCHIVE, "waiting")),
            emptyList(),
            now,
        )
        assertEquals(setOf("gone", "orphan"), plan.deletes.toSet())
    }

    @Test
    fun `repeat, links and the trash come from the server`() {
        val server = remote("s1", 10) {
            copy(
                repeat = RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 4)),
                links = listOf(TaskLink("https://example.com", "Spec")),
                deletedAt = 7,
            )
        }
        val task = SnapshotMerger.merge(emptyList(), emptyList(), listOf(server), now).upserts.single()
        assertEquals(RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 4)), task.repeat)
        assertEquals(listOf(TaskLink("https://example.com", "Spec")), task.links)
        assertEquals(7L, task.deletedAt)
    }

    @Test
    fun `a waiting link change keeps the links local and only them`() {
        val local = row("a", "s1", 10) { copy(links = listOf(TaskLink("https://mine.example")), title = "Old") }
        val server = remote("s1", 20) { copy(title = "Renamed", links = listOf(TaskLink("https://agent.example"))) }
        val pending = op(Mutations.UPDATE, "a", """{"links":[{"url":"https://mine.example"}],"clientId":"c"}""")
        val merged = SnapshotMerger.merge(listOf(local), listOf(pending), listOf(server), now).upserts.single()
        assertEquals(listOf(TaskLink("https://mine.example")), merged.links)
        assertEquals("Renamed", merged.title)
    }

    @Test
    fun `a waiting title change does not hold back the agent's note`() {
        val local = row("a", "s1", 10) { copy(title = "Mine", note = "old note") }
        val server = remote("s1", 20) { copy(title = "Agent title", note = "agent note") }
        val pending = op(Mutations.UPDATE, "a", """{"title":"Mine","clientId":"c"}""")
        val merged = SnapshotMerger.merge(listOf(local), listOf(pending), listOf(server), now).upserts.single()
        assertEquals("Mine", merged.title)
        assertEquals("agent note", merged.note)
    }

    @Test
    fun `waiting repeat and link changes stay local`() {
        val local = row("a", "s1", 10) { copy(repeat = RepeatRule(RepeatEvery.DAY), links = listOf(TaskLink("https://mine.pl"))) }
        val server = remote("s1", 20)
        val pending = listOf(
            op(Mutations.UPDATE, "a", """{"repeat":{"every":"day","interval":1},"clientId":"c"}"""),
            op(Mutations.UPDATE, "a", """{"links":[{"url":"https://mine.pl"}],"clientId":"d"}""").copy(opId = "op2"),
        )
        val merged = SnapshotMerger.merge(listOf(local), pending, listOf(server), now).upserts.single()
        assertEquals(RepeatRule(RepeatEvery.DAY), merged.repeat)
        assertEquals(listOf(TaskLink("https://mine.pl")), merged.links)
    }

    @Test
    fun `the checklist and reminders come from the server unless a change of them is waiting`() {
        val local = row("a", "s1", 10) { copy(checklist = listOf(ChecklistItem("c1", "Milk", done = true)), reminders = listOf(TaskReminder.before(5))) }
        val server = remote("s1", 20) {
            copy(title = "Agent title", checklist = listOf(ChecklistItem("c1", "Milk"), ChecklistItem("c2", "Bread")), reminders = null)
        }
        val taken = SnapshotMerger.merge(listOf(local), emptyList(), listOf(server), now).upserts.single()
        assertEquals(server.checklist, taken.checklist)
        assertNull(taken.reminders)

        val pending = listOf(
            op(Mutations.UPDATE, "a", """{"checklist":[{"id":"c1","title":"Milk","done":true}],"clientId":"c"}"""),
            op(Mutations.UPDATE, "a", """{"reminders":[{"minutesBefore":5}],"clientId":"d"}""").copy(opId = "op2"),
        )
        val kept = SnapshotMerger.merge(listOf(local), pending, listOf(server), now).upserts.single()
        assertEquals(local.checklist, kept.checklist)
        assertEquals(local.reminders, kept.reminders)
        assertEquals("Agent title", kept.title)
    }

    @Test
    fun `a task moved to the trash offline stays there until the server agrees`() {
        val local = row("a", "s1", 10) { copy(deletedAt = 500) }
        val merged = SnapshotMerger.merge(listOf(local), listOf(op(Mutations.SOFT_DELETE, "a")), listOf(remote("s1", 20)), now)
            .upserts.single()
        assertEquals(500L, merged.deletedAt)
    }

    @Test
    fun `a task restored offline is not put back in the trash by an older server copy`() {
        val local = row("a", "s1", 10) { copy(deletedAt = null) }
        val server = remote("s1", 20) { copy(deletedAt = 400, title = "Agent edit") }
        val merged = SnapshotMerger.merge(listOf(local), listOf(op(Mutations.RESTORE, "a")), listOf(server), now).upserts.single()
        assertNull(merged.deletedAt)
        assertEquals("Agent edit", merged.title)
    }

    @Test
    fun `a task trashed by the agent stays on the phone, in the trash`() {
        val local = row("a", "s1", 10)
        val plan = SnapshotMerger.merge(listOf(local), emptyList(), listOf(remote("s1", 20) { copy(deletedAt = 15) }), now)
        assertEquals(15L, plan.upserts.single().deletedAt)
        assertTrue(plan.deletes.isEmpty())
    }
}
