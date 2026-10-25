package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import dev.helm.planner.sync.RoomOutboxStore
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A reconnect must not remove an occurrence the phone already created in an archived project. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ArchivedProjectRepeatTest {
    @Test fun inheritedArchivedProjectReconnectsWithoutLosingTheNextOccurrence() = runBlocking {
        val url = System.getenv("DAYHAND_ANDROID_TEST_URL")
        val token = System.getenv("DAYHAND_ANDROID_TEST_TOKEN")
        assumeTrue("Requires the task's local backend", url != null && token != null)
        require(requireNotNull(url).startsWith("http://127.0.0.1:"))
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val today = LocalDate.now().toString()
            val remote = HttpTaskRemote(url, requireNotNull(token))
            val repo = TaskRepository(db, repeatsOnPhone = { today }, projectRemote = { remote })
            val name = "Archived ${UUID.randomUUID().toString().take(8)}"
            val p = repo.projectStore.add(name)
            val t = repo.add(name, today, null, null, p.localId)
            repo.setRepeat(t.localId, RepeatRule(RepeatEvery.DAY))
            repo.projectStore.archive(p.localId, true)
            repo.complete(t.localId)
            val next = db.tasks().all().single { it.localId != t.localId && it.projectId == p.serverId }
            assertEquals("The next occurrence exists on the phone", 2, db.tasks().all().count { it.projectId == p.serverId })
            repo.rename(next.localId, "Edited before reconnect")
            var lost = false
            val sent = mutableListOf<JsonObject>()
            val sender = MutationSender { path, args ->
                sent += args
                val result = remote.send(path, args)
                if (!lost && "repeatedFrom" in args && result is SendResult.Applied) {
                    lost = true
                    SendResult.Failed("simulated lost reply after the real backend applied the occurrence")
                } else result
            }
            val processor = OutboxProcessor(RoomOutboxStore(db), sender, queries = remote)
            assertEquals(DrainResult.RETRY_LATER, processor.drain())
            assertEquals("The next occurrence must not disappear while reconnecting", 2, db.tasks().all().count { it.projectId == p.serverId })
            assertEquals(DrainResult.DONE, processor.drain())
            assertTrue(lost)
            assertTrue(db.outbox().all().isEmpty())
            val value = remote.query(RemoteJson.QUERY_TASKS, buildJsonObject { put("includeDone", true); put("includeArchived", true) }) as SendResult.Applied
            val tasks = RemoteJson.tasks(value.value).filter { it.clientId in setOf(t.localId, next.localId) }
            assertEquals(2, tasks.size)
            val child = tasks.single { it.clientId == next.localId }
            assertEquals("Edited before reconnect", child.title)
            assertEquals(db.projects().byLocalId(p.localId)?.serverId, child.projectId)
            val projects = RemoteJson.projects((remote.query(RemoteJson.QUERY_PROJECTS, JsonObject(emptyMap())) as SendResult.Applied).value)
            assertNotNull(projects.single { it.serverId == child.projectId }.archivedAt)
            val proof = sent.first { "repeatedFrom" in it }
            assertEquals(db.tasks().byLocalId(t.localId)?.serverId, proof.getValue("repeatedFrom").jsonObject.getValue("taskId").jsonPrimitive.content)
            assertFalse(proof.containsKey("repeatParentLocalId"))
            assertFalse(sent.any { it["archived"]?.jsonPrimitive?.content == "false" })
        } finally { db.close() }
    }
}
