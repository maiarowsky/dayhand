package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ProjectRepositoryTest {
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
    private var next = 0
    private val repository = TaskRepository(db, clock = { 1000 }, newId = { "local-${++next}" }, repeatsOnPhone = { "2026-10-23" })
    @After fun close() = db.close()

    @Test fun offlineProjectAndTaskAreDurableAndResolveReferencesInOrder() = runBlocking {
        val project = repository.projectStore.add("Dom", "amber", "🏠", "Context")
        val task = repository.add("Milk", "2026-10-23", null, null, project.localId)
        assertEquals(project.localId, db.tasks().byLocalId(task.localId)?.projectLocalId)
        assertEquals(listOf(Mutations.ADD_PROJECT, Mutations.ADD), db.outbox().all().map { it.mutation })
        val sent = mutableListOf<Pair<String, JsonObject>>()
        val sender = MutationSender { name, args ->
            sent += name to args
            SendResult.Applied(if (name == Mutations.ADD_PROJECT) Json.parseToJsonElement("""{"project":{"id":"server-project"},"moved":[],"skipped":[]}""")
                else buildJsonObject { put("id", "server-task") })
        }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender).drain())
        assertEquals(JsonPrimitive("server-project"), sent.last().second["projectId"])
        assertFalse(sent.last().second.containsKey("projectLocalId"))
        assertEquals("server-project", db.projects().byLocalId(project.localId)?.serverId)
        assertEquals("server-task", db.tasks().byLocalId(task.localId)?.serverId)
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test fun existingNameOnAnotherDeviceLinksWithoutLosingTasks() = runBlocking {
        val project = repository.projectStore.add("Dom")
        val task = repository.add("Milk", null, null, null, project.localId)
        val sender = MutationSender { mutation, args ->
            if (mutation == Mutations.ADD_PROJECT) SendResult.Rejected("name taken", "invalid_argument")
            else {
                assertEquals(JsonPrimitive("existing"), args["projectId"])
                SendResult.Applied(buildJsonObject { put("id", "task") })
            }
        }
        val queries = QueryRunner { _, _ -> SendResult.Applied(Json.parseToJsonElement(
            """[{"id":"existing","name":"DOM","position":1024.0,"createdAt":1.0,"updatedAt":2.0}]""")) }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = queries).drain())
        assertEquals("existing", db.projects().byLocalId(project.localId)?.serverId)
        assertEquals(project.localId, db.tasks().byLocalId(task.localId)?.projectLocalId)
    }

    @Test fun repeatOnPhoneKeepsItsProject() = runBlocking {
        val project = repository.projectStore.add("Home")
        val task = repository.add("Plants", "2026-10-23", null, null, project.localId)
        repository.setRepeat(task.localId, RepeatRule(RepeatEvery.DAY))
        repository.complete(task.localId)
        val next = db.tasks().all().single { it.localId != task.localId }
        assertEquals(project.localId, next.projectLocalId)
        assertEquals(project.localId, db.outbox().all().last().projectLocalId)
    }

    @Test fun deleteMovesEveryStateIncludingTrashAndCanTargetAnUnsentProject() = runBlocking {
        val from = repository.projectStore.add("From")
        val target = repository.projectStore.add("To")
        val task = repository.add("Keep me", null, null, null, from.localId)
        repository.moveToTrash(task.localId)
        repository.projectStore.delete(from.localId, target.localId)
        assertEquals(target.localId, db.tasks().byLocalId(task.localId)?.projectLocalId)
        assertNotNull(db.tasks().byLocalId(task.localId)?.deletedAt)
        assertNotNull(db.projects().byLocalId(from.localId)?.deletedAt)
        assertEquals(target.localId, Json.parseToJsonElement(db.outbox().all().last().argsJson).jsonObject["moveTasksToLocalId"]?.let { (it as JsonPrimitive).content })
    }

    @Test fun conversionIsOptInAndPreservesTasksAlreadyInAProject() = runBlocking {
        val other = repository.projectStore.add("Other")
        val loose = repository.add("Loose", null, null, null)
        val assigned = repository.add("Assigned", null, null, null, other.localId)
        repository.setLabels(loose.localId, listOf("home"))
        repository.setLabels(assigned.localId, listOf("home"))
        val project = repository.projectStore.add("Home", fromLabel = "home", removeLabel = true)
        assertEquals(project.localId, db.tasks().byLocalId(loose.localId)?.projectLocalId)
        assertTrue(db.tasks().byLocalId(loose.localId)!!.labels.isEmpty())
        assertEquals(other.localId, db.tasks().byLocalId(assigned.localId)?.projectLocalId)
        assertEquals(listOf("home"), db.tasks().byLocalId(assigned.localId)?.labels)
        assertEquals(JsonPrimitive("home"), Json.parseToJsonElement(db.outbox().all().last().argsJson).jsonObject["fromLabel"])
    }

    @Test fun restoringAProjectBackupKeepsReferencesAndQueuesArchiveAfterTasks() = runBlocking {
        val fileProject = dev.helm.planner.backup.BackupProject("file-project", "Home", "green", null, "Context", true)
        val fileTask = dev.helm.planner.backup.BackupTask("file-task", "Keep", projectId = "file-project")
        repository.restore(listOf(fileTask), listOf(fileProject))
        val project = db.projects().all().single()
        assertTrue(project.archived)
        assertEquals(project.localId, db.tasks().all().single().projectLocalId)
        assertEquals(listOf(Mutations.ADD_PROJECT, Mutations.ADD, Mutations.UPDATE_PROJECT), db.outbox().all().map { it.mutation })
    }

    @Test fun removingSampleProjectsDoesNotLoseAnOwnTaskOrSendSampleData() = runBlocking {
        val project = dev.helm.planner.sample.SamplePlan.projects(1000) { it.name }.first()
        repository.loadSample(emptyList(), listOf(project))
        val task = repository.add("My task", null, null, null, project.localId)
        repository.removeSample()
        assertEquals("My task", db.tasks().byLocalId(task.localId)?.title)
        assertNull(db.tasks().byLocalId(task.localId)?.projectLocalId)
        assertNull(db.outbox().all().single().projectLocalId)
        assertEquals(Mutations.ADD, db.outbox().all().single().mutation)
        assertTrue(db.projects().all().isEmpty())
    }

    @Test fun refusedLocalOccurrenceKeepsItsRowAndAllLaterEdits() = runBlocking {
        val project = repository.projectStore.add("Archived")
        val parent = repository.add("Repeat", "2026-10-23", null, null, project.localId)
        repository.setRepeat(parent.localId, RepeatRule(RepeatEvery.DAY))
        repository.projectStore.archive(project.localId, true)
        repository.complete(parent.localId)
        val next = db.tasks().all().single { it.localId != parent.localId }
        repository.rename(next.localId, "Keep my edit")
        val sender = MutationSender { mutation, args ->
            when {
                "repeatedFrom" in args -> SendResult.Rejected("An older backend does not accept the proof")
                mutation == Mutations.ADD_PROJECT -> SendResult.Applied(Json.parseToJsonElement("""{"project":{"id":"project"}}"""))
                else -> SendResult.Applied(buildJsonObject { put("id", "parent") })
            }
        }
        assertEquals(DrainResult.RETRY_LATER, OutboxProcessor(RoomOutboxStore(db), sender).drain())
        assertEquals(2, db.tasks().all().size)
        assertEquals("Keep my edit", db.tasks().byLocalId(next.localId)?.title)
        assertEquals(listOf(Mutations.ADD, Mutations.UPDATE), db.outbox().all().map { it.mutation })
        assertEquals(1, db.outbox().all().first().attempts)
    }

    @Test fun refusedProjectNeverDeletesItsUnsentTasks() = runBlocking {
        val project = repository.projectStore.add("Home")
        val task = repository.add("Keep this", null, null, null, project.localId)
        val sender = MutationSender { mutation, args ->
            if (mutation == Mutations.ADD_PROJECT) SendResult.Rejected("limit", "invalid_argument")
            else {
                assertFalse(args.containsKey("projectId"))
                SendResult.Applied(buildJsonObject { put("id", "kept") })
            }
        }
        val queries = QueryRunner { _, _ -> SendResult.Applied(Json.parseToJsonElement("[]")) }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = queries).drain())
        assertEquals("Keep this", db.tasks().byLocalId(task.localId)?.title)
        assertNull(db.tasks().byLocalId(task.localId)?.projectLocalId)
        assertTrue(db.projects().all().isEmpty())
    }
}
