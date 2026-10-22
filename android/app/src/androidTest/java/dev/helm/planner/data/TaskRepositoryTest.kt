package dev.helm.planner.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteTask
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Room: every action changes the row and queues exactly one outbox record, atomically. */
@RunWith(AndroidJUnit4::class)
class TaskRepositoryTest {
    private lateinit var db: HelmDatabase
    private lateinit var repository: TaskRepository
    private var clock = 1_000L
    private var ids = 0
    private var scheduled = 0

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        repository = TaskRepository(db, clock = { clock }, newId = { "id${++ids}" }, onOutboxChanged = { scheduled++ })
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun addWritesTheTaskAndOneOutboxRecordWithItsClientId() = runTest {
        val task = repository.add("  Call the accountant ", "2026-10-22", "09:30", " ")

        val stored = db.tasks().byLocalId(task.localId)!!
        assertEquals("Call the accountant", stored.title)
        assertEquals("09:30", stored.dueTime)
        assertNull(stored.note)
        assertNull(stored.serverId)
        val op = db.outbox().all().single()
        assertEquals(Mutations.ADD, op.mutation)
        assertEquals(task.localId, op.taskLocalId)
        val args = Json.parseToJsonElement(op.argsJson).jsonObject
        assertEquals(task.localId, args.getValue("clientId").jsonPrimitive.content)
        assertEquals("2026-10-22", args.getValue("dueDate").jsonPrimitive.content)
        assertFalse("note was blank", "note" in args)
        assertEquals(1, scheduled)
        assertEquals(1, repository.pendingChanges.first())
    }

    @Test
    fun aTimeWithoutADayIsDropped() = runTest {
        val task = repository.add("Undated", null, "10:00", null)
        assertNull(db.tasks().byLocalId(task.localId)!!.dueTime)
        assertFalse("dueTime" in Json.parseToJsonElement(db.outbox().all().single().argsJson).jsonObject)
    }

    @Test
    fun actionsChangeTheRowAndQueueInOrder() = runTest {
        val a = repository.add("A", "2026-10-20", null, null)
        clock = 2_000
        repository.complete(a.localId)
        repository.reopen(a.localId)
        repository.reschedule(a.localId, "2026-10-22")
        repository.setResumeNote(a.localId, "page 3")
        repository.archive(a.localId)

        val row = db.tasks().byLocalId(a.localId)!!
        assertEquals("2026-10-22", row.dueDate)
        assertEquals(TaskStatus.TODO, row.status)
        assertEquals("page 3", row.resumeNote)
        assertEquals(2_000L, row.archivedAt)
        val ops = db.outbox().all()
        assertEquals(
            listOf(Mutations.ADD, Mutations.COMPLETE, Mutations.SET_STATUS, Mutations.RESCHEDULE, Mutations.UPDATE, Mutations.ARCHIVE),
            ops.map { it.mutation },
        )
        assertEquals("every change has its own clientId", ops.size, ops.map { it.clientId }.toSet().size)
        assertTrue(ops.drop(1).all { op -> Json.parseToJsonElement(op.argsJson).jsonObject.getValue("clientId").jsonPrimitive.content == op.clientId })
    }

    @Test
    fun setNowKeepsASingleNowTaskAndClearNowRemovesIt() = runTest {
        val a = repository.add("A", "2026-10-22", null, null)
        val b = repository.add("B", "2026-10-22", null, null)
        repository.setNow(a.localId)
        repository.setNow(b.localId)

        assertEquals(listOf(b.localId), db.tasks().nowTasks().map { it.localId })
        assertEquals(TaskStatus.DOING, db.tasks().byLocalId(b.localId)!!.status)

        repository.clearNow()
        assertTrue(db.tasks().nowTasks().isEmpty())
        val clear = db.outbox().all().last()
        assertEquals(Mutations.SET_NOW, clear.mutation)
        assertNull(clear.taskLocalId)
        assertEquals(JsonNull, Json.parseToJsonElement(clear.argsJson).jsonObject["taskId"])
    }

    @Test
    fun anActionOnAMissingTaskChangesNothing() = runTest {
        repository.complete("nope")
        assertTrue(db.outbox().all().isEmpty())
        assertEquals(0, scheduled)
    }

    @Test
    fun aSnapshotIsMergedIntoRoomWithoutTouchingWaitingChanges() = runTest {
        val local = repository.add("Mine", "2026-10-22", null, null)
        repository.complete(local.localId)
        val serverCopy = remoteTask("s1", local.localId, title = "Mine", status = "todo")
        val fromAgent = remoteTask("s2", null, title = "From the agent", status = "todo")

        repository.applySnapshot(RemoteEvent.Snapshot(listOf(serverCopy, fromAgent), "Europe/Warsaw"))

        val mine = db.tasks().byLocalId(local.localId)!!
        assertEquals("s1", mine.serverId)
        assertEquals("local completion is still waiting, so it stays", TaskStatus.DONE, mine.status)
        assertEquals("From the agent", db.tasks().byLocalId("s2")!!.title)
    }

    private fun remoteTask(id: String, clientId: String?, title: String, status: String) = RemoteTask(
        id = id, clientId = clientId, title = title, note = null, dueDate = "2026-10-22", dueTime = null, status = status,
        isNow = false, resumeNote = null, completedAt = null, archivedAt = null, createdAt = 1, updatedAt = 5,
    )
}
