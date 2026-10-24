package dev.helm.planner.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteHistoryEntry
import dev.helm.planner.data.remote.RemoteTask
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Board moves and details edits: each one changes the row and queues one server mutation. */
@RunWith(AndroidJUnit4::class)
class TaskEditingTest {
    private lateinit var db: HelmDatabase
    private lateinit var repository: TaskRepository
    private var clock = 1_000L
    private var ids = 0

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        repository = TaskRepository(db, clock = { clock }, newId = { "id${++ids}" })
    }

    @After
    fun tearDown() = db.close()

    private suspend fun lastArgs(): JsonObject = Json.parseToJsonElement(db.outbox().all().last().argsJson).jsonObject

    @Test
    fun boardMovesUseSetStatusAndComplete() = runTest {
        val a = repository.add("A", null, null, null)
        repository.setNow(a.localId)
        repository.moveTo(a.localId, TaskStatus.TODO)
        var row = db.tasks().byLocalId(a.localId)!!
        assertEquals(TaskStatus.TODO, row.status)
        assertFalse("leaving in progress ends now", row.isNow)

        repository.moveTo(a.localId, TaskStatus.DOING)
        assertEquals(TaskStatus.DOING, db.tasks().byLocalId(a.localId)!!.status)
        assertEquals("doing", lastArgs().getValue("status").jsonPrimitive.content)

        clock = 2_000
        repository.moveTo(a.localId, TaskStatus.DONE)
        row = db.tasks().byLocalId(a.localId)!!
        assertEquals(TaskStatus.DONE, row.status)
        assertEquals(2_000L, row.completedAt)

        repository.moveTo(a.localId, TaskStatus.DONE)
        assertEquals(
            listOf(Mutations.ADD, Mutations.SET_NOW, Mutations.SET_STATUS, Mutations.SET_STATUS, Mutations.COMPLETE),
            db.outbox().all().map { it.mutation },
        )
    }

    @Test
    fun detailEditsSendOnlyTheChangedField() = runTest {
        val a = repository.add("A", "2026-10-22", "09:00", null)

        repository.rename(a.localId, "  Call the accountant ")
        assertEquals(setOf("title", "clientId"), lastArgs().keys)
        assertEquals("Call the accountant", db.tasks().byLocalId(a.localId)!!.title)

        repository.setNote(a.localId, "Ask about VAT")
        assertEquals("Ask about VAT", lastArgs().getValue("note").jsonPrimitive.content)
        repository.setNote(a.localId, "  ")
        assertEquals(JsonNull, lastArgs()["note"])
        assertNull(db.tasks().byLocalId(a.localId)!!.note)

        repository.setDue(a.localId, "2026-10-24", null)
        assertEquals("2026-10-24", lastArgs().getValue("dueDate").jsonPrimitive.content)
        assertEquals("a day without a time clears the time", JsonNull, lastArgs()["dueTime"])
        repository.setDue(a.localId, null, "10:00")
        var row = db.tasks().byLocalId(a.localId)!!
        assertNull(row.dueDate)
        assertNull(row.dueTime)

        repository.setRepeat(a.localId, RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 3)))
        val repeat = lastArgs().getValue("repeat").jsonObject
        assertEquals("week", repeat.getValue("every").jsonPrimitive.content)
        assertEquals("the server requires interval, even 1", 1, repeat.getValue("interval").jsonPrimitive.int)
        assertEquals(2, repeat.getValue("weekdays").jsonArray.size)
        repository.setRepeat(a.localId, null)
        assertEquals(JsonNull, lastArgs()["repeat"])

        repository.setLabels(a.localId, listOf(" Dayhand", "home", "Dayhand"))
        assertEquals(listOf("Dayhand", "home"), lastArgs().getValue("labels").jsonArray.map { it.jsonPrimitive.content })

        repository.setLinks(a.localId, listOf(TaskLink("https://example.com", "Spec")))
        val link = lastArgs().getValue("links").jsonArray.single().jsonObject
        assertEquals("https://example.com", link.getValue("url").jsonPrimitive.content)

        row = db.tasks().byLocalId(a.localId)!!
        assertEquals(listOf("Dayhand", "home"), row.labels)
        assertEquals(listOf(TaskLink("https://example.com", "Spec")), row.links)
        assertTrue(db.outbox().all().drop(1).all { it.mutation == Mutations.UPDATE })
    }

    @Test
    fun aCalendarDropAndItsUndoQueueTheDayAndTime() = runTest {
        val a = repository.add("A", "2026-10-22", null, null)
        val before = db.outbox().count()

        // Dragged from the band into the hours of the next day, then Undo.
        repository.setDue(a.localId, "2026-10-23", "10:15")
        var row = db.tasks().byLocalId(a.localId)!!
        assertEquals("2026-10-23", row.dueDate)
        assertEquals("10:15", row.dueTime)
        assertEquals("10:15", lastArgs().getValue("dueTime").jsonPrimitive.content)
        repository.setDue(a.localId, "2026-10-22", null)
        row = db.tasks().byLocalId(a.localId)!!
        assertEquals("2026-10-22", row.dueDate)
        assertNull(row.dueTime)
        assertEquals(JsonNull, lastArgs()["dueTime"])
        assertEquals(listOf(Mutations.UPDATE, Mutations.UPDATE), db.outbox().all().drop(before).map { it.mutation })
    }

    @Test
    fun invalidEditsNeverReachTheOutbox() = runTest {
        val a = repository.add("A", null, null, null)
        val before = db.outbox().count()
        assertThrows(IllegalArgumentException::class.java) { kotlinx.coroutines.runBlocking { repository.rename(a.localId, " ") } }
        assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking { repository.setLinks(a.localId, listOf(TaskLink("example.com"))) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking { repository.setRepeat(a.localId, RepeatRule(RepeatEvery.DAY, 0)) }
        }
        assertEquals(before, db.outbox().count())
    }

    @Test
    fun checklistEditsSendTheWholeListInItsOrder() = runTest {
        val a = repository.add("Shopping", null, null, null)
        repository.addItem(a.localId, "Milk")
        repository.addItem(a.localId, "Bread")
        repository.addItem(a.localId, "Eggs")
        var items = db.tasks().byLocalId(a.localId)!!.checklist
        assertEquals(listOf("Milk", "Bread", "Eggs"), items.map { it.title })
        val (milk, bread, eggs) = items.map { it.id }

        repository.toggleItem(a.localId, bread)
        var sent = lastArgs().getValue("checklist").jsonArray.map { it.jsonObject }
        assertEquals(listOf(false, true, false), sent.map { it.getValue("done").jsonPrimitive.boolean })
        assertEquals(listOf(milk, bread, eggs), sent.map { it.getValue("id").jsonPrimitive.content })

        repository.moveItem(a.localId, eggs, -1)
        repository.renameItem(a.localId, milk, "Oat milk")
        repository.removeItem(a.localId, bread)
        items = db.tasks().byLocalId(a.localId)!!.checklist
        assertEquals(listOf("Oat milk", "Eggs"), items.map { it.title })
        sent = lastArgs().getValue("checklist").jsonArray.map { it.jsonObject }
        assertEquals(listOf("Oat milk", "Eggs"), sent.map { it.getValue("title").jsonPrimitive.content })

        // Nothing to move or tick: no new change is queued.
        val before = db.outbox().count()
        repository.moveItem(a.localId, milk, -1)
        repository.toggleItem(a.localId, "missing")
        assertEquals(before, db.outbox().count())
        assertTrue(db.outbox().all().all { it.mutation == Mutations.ADD || it.mutation == Mutations.UPDATE })
    }

    @Test
    fun remindersEditsSendOwnNoneOrBackToTheDefaults() = runTest {
        val a = repository.add("Dentist", "2026-10-22", "13:15", null)
        repository.setReminders(a.localId, listOf(TaskReminder.before(60), TaskReminder.at("18:00", 1)))
        assertEquals(
            Json.parseToJsonElement("""[{"minutesBefore":60},{"time":"18:00","daysBefore":1}]"""),
            lastArgs().getValue("reminders"),
        )
        assertEquals(2, db.tasks().byLocalId(a.localId)!!.reminders!!.size)

        repository.setReminders(a.localId, emptyList())
        assertEquals(0, lastArgs().getValue("reminders").jsonArray.size)
        assertEquals(emptyList<TaskReminder>(), db.tasks().byLocalId(a.localId)!!.reminders)

        repository.setReminders(a.localId, null)
        assertEquals(JsonNull, lastArgs()["reminders"])
        assertNull(db.tasks().byLocalId(a.localId)!!.reminders)

        val before = db.outbox().count()
        assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking { repository.setReminders(a.localId, (1..6).map(TaskReminder::before)) }
        }
        assertEquals(before, db.outbox().count())
    }

    @Test
    fun trashAndRestore() = runTest {
        val a = repository.add("A", null, null, null)
        repository.setNow(a.localId)
        clock = 5_000
        repository.moveToTrash(a.localId)
        var row = db.tasks().byLocalId(a.localId)!!
        assertEquals(5_000L, row.deletedAt)
        assertFalse(row.isNow)

        val queued = db.outbox().count()
        repository.rename(a.localId, "Edited in the trash")
        assertEquals("a task in the trash cannot be edited", queued, db.outbox().count())

        repository.restore(a.localId)
        row = db.tasks().byLocalId(a.localId)!!
        assertNull(row.deletedAt)
        assertEquals(listOf(Mutations.SOFT_DELETE, Mutations.RESTORE), db.outbox().all().takeLast(2).map { it.mutation })
        assertEquals(1, repository.pendingChangesFor(a.localId).first().coerceAtMost(1))
    }

    @Test
    fun restoreOfAnArchivedTaskBringsItBack() = runTest {
        val a = repository.add("A", null, null, null)
        repository.archive(a.localId)
        repository.restore(a.localId)
        assertNull(db.tasks().byLocalId(a.localId)!!.archivedAt)
    }

    @Test
    fun theTrashComesWithTheSnapshotAndHistoryIsCachedPerTask() = runTest {
        val trashed = RemoteTask(
            id = "s1", clientId = null, title = "Old", note = null, dueDate = null, dueTime = null, status = "todo",
            isNow = false, resumeNote = null, completedAt = null, archivedAt = null, createdAt = 1, updatedAt = 5,
            labels = listOf("home"), deletedAt = 4,
        )
        repository.applySnapshot(RemoteEvent.Snapshot(listOf(trashed), "Europe/Warsaw"))
        val row = db.tasks().byLocalId("s1")!!
        assertEquals(4L, row.deletedAt)
        assertEquals(listOf("home"), row.labels)

        repository.saveHistory("s1", listOf(RemoteHistoryEntry(9, "agent", "delete", null, """{"deletedAt":4}""")))
        repository.saveHistory("s1", listOf(RemoteHistoryEntry(9, "agent", "delete", null, """{"deletedAt":4}""")))
        assertEquals(listOf("agent"), repository.history("s1").first().map { it.actor })

        repository.applySnapshot(RemoteEvent.Snapshot(emptyList(), "Europe/Warsaw"))
        assertNull("purged on the server", db.tasks().byLocalId("s1"))
        assertTrue("history of a purged task goes too", repository.history("s1").first().isEmpty())
    }
}
