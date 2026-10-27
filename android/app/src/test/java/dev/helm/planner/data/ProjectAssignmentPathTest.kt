package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.data.remote.TaskRemote
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The owner's path: an account with tasks and no projects. An existing task must be assignable to a project made from
 * the picker, the assignment must reach the server, and a project made on another device must show up after a sync.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ProjectAssignmentPathTest {
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
    private val server = FakeServer()
    private var next = 0
    private val repository = TaskRepository(db, clock = { 1000 }, newId = { "local-${++next}" }, projectRemote = { server })
    @After fun close() = db.close()

    private suspend fun sync() {
        assertEquals(DrainResult.DONE, OutboxProcessor(RoomOutboxStore(db), server).drain())
        repository.applySnapshot(server.snapshot())
    }

    @Test fun existingTaskGoesIntoTheFirstProjectMadeFromThePickerAndReachesTheServer() = runBlocking {
        val task = repository.add("Test the build", null, null, null)
        sync()
        assertTrue(repository.projects.first().isEmpty())
        // The picker's "New project": create, then assign the open task to it.
        val project = repository.projectStore.add("Work")
        repository.setProject(task.localId, project.localId)
        sync()
        assertEquals(project.serverId, server.tasks.single()["projectId"]?.jsonPrimitive?.content)
        assertEquals(project.localId, db.tasks().byLocalId(task.localId)?.projectId)
    }

    @Test fun existingProjectIsAssignedAndAProjectFromAnotherDeviceAppearsAfterSync() = runBlocking {
        val task = repository.add("Test the build", null, null, null)
        repository.projectStore.add("Work")
        sync()
        server.projects += server.project("Home")
        sync()
        val home = repository.projects.first().single { it.name == "Home" }
        assertTrue(home.assignable)
        repository.setProject(task.localId, home.localId)
        sync()
        assertEquals(home.serverId, server.tasks.single()["projectId"]?.jsonPrimitive?.content)
    }

    /** Just enough of the backend's app API for tasks and projects, held in memory. */
    private class FakeServer : TaskRemote {
        val tasks = mutableListOf<JsonObject>()
        val projects = mutableListOf<JsonObject>()
        private var ids = 0

        fun project(name: String) = buildJsonObject {
            put("id", "project-${++ids}"); put("name", name); put("position", ids.toDouble()); put("createdAt", 1); put("updatedAt", 1)
        }

        fun snapshot(): RemoteEvent.Snapshot = RemoteJson.snapshot(JsonArray(tasks), JsonArray(emptyList()), JsonObject(emptyMap()), JsonArray(projects))

        override fun events() = kotlinx.coroutines.flow.emptyFlow<RemoteEvent>()

        override suspend fun send(mutation: String, args: JsonObject): SendResult = when (mutation) {
            Mutations.ADD -> {
                val id = "task-${++ids}"
                tasks += JsonObject(args + mapOf("id" to JsonPrimitive(id), "status" to JsonPrimitive("todo"),
                    "createdAt" to JsonPrimitive(1), "updatedAt" to JsonPrimitive(2)))
                SendResult.Applied(buildJsonObject { put("id", id) })
            }
            Mutations.UPDATE -> {
                val id = args.getValue("taskId").jsonPrimitive.content
                val index = tasks.indexOfFirst { it["id"]?.jsonPrimitive?.content == id }
                tasks[index] = JsonObject(tasks[index] + args.filterKeys { it != "taskId" && it != "clientId" } +
                    ("updatedAt" to JsonPrimitive(tasks[index].getValue("updatedAt").jsonPrimitive.long + 1)))
                SendResult.Applied(buildJsonObject { put("id", id) })
            }
            "app:addProject" -> {
                val created = project(args.getValue("name").jsonPrimitive.content)
                projects += created
                SendResult.Applied(buildJsonObject { put("project", created) })
            }
            else -> SendResult.Rejected("unexpected $mutation")
        }

        override suspend fun query(path: String, args: JsonObject): SendResult = SendResult.Applied(when (path) {
            RemoteJson.QUERY_TASKS -> JsonArray(tasks)
            RemoteJson.QUERY_PROJECTS -> JsonArray(projects)
            RemoteJson.QUERY_SETTINGS -> JsonObject(emptyMap())
            else -> JsonArray(emptyList())
        })
    }
}
