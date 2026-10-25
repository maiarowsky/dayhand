package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Opt-in checks of the merged backend, not a project-server mock. No production URL is accepted. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ProjectBackendTest {
    private fun remote(): HttpTaskRemote {
        val url = System.getenv("DAYHAND_ANDROID_TEST_URL")
        val token = System.getenv("DAYHAND_ANDROID_TEST_TOKEN")
        assumeTrue("Requires the task-local backend", url != null && token != null)
        require(requireNotNull(url).startsWith("http://127.0.0.1:"))
        return HttpTaskRemote(url, requireNotNull(token))
    }
    private fun name(prefix: String) = "$prefix ${UUID.randomUUID().toString().take(8)}"
    private fun applied(result: SendResult) = (result as? SendResult.Applied)?.value ?: error("Local test backend refused a command: $result")
    private suspend fun tasks(remote: HttpTaskRemote) = RemoteJson.tasks(applied(remote.query(RemoteJson.QUERY_TASKS,
        buildJsonObject { put("includeDone", true); put("includeArchived", true) })))

    @Test fun onlineManagementAndOfflineTasksUseOnlyConfirmedIds() = runBlocking {
        val remote = remote()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            var online = false
            val repo = TaskRepository(db, projectRemote = { remote.takeIf { online } })
            try { repo.projectStore.add(name("No connection")); fail() } catch (_: ProjectConnectionRequired) { }
            assertTrue(db.projects().all().isEmpty())
            assertTrue(db.outbox().all().isEmpty())
            online = true
            val p = repo.projectStore.add(name("Bakery"), "amber", "🥐", "Context")
            assertEquals(p.serverId, p.localId)
            assertTrue(db.outbox().all().isEmpty())
            online = false
            val t = repo.add("Offline task", "2026-10-25", null, null, p.localId)
            repo.rename(t.localId, "Edited offline")
            assertEquals(listOf(Mutations.ADD, Mutations.UPDATE), db.outbox().all().map { it.mutation })
            assertFalse(tasks(remote).any { it.clientId == t.localId })
            try { repo.projectStore.update(p.localId, "Cannot change offline", null, null, null); fail() } catch (_: ProjectConnectionRequired) { }
            assertEquals(p.name, db.projects().byLocalId(p.localId)?.name)
            online = true
            // A direct project command drains earlier tasks before reading server-side conversion/move state.
            repo.projectStore.update(p.localId, p.name, "green", "🥐", "Updated context")
            val sent = tasks(remote).single { it.clientId == t.localId }
            assertEquals("Edited offline", sent.title)
            assertEquals(p.serverId, sent.projectId)
            assertTrue(db.outbox().all().isEmpty())
            assertEquals("green", db.projects().byLocalId(p.localId)?.color)
            repo.projectStore.archive(p.localId, true, archiveTasks = true)
            assertNotNull(tasks(remote).single { it.clientId == t.localId }.archivedAt)
            assertTrue(db.projects().byLocalId(p.localId)!!.archived)
        } finally { db.close() }
    }

    @Test fun labelConversionUsesServerResultAndDuplicateNameCannotPretendToSucceed() = runBlocking {
        val remote = remote()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val repo = TaskRepository(db, projectRemote = { remote })
            val label = name("tag")
            val other = repo.projectStore.add(name("Other"))
            val loose = repo.add("Loose", null, null, null)
            val assigned = repo.add("Assigned", null, null, null, other.localId)
            repo.setLabels(loose.localId, listOf(label))
            repo.setLabels(assigned.localId, listOf(label))
            val p = repo.projectStore.add(name("Converted"), fromLabel = label, removeLabel = true)
            assertEquals(p.serverId, db.tasks().byLocalId(loose.localId)?.projectId)
            assertTrue(db.tasks().byLocalId(loose.localId)!!.labels.isEmpty())
            assertEquals(other.serverId, db.tasks().byLocalId(assigned.localId)?.projectId)
            assertEquals(listOf(label), db.tasks().byLocalId(assigned.localId)?.labels)
            val count = db.projects().all().size
            try { repo.projectStore.add(p.name.uppercase(), fromLabel = label); fail() } catch (_: IllegalArgumentException) { }
            assertEquals(count, db.projects().all().size)
            assertTrue(db.outbox().all().isEmpty())
            repo.moveToTrash(loose.localId)
            repo.projectStore.delete(p.localId, other.localId)
            val trash = RemoteJson.tasks(applied(remote.query(RemoteJson.QUERY_TRASH, JsonObject(emptyMap()))))
            assertEquals(other.serverId, trash.single { it.clientId == loose.localId }.projectId)
            assertEquals(other.serverId, db.tasks().byLocalId(loose.localId)?.projectId)
            assertNull(db.projects().byLocalId(p.localId))
        } finally { db.close() }
    }

    @Test fun archivedAndDeletedTargetsStripOnlyTheRefusedAssignment() = runBlocking {
        val remote = remote()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val repo = TaskRepository(db, projectRemote = { remote })
            for (deleted in listOf(false, true)) {
                val p = repo.projectStore.add(name("Refused"))
                val t = repo.add("Keep task", null, null, null, p.localId)
                repo.rename(t.localId, "Keep later edit")
                applied(remote.send(if (deleted) "app:deleteProject" else "app:updateProject", buildJsonObject {
                    put("projectId", requireNotNull(p.serverId))
                    if (deleted) put("moveTasksTo", "none") else put("archived", true)
                }))
                assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), remote).drain())
                assertEquals("Keep later edit", db.tasks().byLocalId(t.localId)?.title)
                assertNull(db.tasks().byLocalId(t.localId)?.projectId)
                val server = tasks(remote).single { it.clientId == t.localId }
                assertNull(server.projectId)
                assertEquals("Keep later edit", server.title)
                if (!deleted) assertTrue(RemoteJson.projects(applied(remote.query(RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap()))))
                    .single { it.serverId == p.serverId }.archived)
            }
        } finally { db.close() }
    }

    @Test fun archivedProjectBackupNeverReopensItAndRestoresItsTasksWithoutAProject() = runBlocking {
        val remote = remote()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val sent = mutableListOf<JsonObject>()
            val recording = object : dev.helm.planner.data.remote.TaskRemote by remote {
                override suspend fun send(mutation: String, args: JsonObject): SendResult = remote.send(mutation, args).also { sent += args }
            }
            val repo = TaskRepository(db, projectRemote = { recording })
            val imported = dev.helm.planner.backup.BackupProject("file-project", name("Restored"), "green", "🥐", "Backup context", true)
            val task = dev.helm.planner.backup.BackupTask(UUID.randomUUID().toString(), "Restored task", projectId = imported.id)
            assertEquals(RestoreResult(1, 0), repo.restore(listOf(task), listOf(imported)))
            val project = db.projects().all().single { it.name == imported.name }
            assertTrue(project.archived)
            assertEquals("Backup context", project.note)
            val second = dev.helm.planner.backup.BackupTask(UUID.randomUUID().toString(), "Second restored task", projectId = imported.id)
            assertEquals(RestoreResult(1, 1), repo.restore(listOf(task, second), listOf(imported)))
            repo.projectStore.refreshForRestore()
            assertTrue(db.outbox().all().isEmpty())
            for (restored in listOf(task, second)) {
                val server = tasks(remote).single { it.clientId == restored.id }
                assertNull(server.projectId)
                assertNull(db.tasks().byLocalId(restored.id)?.projectId)
            }
            assertTrue(db.projects().byLocalId(project.localId)!!.archived)
            assertFalse(sent.any { it["archived"]?.jsonPrimitive?.content == "false" })
        } finally { db.close() }
    }

    @Test fun ownerSwitchWaitsForAnInflightProjectReplyThenClearsBeforeSavingCredentials() = runBlocking {
        withTimeout(10_000) {
            val remote = remote()
            val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
            try {
                val applied = CompletableDeferred<Unit>()
                val release = CompletableDeferred<Unit>()
                val delayed = object : dev.helm.planner.data.remote.TaskRemote by remote {
                    override suspend fun send(mutation: String, args: JsonObject): SendResult {
                        val response = remote.send(mutation, args)
                        if (mutation == "app:addProject") { applied.complete(Unit); release.await() }
                        return response
                    }
                }
                val repo = TaskRepository(db, projectRemote = { delayed })
                val creating = async { repo.projectStore.add(name("Old owner"), note = "Private") }
                applied.await()
                var credentialsSaved = false
                val switching = async { repo.projectStore.withOwnerChange {
                    repo.clearAll()
                    assertTrue(repo.backupSnapshot().projects.isEmpty())
                    credentialsSaved = true
                } }
                yield()
                assertFalse(credentialsSaved)
                release.complete(Unit)
                creating.await()
                switching.await()
                assertTrue(credentialsSaved)
                assertTrue(repo.backupSnapshot().projects.isEmpty())
            } finally { db.close() }
        }
    }

    @Test fun reorderingRepairsTiesExhaustedGapsAndBothPositionEndpoints() = runBlocking {
        val remote = remote()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val repo = TaskRepository(db, projectRemote = { remote })
            val a = repo.projectStore.add(name("Order A"))
            val b = repo.projectStore.add(name("Order B"))
            for (positions in listOf(1e15 to 1e15, -1e15 to -1e15, 1.0 to Math.nextUp(1.0))) {
                listOf(a to positions.first, b to positions.second).forEach { (p, position) ->
                    applied(remote.send("app:updateProject", buildJsonObject { put("projectId", p.localId); put("position", position) }))
                }
                repo.projectStore.refreshForRestore()
                val before = db.projects().all().filter { it.selectable }
                val first = before.indexOfFirst { it.localId == a.localId }
                val second = before.indexOfFirst { it.localId == b.localId }
                val from = if (first < second) b else a
                val target = if (first < second) first else second
                repo.projectStore.move(from.localId, target - maxOf(first, second))
                val ordered = db.projects().all().filter { it.selectable }
                assertEquals(from.localId, ordered[target].localId)
                assertTrue(ordered.all { it.position.isFinite() && kotlin.math.abs(it.position) <= 1e15 })
                assertTrue(ordered.zipWithNext().all { (left, right) -> left.position < right.position })
            }
        } finally { db.close() }
    }
}
