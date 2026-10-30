package dev.helm.planner.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteTask
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import dev.helm.planner.data.local.TaskStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ClaimReconciliationTest {
    private lateinit var db: HelmDatabase
    private lateinit var repository: TaskRepository
    private val now = 1_000_000L
    private val initial = RemoteTask(
        id = "s1", clientId = null, title = "Ship", note = null, dueDate = null, dueTime = null,
        status = "todo", isNow = false, resumeNote = null, completedAt = null, archivedAt = null,
        createdAt = 1, updatedAt = 10, claimName = "first-agent", claimExpiresAt = now + 60_000,
    )

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        repository = TaskRepository(db, clock = { now })
    }

    @After
    fun tearDown() = db.close()

    private class Server(var task: RemoteTask, var loseAnswer: Boolean = true) : MutationSender {
        private val clientIds = mutableSetOf<String>()
        val applications: Int get() = clientIds.size

        override suspend fun send(mutation: String, args: JsonObject): SendResult {
            assertEquals(Mutations.RELEASE, mutation)
            assertEquals(task.id, args.getValue("taskId").jsonPrimitive.content)
            if (clientIds.add(args.getValue("clientId").jsonPrimitive.content)) {
                task = task.copy(updatedAt = task.updatedAt + 1, claimName = null, claimExpiresAt = null)
            }
            return if (loseAnswer) SendResult.Failed("answer lost") else SendResult.Applied(buildJsonObject { put("id", task.id) })
        }
    }

    private class CompletingServer(var task: RemoteTask, var loseAnswer: Boolean = true) : MutationSender {
        private val clientIds = mutableSetOf<String>()
        val applications: Int get() = clientIds.size

        override suspend fun send(mutation: String, args: JsonObject): SendResult {
            assertEquals(Mutations.COMPLETE, mutation)
            assertEquals(task.id, args.getValue("taskId").jsonPrimitive.content)
            if (clientIds.add(args.getValue("clientId").jsonPrimitive.content) && task.status != "done") {
                task = task.copy(status = "done", completedAt = task.updatedAt + 1, updatedAt = task.updatedAt + 1, claimName = null, claimExpiresAt = null)
            }
            return if (loseAnswer) SendResult.Failed("answer lost") else SendResult.Applied(buildJsonObject { put("id", task.id) })
        }
    }

    private suspend fun snapshot(task: RemoteTask) = repository.applySnapshot(RemoteEvent.Snapshot(listOf(task), "UTC"))

    @Test
    fun aNewClaimMaskedDuringALostReleaseAnswerReturnsAfterAcknowledgment() = runTest {
        snapshot(initial)
        repository.release(initial.id)
        val server = Server(initial)
        val processor = OutboxProcessor(RoomOutboxStore(db), server)
        assertEquals(DrainResult.RETRY_LATER, processor.drain())
        assertNull(server.task.claimName)
        assertNull(server.task.claimExpiresAt)
        assertEquals(1, db.outbox().count())

        server.task = server.task.copy(updatedAt = 12, claimName = "next-agent", claimExpiresAt = now + 120_000)
        snapshot(server.task)
        val masked = db.tasks().byLocalId(initial.id)!!
        assertNull(masked.claimName)
        assertNull(masked.claimExpiresAt)
        assertEquals(server.task.updatedAt, masked.serverUpdatedAt)

        server.loseAnswer = false
        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(1, server.applications)
        assertEquals(0, db.outbox().count())
        assertNull(db.tasks().byLocalId(initial.id)!!.serverUpdatedAt)
        snapshot(server.task)
        val reconciled = db.tasks().byLocalId(initial.id)!!
        assertEquals("next-agent", reconciled.claimName)
        assertEquals(server.task.claimExpiresAt, reconciled.claimExpiresAt)
        assertEquals(server.task.updatedAt, reconciled.serverUpdatedAt)
    }

    @Test
    fun aClaimTakenAfterAReopenReturnsOnceARetriedEmptyCompletionIsAcknowledged() = runTest {
        snapshot(initial)
        repository.complete(initial.id)
        val server = CompletingServer(initial.copy(status = "done", completedAt = 11, updatedAt = 11, claimName = null, claimExpiresAt = null))
        val processor = OutboxProcessor(RoomOutboxStore(db), server)
        assertEquals(DrainResult.RETRY_LATER, processor.drain())
        assertEquals(1, server.applications)
        assertEquals(1, db.outbox().count())

        server.task = server.task.copy(status = "todo", completedAt = null, updatedAt = 13, claimName = "next-agent", claimExpiresAt = now + 120_000)
        snapshot(server.task)
        val masked = db.tasks().byLocalId(initial.id)!!
        assertEquals(TaskStatus.DONE, masked.status)
        assertEquals(server.task.updatedAt, masked.serverUpdatedAt)

        server.loseAnswer = false
        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(1, server.applications)
        assertEquals("todo", server.task.status)
        assertEquals(0, db.outbox().count())
        assertNull(db.tasks().byLocalId(initial.id)!!.serverUpdatedAt)
        snapshot(server.task)
        val reconciled = db.tasks().byLocalId(initial.id)!!
        assertEquals(TaskStatus.TODO, reconciled.status)
        assertEquals("next-agent", reconciled.claimName)
        assertEquals(server.task.claimExpiresAt, reconciled.claimExpiresAt)
        assertEquals(server.task.updatedAt, reconciled.serverUpdatedAt)
    }

    @Test
    fun anAcknowledgedReleaseAcceptsTheSameSnapshotWithoutUndoingAPendingRename() = runTest {
        snapshot(initial)
        repository.release(initial.id)
        val server = Server(initial, loseAnswer = false)
        val processor = OutboxProcessor(RoomOutboxStore(db), server)
        snapshot(server.task.copy(updatedAt = 11, claimName = null, claimExpiresAt = null))
        assertEquals(DrainResult.DONE, processor.drain())
        assertNull(db.tasks().byLocalId(initial.id)!!.serverUpdatedAt)

        repository.rename(initial.id, "My title")
        snapshot(server.task)
        val reconciled = db.tasks().byLocalId(initial.id)!!
        assertNull(reconciled.claimName)
        assertNull(reconciled.claimExpiresAt)
        assertEquals("My title", reconciled.title)
        assertEquals(server.task.updatedAt, reconciled.serverUpdatedAt)
        assertEquals(Mutations.UPDATE, db.outbox().all().single().mutation)
    }
}
