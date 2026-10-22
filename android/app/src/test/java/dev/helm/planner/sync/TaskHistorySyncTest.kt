package dev.helm.planner.sync

import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.RemoteHistoryEntry
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskHistorySyncTest {
    private val saved = mutableMapOf<String, List<RemoteHistoryEntry>>()

    private fun sync(runner: QueryRunner?) = TaskHistorySync(runner = { runner }, save = { id, entries -> saved[id] = entries })

    @Test
    fun `fresh history replaces the cached copy`() = runTest {
        var asked: String? = null
        val runner = QueryRunner { path, args ->
            assertEquals("app:getTask", path)
            asked = args.getValue("taskId").jsonPrimitive.content
            SendResult.Applied(Json.parseToJsonElement("""{"history":[{"at":5,"actor":"agent","action":"update"}]}"""))
        }
        assertEquals(HistoryState.FRESH, sync(runner).refresh("s1"))
        assertEquals("s1", asked)
        assertEquals("agent", saved.getValue("s1").single().actor)
    }

    @Test
    fun `offline or failing server keeps the cached copy`() = runTest {
        assertEquals(HistoryState.CACHED, sync(null).refresh("s1"))
        assertEquals(HistoryState.CACHED, sync { _, _ -> SendResult.Failed("IOException") }.refresh("s1"))
        assertEquals(HistoryState.CACHED, sync { _, _ -> SendResult.Unauthorized }.refresh("s1"))
        assertTrue(saved.isEmpty())
    }

    @Test
    fun `a task the server has not seen yet has no history to fetch`() = runTest {
        assertEquals(HistoryState.NOT_ON_SERVER_YET, sync { _, _ -> error("no call expected") }.refresh(null))
    }
}
