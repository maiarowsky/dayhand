package dev.helm.planner.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.backup.BackupRead
import dev.helm.planner.backup.BackupSettings
import dev.helm.planner.backup.BackupTask
import dev.helm.planner.backup.PlanBackup
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.sample.SamplePlan
import java.time.LocalDate
import java.time.ZoneId
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

/** On this phone only: repeats made on the phone, the sample plan, restoring a backup and emptying the phone. */
@RunWith(AndroidJUnit4::class)
class LocalModeTest {
    private lateinit var db: HelmDatabase
    private var clock = 1_000L
    private var ids = 0
    private var today: String? = "2026-10-23"

    private fun repository() = TaskRepository(db, clock = { clock }, newId = { "id${++ids}" }, repeatsOnPhone = { today })

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
    }

    @After
    fun tearDown() = db.close()

    private suspend fun ops() = db.outbox().all()
    private fun args(json: String) = Json.parseToJsonElement(json).jsonObject

    @Test
    fun withoutAServerTheNextOccurrenceIsMadeOnThePhone() = runTest {
        val repository = repository()
        val task = repository.add("Water the plants", "2026-10-21", "08:00", null)
        repository.setRepeat(task.localId, RepeatRule(RepeatEvery.DAY, interval = 3))
        repository.addItem(task.localId, "Kitchen")
        repository.toggleItem(task.localId, db.tasks().byLocalId(task.localId)!!.checklist.single().id)

        repository.complete(task.localId)

        val done = db.tasks().byLocalId(task.localId)!!
        assertEquals(TaskStatus.DONE, done.status)
        assertNull("the done task gives up its rule", done.repeat)
        val next = db.tasks().all().single { it.localId != task.localId }
        // From the due date (21st), every 3 days, the first date after today (23rd).
        assertEquals("2026-10-24", next.dueDate)
        assertEquals("08:00", next.dueTime)
        assertEquals(RepeatRule(RepeatEvery.DAY, interval = 3), next.repeat)
        assertEquals(listOf(false), next.checklist.map { it.done })
        assertEquals(next.localId, next.clientId)

        // The server, once connected, gets: no rule on the done task, then done, then the next task with the rule.
        val tail = ops().takeLast(4)
        assertEquals(listOf(Mutations.UPDATE, Mutations.UPDATE, Mutations.COMPLETE, Mutations.ADD), tail.map { it.mutation })
        assertEquals(JsonNull, args(tail[1].argsJson).getValue("repeat"))
        val add = args(tail[3].argsJson)
        assertEquals(next.localId, add.getValue("clientId").jsonPrimitive.content)
        assertEquals("2026-10-24", add.getValue("dueDate").jsonPrimitive.content)
        assertEquals("day", add.getValue("repeat").jsonObject.getValue("every").jsonPrimitive.content)
        assertEquals(next.localId, tail[3].taskLocalId)
    }

    @Test
    fun aSeriesThatEndedAddsNothingButStillLosesItsRule() = runTest {
        val repository = repository()
        val task = repository.add("Last time", "2026-10-23", null, null)
        repository.setRepeat(task.localId, RepeatRule(RepeatEvery.WEEK, count = 1))
        repository.complete(task.localId)
        assertEquals(1, db.tasks().all().size)
        assertEquals(listOf(Mutations.UPDATE, Mutations.COMPLETE), ops().takeLast(2).map { it.mutation })
    }

    @Test
    fun withAServerTheServerMakesTheNextOccurrence() = runTest {
        today = null
        val repository = repository()
        val task = repository.add("Stand-up", "2026-10-23", "10:00", null)
        repository.setRepeat(task.localId, RepeatRule(RepeatEvery.DAY))
        repository.complete(task.localId)
        assertEquals(1, db.tasks().all().size)
        assertEquals(RepeatRule(RepeatEvery.DAY), db.tasks().byLocalId(task.localId)!!.repeat)
        assertEquals(Mutations.COMPLETE, ops().last().mutation)
    }

    @Test
    fun sampleTasksStayOnThePhone() = runTest {
        val repository = repository()
        val zone = ZoneId.of("Europe/Warsaw")
        val plan = SamplePlan.tasks(LocalDate.parse("2026-10-23"), clock, zone) { it.name }
        repository.loadSample(plan, SamplePlan.projects(clock) { it.name })
        assertTrue(repository.hasSample.first())
        assertEquals(0, ops().size)

        val standup = plan.single { it.title == "STANDUP" }
        repository.rename(standup.localId, "Daily stand-up")
        repository.complete(standup.localId)
        repository.setNow(plan.single { it.title == "DENTIST" }.localId)
        // The next stand-up is a sample task too.
        assertTrue(db.tasks().all().filter { it.title == "Daily stand-up" }.all { SamplePlan.isSample(it.localId) })
        assertEquals(plan.size + 1, db.tasks().all().size)
        assertEquals(0, ops().size)

        val mine = repository.add("My own task", null, null, null)
        assertEquals(listOf(mine.localId), repository.backupSnapshot().tasks.map { it.localId })
        repository.setNow(mine.localId)
        val queued = ops().size
        repository.setNow(plan.single { it.title == "DENTIST" }.localId)
        // Only "no task is now" reaches a server, so it does not keep the own task as "now".
        val op = ops().drop(queued).single()
        assertEquals(Mutations.SET_NOW, op.mutation)
        assertNull(op.taskLocalId)

        repository.removeSample()
        assertFalse(repository.hasSample.first())
        assertEquals(listOf(mine.localId), db.tasks().all().map { it.localId })
    }

    @Test
    fun aRestoreAddsEachTaskOnceAndQueuesIt() = runTest {
        val repository = repository()
        val existing = repository.add("Already here", null, null, null)
        val backup = listOf(
            BackupTask(id = "b1", title = "In progress", status = TaskStatus.DOING, labels = listOf("Work"), checklist = listOf(ChecklistItem("c", "One"))),
            BackupTask(id = "b2", title = "Done weekly", status = TaskStatus.DONE, completedAt = 500, repeat = RepeatRule(RepeatEvery.WEEK)),
            BackupTask(id = "b3", title = "Archived", archivedAt = 600),
            BackupTask(id = existing.localId, title = "Already here"),
            BackupTask(id = "b1", title = "Twice in the file"),
            BackupTask(id = "import-0a1b", title = "Without an id in the file"),
        )
        val before = ops().size

        assertEquals(RestoreResult(added = 4, alreadyHere = 2), repository.restore(backup))

        val doing = db.tasks().byLocalId("b1")!!
        assertEquals(TaskStatus.DOING, doing.status)
        assertEquals("b1", doing.clientId)
        val done = db.tasks().byLocalId("b2")!!
        assertEquals(500L, done.completedAt)
        assertNull("a done task's rule would make the server add its next date again", done.repeat)
        val queued = ops().drop(before)
        assertEquals(
            listOf(Mutations.ADD, Mutations.ADD, Mutations.COMPLETE, Mutations.ADD, Mutations.ARCHIVE, Mutations.ADD),
            queued.map { it.mutation },
        )
        val doingArgs = args(queued[0].argsJson)
        assertEquals("doing", doingArgs.getValue("status").jsonPrimitive.content)
        assertEquals("b1", doingArgs.getValue("clientId").jsonPrimitive.content)
        assertFalse("repeat" in args(queued[1].argsJson))

        assertEquals(RestoreResult(added = 0, alreadyHere = 6), repository.restore(backup))
    }

    @Test
    fun aBackupOfThePhoneRestoresOnAnotherPhone() = runTest {
        val repository = repository()
        val task = repository.add("Call the dentist", "2026-10-24", "09:30", "Ask about Friday")
        repository.setLabels(task.localId, listOf("Health"))
        repository.setRepeat(task.localId, RepeatRule(RepeatEvery.MONTH, monthDay = -1))
        val file = PlanBackup.write(repository.backupSnapshot().tasks, BackupSettings("Europe/Warsaw", "05:00", listOf(0)), clock)

        val other = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val read = PlanBackup.read(file) { "item" } as BackupRead.Plan
            assertEquals(RestoreResult(1, 0), TaskRepository(other, clock = { clock }).restore(read.tasks))
            val restored = other.tasks().all().single()
            assertEquals(task.localId, restored.localId)
            assertEquals(listOf("Health"), restored.labels)
            assertEquals(RepeatRule(RepeatEvery.MONTH, monthDay = -1), restored.repeat)
            assertEquals("Ask about Friday", restored.note)
            assertEquals(Mutations.ADD, other.outbox().all().single().mutation)
        } finally {
            other.close()
        }
    }

    @Test
    fun clearAllEmptiesThePhone() = runTest {
        val repository = repository()
        repository.add("One", null, null, null)
        repository.add("Two", null, null, null)
        assertEquals(dev.helm.planner.data.PlanSize(2, 2, 0), repository.planSize())
        repository.clearAll()
        assertEquals(dev.helm.planner.data.PlanSize(0, 0, 0), repository.planSize())
        assertTrue(db.tasks().all().isEmpty())
    }
}
