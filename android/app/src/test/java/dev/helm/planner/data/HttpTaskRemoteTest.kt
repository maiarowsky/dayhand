package dev.helm.planner.data

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.remote.HttpResponse
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpTaskRemoteTest {
    private fun classify(status: Int, body: String) = HttpTaskRemote.classify(HttpResponse(status, body))

    @Test
    fun `success returns the value`() {
        val result = classify(200, """{"status":"success","value":{"id":"k1"},"logLines":[]}""")
        assertEquals("k1", ((result as SendResult.Applied).value as JsonObject).getValue("id").jsonPrimitive.content)
    }

    @Test
    fun `a function error is final, except a missing sign-in`() {
        assertTrue(classify(560, """{"status":"error","errorMessage":"title must not be empty","errorData":{"code":"invalid_argument"}}""") is SendResult.Rejected)
        assertTrue(classify(560, """{"status":"error","errorMessage":"ArgumentValidationError"}""") is SendResult.Rejected)
        assertEquals(SendResult.Unauthorized, classify(560, """{"status":"error","errorMessage":"Sign in required","errorData":{"code":"unauthenticated"}}"""))
    }

    @Test
    fun `transport problems keep the change`() {
        assertEquals(SendResult.Unauthorized, classify(401, "Unauthenticated"))
        assertTrue(classify(404, "Not found") is SendResult.Failed)
        assertTrue(classify(503, "") is SendResult.Failed)
        assertTrue(classify(200, "<html>proxy</html>") is SendResult.Failed)
    }

    @Test
    fun `request body is what ConvexHttpClient sends`() {
        val body = Json.parseToJsonElement(HttpTaskRemote.requestBody("app:add", buildJsonObject { put("title", "x") })).jsonObject
        assertEquals("app:add", body.getValue("path").jsonPrimitive.content)
        assertEquals("convex_encoded_json", body.getValue("format").jsonPrimitive.content)
        assertEquals("x", body.getValue("args").jsonArray[0].jsonObject.getValue("title").jsonPrimitive.content)
    }

    @Test
    fun `no network is a transient failure`() = runTest {
        val remote = HttpTaskRemote("http://10.0.2.2:3210", "t", transport = { _, _, _ -> throw IOException("no route") })
        assertTrue(remote.send("app:add", JsonObject(emptyMap())) is SendResult.Failed)
    }

    @Test
    fun `polling feed builds a snapshot from listAll, the trash and getSettings`() = runTest {
        val urls = mutableListOf<String>()
        val remote = HttpTaskRemote("http://h", "t", transport = { url, token, body ->
            urls += url
            assertEquals("t", token)
            val path = Json.parseToJsonElement(body).jsonObject.getValue("path").jsonPrimitive.content
            val value = when (path) {
                "app:listAll" ->
                    """[{"id":"s1","title":"A","status":"todo","isNow":false,"labels":["home"],"links":[{"url":"https://a.pl","title":"A"}],"repeat":{"every":"week","interval":2.0,"weekdays":[1.0,5.0]},"createdAt":1.7E12,"updatedAt":1761130000000,"dueDate":"2026-10-22"}]"""
                "app:listTrash" ->
                    """[{"id":"s2","title":"B","status":"todo","isNow":false,"labels":[],"links":[],"createdAt":1,"updatedAt":2,"deletedAt":1761130000001}]"""
                else -> """{"timezone":"Europe/Warsaw","summaryTime":"05:00","defaultReminderMinutes":[0]}"""
            }
            HttpResponse(200, """{"status":"success","value":$value}""")
        })
        val snapshot = remote.events().first() as RemoteEvent.Snapshot
        assertEquals("Europe/Warsaw", snapshot.timezone)
        val (active, trashed) = snapshot.tasks
        assertEquals(1761130000000L, active.updatedAt)
        assertEquals(1_700_000_000_000L, active.createdAt)
        assertEquals(listOf("home"), active.labels)
        assertEquals(listOf(TaskLink("https://a.pl", "A")), active.links)
        assertEquals(RepeatRule(RepeatEvery.WEEK, 2, listOf(1, 5)), active.repeat)
        assertEquals(null, active.deletedAt)
        assertEquals(1761130000001L, trashed.deletedAt)
        assertEquals(listOf("http://h/api/query", "http://h/api/query", "http://h/api/query"), urls)
    }

    @Test
    fun `history of a task is read newest first with who made each change`() {
        val value = Json.parseToJsonElement(
            """{"task":{"id":"s1"},"history":[
              {"at":1,"actor":"app","action":"create","before":null,"after":{"title":"A"}},
              {"at":3,"actor":"agent","action":"update","before":{"title":"A"},"after":{"title":"B"}}]}""",
        )
        val history = RemoteJson.history(value)
        assertEquals(listOf("agent", "app"), history.map { it.actor })
        assertEquals("""{"title":"B"}""", history.first().after)
        assertEquals(null, history.last().before)
    }

    @Test
    fun `repeat rules arrive with numbers as doubles and are read as whole numbers`() {
        val task = RemoteJson.task(
            Json.parseToJsonElement(
                """{"id":"s1","title":"A","status":"todo","isNow":false,"createdAt":1,"updatedAt":2,
                   "repeat":{"every":"month","interval":3.0}}""",
            ).jsonObject,
        )
        assertEquals(RepeatRule(RepeatEvery.MONTH, 3), task.repeat)
        assertEquals(null, RepeatRule.parse(Json.parseToJsonElement("""{"every":"fortnight","interval":1}""")))
        assertEquals(null, RepeatRule.parse(Json.parseToJsonElement("""{"every":"day","interval":1.5}""")))
    }
}
