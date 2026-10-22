package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteTask
import org.junit.Assert.assertEquals
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
}
