package dev.helm.planner.data

import android.content.Context
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The outbox lives in the database file: changes queued by one process are sent, in order,
 * by the next one after the first was killed mid-way.
 */
@RunWith(AndroidJUnit4::class)
class OutboxRestartTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "outbox-restart-test.db"

    @Before
    @After
    fun clean() {
        context.deleteDatabase(dbName)
    }

    /** A server that applies each clientId once and hands out ids in order. */
    private class Server : MutationSender {
        val applied = mutableListOf<Pair<String, String>>() // mutation to task id or title
        val clientIds = mutableSetOf<String>()
        var answer: (String) -> SendResult? = { null }

        override suspend fun send(mutation: String, args: JsonObject): SendResult {
            answer(mutation)?.let { return it }
            val clientId = args.getValue("clientId").jsonPrimitive.content
            if (clientIds.add(clientId)) {
                applied += mutation to (args["taskId"] ?: args.getValue("title")).jsonPrimitive.content
            }
            val id = if (mutation == Mutations.ADD) "srv-${args.getValue("title").jsonPrimitive.content}" else "x"
            return SendResult.Applied(buildJsonObject { put("id", id) })
        }
    }

    @Test
    fun queuedChangesSurviveTheProcessAndAreSentInOrder() = runTest {
        // Process 1: offline, the user adds two tasks and completes the first one.
        val first = HelmDatabase.open(context, dbName)
        val repository = TaskRepository(first)
        val a = repository.add("Task A", "2026-10-22", null, null)
        repository.add("Task B", "2026-10-22", null, null)
        repository.complete(a.localId)
        // The network flickers: only the first add gets through before the process dies.
        val server = Server()
        var calls = 0
        server.answer = { if (++calls > 1) SendResult.Failed("connection reset") else null }
        assertEquals(DrainResult.RETRY_LATER, OutboxProcessor(RoomOutboxStore(first), server).drain())
        first.close()

        // Process 2: a fresh database object on the same file, network back.
        val second = HelmDatabase.open(context, dbName)
        assertEquals(2, second.outbox().count())
        server.answer = { null }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(second), server).drain())

        assertEquals(
            listOf(Mutations.ADD to "Task A", Mutations.ADD to "Task B", Mutations.COMPLETE to "srv-Task A"),
            server.applied,
        )
        assertTrue(second.outbox().all().isEmpty())
        assertEquals("srv-Task A", second.tasks().byLocalId(a.localId)!!.serverId)
        second.close()
    }

    @Test
    fun anAnswerLostBeforeTheProcessDiedIsResentAndAppliedOnce() = runTest {
        val first = HelmDatabase.open(context, dbName)
        TaskRepository(first).add("Only once", null, null, null)
        val server = Server()
        val queued = first.outboxClientIds()
        // The server applies the add, but the process dies before the answer is stored.
        server.answer = { mutation ->
            server.applied += mutation to "Only once"
            server.clientIds += queued
            SendResult.Failed("killed")
        }
        OutboxProcessor(RoomOutboxStore(first), server).drain()
        first.close()

        val second = HelmDatabase.open(context, dbName)
        server.answer = { null }
        OutboxProcessor(RoomOutboxStore(second), server).drain()

        assertEquals(listOf(Mutations.ADD to "Only once"), server.applied)
        assertTrue(second.outbox().all().isEmpty())
        second.close()
    }

    @Test
    fun refusedChangeIsRolledBackByTheNextSnapshot() = runTest {
        val db = HelmDatabase.open(context, dbName)
        val repository = TaskRepository(db)
        val task = repository.add("Will be refused", null, null, null)
        OutboxProcessor(RoomOutboxStore(db), Server()).drain()
        val serverCopy = RemoteTask(
            id = "srv-Will be refused", clientId = task.localId, title = "Will be refused", note = null, dueDate = null,
            dueTime = null, status = "todo", isNow = false, resumeNote = null, completedAt = null, archivedAt = null,
            createdAt = 1, updatedAt = 5,
        )
        repository.applySnapshot(RemoteEvent.Snapshot(listOf(serverCopy), "Europe/London"))
        repository.archive(task.localId)
        val refusing = MutationSender { _, _ -> SendResult.Rejected("Task is in the trash") }
        OutboxProcessor(RoomOutboxStore(db), refusing).drain()
        assertTrue(db.outbox().all().isEmpty())

        // The server copy has not changed, yet the same snapshot now undoes the refused archive.
        repository.applySnapshot(RemoteEvent.Snapshot(listOf(serverCopy), "Europe/London"))
        assertEquals(null, db.tasks().byLocalId(task.localId)!!.archivedAt)
        db.close()
    }

    private suspend fun HelmDatabase.outboxClientIds() = outbox().all().map { it.clientId }
}
