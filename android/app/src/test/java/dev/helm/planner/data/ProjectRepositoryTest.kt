package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.auth.PlanSwitch
import dev.helm.planner.backup.BackupProject
import dev.helm.planner.backup.BackupTask
import dev.helm.planner.data.local.*
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteTask
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.data.remote.TaskRemote
import dev.helm.planner.sample.SamplePlan
import dev.helm.planner.sync.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
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
    private fun project(id: String = "confirmed") = Project(id, serverId = id, name = id, position = 0.0, createdAt = 1, updatedAt = 1)
    @After fun close() = db.close()

    @Test fun unpairedManagementNeverChangesCacheOrQueuesAProjectCommand() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val before = db.projects().all()
        val actions: List<suspend () -> Unit> = listOf(
            { repository.projectStore.add("New") },
            { repository.projectStore.add("Label", fromLabel = "phone", removeLabel = true) },
            { repository.projectStore.update(p.localId, "Edited", "red", "🥐", "Private") },
            { repository.projectStore.archive(p.localId, true, true) },
            { repository.projectStore.move(p.localId, 1) },
            { repository.projectStore.delete(p.localId, null) },
        )
        actions.forEach { action ->
            try { action(); fail("Unpaired management must require the server") } catch (_: ProjectConnectionRequired) { }
            assertEquals(before, db.projects().all())
            assertTrue(db.outbox().all().isEmpty())
        }
    }

    @Test fun taskQueueContainsConfirmedProjectIdsAndAppendsLaterEdits() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val task = repository.add("Milk", null, null, null, p.localId)
        repository.rename(task.localId, "Bread")
        assertEquals(listOf(Mutations.ADD, Mutations.UPDATE), db.outbox().all().map { it.mutation })
        assertEquals(JsonPrimitive(p.serverId), Json.parseToJsonElement(db.outbox().all().first().argsJson).jsonObject["projectId"])
        val sample = SamplePlan.projects(1000) { it.name }.first()
        db.projects().upsert(listOf(sample))
        try { repository.add("Not a confirmed project", null, null, null, sample.localId); fail() } catch (_: IllegalArgumentException) { }
        assertEquals(1, db.tasks().all().size)
        assertEquals(2, db.outbox().all().size)
    }

    @Test fun rejectedAssignmentKeepsTaskLaterEditsAndQueueSequence() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val task = repository.add("Milk", null, null, null, p.localId)
        repository.rename(task.localId, "Keep my edit")
        val seqs = db.outbox().all().map { it.seq }
        val sent = mutableListOf<JsonObject>()
        val sender = MutationSender { _, args ->
            sent += args
            if (args["projectId"] is JsonPrimitive && args["projectId"] !is JsonNull) SendResult.Rejected("Project removed", "not_found")
            else SendResult.Applied(buildJsonObject { put("id", "server-task") })
        }
        val queries = QueryRunner { _, _ -> SendResult.Applied(JsonArray(emptyList())) }
        val first = OutboxProcessor(RoomOutboxStore(db), sender, maxOpsPerRun = 1, queries = queries)
        assertEquals(DrainResult.MORE_LEFT, first.drain())
        assertEquals(seqs, db.outbox().all().map { it.seq })
        assertEquals("Keep my edit", db.tasks().byLocalId(task.localId)?.title)
        assertNull(db.tasks().byLocalId(task.localId)?.projectId)
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = queries).drain())
        assertEquals("Keep my edit", db.tasks().byLocalId(task.localId)?.title)
        assertFalse(sent[1].containsKey("projectId"))
        assertEquals(JsonPrimitive("Keep my edit"), sent.last()["title"])
    }

    @Test fun rejectedParentAssignmentAlsoClearsItsQueuedChildsDependentProof() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val parent = repository.add("Repeat", "2026-10-23", null, null, p.localId)
        repository.setRepeat(parent.localId, RepeatRule(RepeatEvery.DAY))
        repository.complete(parent.localId)
        val child = db.tasks().all().single { it.localId != parent.localId }
        repository.rename(child.localId, "Keep child edit")
        val op = db.outbox().all().first()
        RoomOutboxStore(db).clearProjectAssignment(op)
        assertTrue(db.tasks().all().all { it.projectId == null })
        val childAdd = db.outbox().all().single { it.taskLocalId == child.localId && it.mutation == Mutations.ADD }
        val args = Json.parseToJsonElement(childAdd.argsJson).jsonObject
        assertFalse("projectId" in args)
        assertFalse("repeatParentLocalId" in args)
        assertFalse("repeatCompletedBy" in args)
        assertFalse("repeatCompletedOn" in args)
        assertEquals("Keep child edit", db.tasks().byLocalId(child.localId)?.title)
    }

    @Test fun rejectedOldAssignmentDoesNotEraseALaterDifferentConfirmedAssignment() = runBlocking {
        val from = project("from")
        val to = project("to")
        db.projects().upsert(listOf(from, to))
        val task = repository.add("Keep", null, null, null, from.localId)
        repository.setProject(task.localId, to.localId)
        val before = db.outbox().all()
        RoomOutboxStore(db).clearProjectAssignment(before.first())
        assertEquals(to.localId, db.tasks().byLocalId(task.localId)?.projectId)
        assertEquals(before.last(), db.outbox().all().last())
    }

    @Test fun sampleCleanupClearsDependentRepeatProofWithoutLosingOwnTasks() = runBlocking {
        val p = SamplePlan.projects(1000) { it.name }.first()
        repository.loadSample(emptyList(), listOf(p))
        val task = Task("own", title = "Keep", projectId = p.localId, createdAt = 1, updatedAt = 1)
        db.tasks().upsert(listOf(task))
        db.outbox().insert(OutboxOp(opId = "op", mutation = Mutations.ADD, taskLocalId = task.localId,
            clientId = "op", createdAt = 1, argsJson = buildJsonObject {
                put("title", task.title); put("projectId", p.localId)
                put("repeatParentLocalId", "parent"); put("repeatCompletedBy", "completion"); put("repeatCompletedOn", "2026-10-23")
            }.toString()))
        repository.removeSample()
        assertEquals("Keep", db.tasks().byLocalId("own")?.title)
        assertNull(db.tasks().byLocalId("own")?.projectId)
        val args = Json.parseToJsonElement(db.outbox().all().single().argsJson).jsonObject
        assertEquals(setOf("title"), args.keys)
        assertTrue(db.projects().all().isEmpty())
    }

    @Test fun refusedLocalOccurrenceKeepsItsRowAndAllLaterEdits() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val parent = repository.add("Repeat", "2026-10-23", null, null, p.localId)
        repository.setRepeat(parent.localId, RepeatRule(RepeatEvery.DAY))
        db.projects().upsert(listOf(p.copy(archivedAt = 1)))
        repository.complete(parent.localId)
        val child = db.tasks().all().single { it.localId != parent.localId }
        repository.rename(child.localId, "Keep my edit")
        val sender = MutationSender { _, args ->
            if ("repeatedFrom" in args) SendResult.Rejected("An older backend does not accept proof")
            else SendResult.Applied(buildJsonObject { put("id", "parent") })
        }
        assertEquals(DrainResult.RETRY_LATER, OutboxProcessor(RoomOutboxStore(db), sender).drain())
        assertEquals(2, db.tasks().all().size)
        assertEquals("Keep my edit", db.tasks().byLocalId(child.localId)?.title)
        assertEquals(listOf(Mutations.ADD, Mutations.UPDATE), db.outbox().all().map { it.mutation })
    }

    private fun projectsQuery(vararg archived: Pair<String, Boolean>) = QueryRunner { _, _ ->
        SendResult.Applied(JsonArray(archived.map { (id, isArchived) -> buildJsonObject {
            put("id", id); put("name", id); put("position", 0.0); if (isArchived) put("archivedAt", 1)
        } }))
    }

    private fun appliedWithServerIds(sent: MutableList<JsonObject>, refuse: (JsonObject) -> SendResult?) = MutationSender { _, args ->
        sent += args
        refuse(args) ?: SendResult.Applied(buildJsonObject { put("id", "server-" + args.getValue("clientId").jsonPrimitive.content) })
    }

    @Test fun refusedProofInAnActiveProjectSendsTheOccurrenceAsAnOrdinaryTask() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val parent = repository.add("Repeat", "2026-10-23", null, null, p.localId)
        repository.setRepeat(parent.localId, RepeatRule(RepeatEvery.DAY))
        repository.complete(parent.localId)
        val child = db.tasks().all().single { it.localId != parent.localId }
        repository.rename(child.localId, "Keep my edit")
        val sent = mutableListOf<JsonObject>()
        val sender = appliedWithServerIds(sent) { args ->
            if ("repeatedFrom" in args) SendResult.Rejected("Parent completion moved elsewhere", "invalid_argument") else null
        }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = projectsQuery(p.localId to false)).drain())
        assertTrue(db.outbox().all().isEmpty())
        val childAdd = sent.last { it["clientId"] == JsonPrimitive(child.localId) }
        assertFalse("repeatedFrom" in childAdd)
        assertEquals(JsonPrimitive(p.serverId), childAdd["projectId"])
        assertEquals(JsonPrimitive("Keep my edit"), sent.last()["title"])
        assertEquals(p.localId, db.tasks().byLocalId(child.localId)?.projectId)
        assertNotNull(db.tasks().byLocalId(child.localId)?.serverId)
    }

    @Test fun occurrenceOfARefusedParentIsSentAsAnOrdinaryTask() = runBlocking {
        val p = project()
        db.projects().upsert(listOf(p))
        val parent = repository.add("Repeat", "2026-10-23", null, null, p.localId)
        repository.setRepeat(parent.localId, RepeatRule(RepeatEvery.DAY))
        repository.complete(parent.localId)
        val child = db.tasks().all().single { it.localId != parent.localId }
        val sent = mutableListOf<JsonObject>()
        val sender = appliedWithServerIds(sent) { args ->
            if (args["clientId"] == JsonPrimitive(parent.localId)) SendResult.Rejected("Title refused") else null
        }
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = projectsQuery(p.localId to false)).drain())
        assertTrue(db.outbox().all().isEmpty())
        assertNull(db.tasks().byLocalId(parent.localId))
        assertFalse("repeatedFrom" in sent.last())
        assertEquals("server-${child.localId}", db.tasks().byLocalId(child.localId)?.serverId)
    }

    @Test fun refusedMoveDropsOnlyThatChangeAndKeepsThePreviousServerProject() = runBlocking {
        val from = project("from")
        val to = project("to")
        db.projects().upsert(listOf(from, to))
        db.tasks().upsert(listOf(Task("t", serverId = "server-t", title = "Keep", projectId = from.localId,
            createdAt = 1, updatedAt = 1, serverUpdatedAt = 1)))
        repository.setProject("t", to.localId)
        repository.rename("t", "Keep my edit")
        val sent = mutableListOf<JsonObject>()
        val sender = appliedWithServerIds(sent) { args ->
            if (args["projectId"] == JsonPrimitive(to.serverId)) SendResult.Rejected("Project archived", "invalid_argument") else null
        }
        val queries = projectsQuery(from.localId to false, to.localId to true)
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = queries).drain())
        assertTrue(db.outbox().all().isEmpty())
        assertEquals(1, sent.count { "projectId" in it })
        assertEquals(JsonPrimitive("Keep my edit"), sent.last()["title"])
        val local = requireNotNull(db.tasks().byLocalId("t"))
        assertNull(local.serverUpdatedAt)
        val server = RemoteTask("server-t", null, "Keep my edit", null, null, null, "todo", false, null, null, null, 1, 1,
            projectId = from.serverId)
        val restored = SnapshotMerger.merge(listOf(local), db.outbox().all(), listOf(server), 1000).upserts.single()
        assertEquals(from.localId, restored.projectId)
    }

    @Test fun projectCommandDrainsAQueueLongerThanOneRunBeforeExecuting() = runBlocking {
        repeat(OutboxProcessor.MAX_OPS_PER_RUN + 1) { repository.add("Offline $it", null, null, null) }
        val server = object : TaskRemote {
            override fun events() = kotlinx.coroutines.flow.emptyFlow<RemoteEvent>()
            override suspend fun send(mutation: String, args: JsonObject) =
                SendResult.Applied(buildJsonObject { put("id", "server-" + args.getValue("clientId").jsonPrimitive.content) })
            override suspend fun query(path: String, args: JsonObject) = SendResult.Applied(JsonArray(emptyList()))
        }
        TaskRepository(db, projectRemote = { server }).projectStore.refreshForRestore()
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test fun projectOnlyPlanRequiresOwnerReplacementAndClearAllRemovesItsNotes() = runBlocking {
        db.projects().upsert(listOf(project().copy(note = "Private old owner")))
        val size = repository.planSize()
        assertEquals(PlanSize(0, 0, 1), size)
        val replacement = PlanSwitch.check("https://old.convex.site", "https://new.convex.site", size.tasks, size.pending, size.projects)
        assertNotNull(replacement)
        assertEquals(1, replacement?.projects)
        repository.clearAll()
        assertEquals(PlanSize(0, 0, 0), repository.planSize())
        assertTrue(repository.backupSnapshot().projects.isEmpty())
    }

    @Test fun combinedRestoreCapacityFailsBeforeNetworkOrAnyPartialLocalChange() = runBlocking {
        db.projects().upsert((1..199).map { project("existing-$it") })
        var attempted = false
        val repo = TaskRepository(db, projectRemote = { attempted = true; null })
        val before = repo.backupSnapshot()
        val projects = listOf("one", "two").map { BackupProject(it, it, null, null, null, false) }
        try { repo.restore(listOf(BackupTask("task", "Keep")), projects); fail() } catch (_: RestoreCapacityExceeded) { }
        assertFalse(attempted)
        assertEquals(before, repo.backupSnapshot())
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test fun backupReadsAssignmentsAndProjectNotesTogetherAndOmitsSampleData() = runBlocking {
        val p = project().copy(note = "Context")
        db.projects().upsert(listOf(p))
        repository.add("Milk", null, null, null, p.localId)
        repository.loadSample(emptyList(), SamplePlan.projects(1000) { it.name })
        val snapshot = repository.backupSnapshot()
        assertEquals(listOf(p), snapshot.projects)
        assertEquals(p.serverId, snapshot.tasks.single().projectId)
    }
}
