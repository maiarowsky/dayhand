package dev.helm.planner.data

import dev.helm.planner.data.remote.HttpResponse
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.RemoteEvent
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
    fun `polling feed builds a snapshot from listAll and getSettings`() = runTest {
        val urls = mutableListOf<String>()
        val remote = HttpTaskRemote("http://h", "t", transport = { url, token, body ->
            urls += url
            assertEquals("t", token)
            val path = Json.parseToJsonElement(body).jsonObject.getValue("path").jsonPrimitive.content
            val value = if (path == "app:listAll") {
                """[{"id":"s1","title":"A","status":"todo","isNow":false,"labels":[],"links":[],"createdAt":1.7E12,"updatedAt":1761130000000,"dueDate":"2026-10-22"}]"""
            } else {
                """{"timezone":"Europe/Warsaw","summaryTime":"05:00","defaultReminderMinutes":[0]}"""
            }
            HttpResponse(200, """{"status":"success","value":$value}""")
        })
        val snapshot = remote.events().first() as RemoteEvent.Snapshot
        assertEquals("Europe/Warsaw", snapshot.timezone)
        assertEquals(1761130000000L, snapshot.tasks.single().updatedAt)
        assertEquals(1_700_000_000_000L, snapshot.tasks.single().createdAt)
        assertEquals(listOf("http://h/api/query", "http://h/api/query"), urls)
    }
}
