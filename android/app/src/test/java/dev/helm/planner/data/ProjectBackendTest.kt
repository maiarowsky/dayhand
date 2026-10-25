package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Opt-in integration against this checkout's real local Convex deployment; no invented project server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ProjectBackendTest {
    @Test fun offlineCreationConflictMappingAndDeletionAgainstMergedBackend() = runBlocking {
        val url = System.getenv("DAYHAND_ANDROID_TEST_URL")
        val token = System.getenv("DAYHAND_ANDROID_TEST_TOKEN")
        assumeTrue("Start the local backend and set DAYHAND_ANDROID_TEST_URL/TOKEN", url != null && token != null)
        require(url.startsWith("http://127.0.0.1:")) { "This test never uses a production backend" }
        val remote = HttpTaskRemote(url, token)
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val repository = TaskRepository(db)
            val name = "Android JVM ${UUID.randomUUID().toString().take(8)}"
            val project = repository.projectStore.add(name, "amber", "🥐", "Local backend proof")
            val task = repository.add("Offline task", "2026-10-25", null, null, project.localId)
            val sent = mutableListOf<String>()
            val sender = MutationSender { path, args -> sent += path; remote.send(path, args) }
            assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), sender, queries = remote).drain())
            assertEquals(listOf(Mutations.ADD_PROJECT, Mutations.ADD), sent)
            val remoteProjects = applied(remote.query(RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap())))
            val serverProject = RemoteJson.projects(remoteProjects).single { it.name == name }
            val remoteTasks = applied(remote.query(RemoteJson.QUERY_TASKS, buildJsonObject { put("includeDone", true); put("includeArchived", true) }))
            val serverTask = RemoteJson.tasks(remoteTasks).single { it.clientId == task.localId }
            assertEquals(serverProject.serverId, serverTask.projectId)
            assertEquals(serverProject.serverId, db.projects().byLocalId(project.localId)?.serverId)
            repository.applySnapshot(RemoteEvent.Snapshot(listOf(serverTask), "UTC", projects = listOf(serverProject)))
            assertEquals(project.localId, db.tasks().byLocalId(task.localId)?.projectLocalId)

            val duplicateName = "Conflict ${UUID.randomUUID().toString().take(8)}"
            val existing = applied(remote.send(Mutations.ADD_PROJECT, buildJsonObject { put("name", duplicateName.uppercase()); put("clientId", UUID.randomUUID().toString()) }))
                .jsonObject.getValue("project").jsonObject.getValue("id").jsonPrimitive.content
            val duplicate = repository.projectStore.add(duplicateName)
            val next = repository.add("Same name on two devices", null, null, null, duplicate.localId)
            assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), remote).drain())
            assertEquals(existing, db.projects().byLocalId(duplicate.localId)?.serverId)
            val all = RemoteJson.tasks(applied(remote.query(RemoteJson.QUERY_TASKS, JsonObject(emptyMap()))))
            assertEquals(existing, all.single { it.clientId == next.localId }.projectId)
            repository.moveToTrash(task.localId)
            repository.projectStore.delete(project.localId, duplicate.localId)
            assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), remote).drain())
            val trash = RemoteJson.tasks(applied(remote.query(RemoteJson.QUERY_TRASH, JsonObject(emptyMap()))))
            assertEquals(existing, trash.single { it.clientId == task.localId }.projectId)
            assertFalse(RemoteJson.projects(applied(remote.query(RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap())))).any { it.name == name })
            assertTrue(db.outbox().all().isEmpty())
        } finally { db.close() }
    }

    private fun applied(result: SendResult) = (result as? SendResult.Applied)?.value ?: error("Local backend rejected the test: $result")
}
