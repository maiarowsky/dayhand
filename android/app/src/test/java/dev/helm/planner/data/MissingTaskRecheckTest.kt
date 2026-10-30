package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * `app:listAll` and `app:listTrash` are separate queries, so a task restored from the trash between them is in neither
 * list. The phone reads such a known task once more (`app:getTask`) instead of deleting it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MissingTaskRecheckTest {
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
    private var answer: (String) -> SendResult = { SendResult.Failed("unset") }
    private val asked = mutableListOf<String>()
    private val queries = QueryRunner { path, args ->
        assertEquals(RemoteJson.QUERY_TASK, path)
        val id = args.getValue("taskId").jsonPrimitive.content
        asked += id
        answer(id)
    }
    private val repository = TaskRepository(db, clock = { 10_000 }, taskQueries = { queries })
    @After fun close() = db.close()

    private fun task(updatedAt: Long, deletedAt: Long? = null) = buildJsonObject {
        put("id", "s1"); put("title", "Call the plumber"); put("status", "todo"); put("isNow", false)
        put("createdAt", 1); put("updatedAt", updatedAt)
        deletedAt?.let { put("deletedAt", it) }
    }

    private suspend fun snapshot(active: List<JsonObject>, trash: List<JsonObject>) =
        repository.applySnapshot(RemoteJson.snapshot(JsonArray(active), JsonArray(trash), JsonObject(emptyMap())))

    @Test fun aTaskRestoredBetweenTheTwoListsStaysAndLeavesTheTrash() = runBlocking {
        snapshot(emptyList(), listOf(task(updatedAt = 2, deletedAt = 2)))
        answer = { SendResult.Applied(buildJsonObject { put("task", task(updatedAt = 3)); put("history", JsonArray(emptyList())) }) }
        snapshot(emptyList(), emptyList())
        assertEquals(listOf("s1"), asked)
        assertFalse(db.tasks().byLocalId("s1")!!.inTrash)
    }

    @Test fun aTaskTheServerNoLongerHasGoes() = runBlocking {
        snapshot(emptyList(), listOf(task(updatedAt = 2, deletedAt = 2)))
        answer = { SendResult.Rejected("Task $it not found", "not_found") }
        snapshot(emptyList(), emptyList())
        assertNull(db.tasks().byLocalId("s1"))
    }

    @Test fun aTaskWithAnIdOfAnotherDeploymentGoes() = runBlocking {
        snapshot(emptyList(), listOf(task(updatedAt = 2, deletedAt = 2)))
        answer = { SendResult.Rejected("Invalid arguments: taskId must be a task id or \"#<number>\", got \"$it\"", "invalid_argument") }
        snapshot(emptyList(), emptyList())
        assertNull(db.tasks().byLocalId("s1"))
    }

    @Test fun aTaskThatCannotBeCheckedNowStaysUntilALaterSnapshot() = runBlocking {
        snapshot(emptyList(), listOf(task(updatedAt = 2, deletedAt = 2)))
        answer = { SendResult.Failed("IOException") }
        snapshot(emptyList(), emptyList())
        assertNotNull(db.tasks().byLocalId("s1"))
        snapshot(listOf(task(updatedAt = 3)), emptyList())
        assertFalse(db.tasks().byLocalId("s1")!!.inTrash)
    }
}
