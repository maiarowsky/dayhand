package dev.helm.planner.data

import dev.helm.planner.auth.AppTokens
import dev.helm.planner.auth.TokenResult
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatFrom
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.WeekdayOfMonth
import dev.helm.planner.data.remote.HttpResponse
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.export.ExportResult
import dev.helm.planner.export.PlanExport
import dev.helm.planner.export.PlanExporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class HttpTaskRemoteTest {
    private fun classify(status: Int, body: String) = HttpTaskRemote.classify(HttpResponse(status, body))

    @Test
    fun `success returns the value`() {
        val result = classify(200, """{"status":"success","value":{"id":"k1"},"logLines":[]}""")
        assertEquals("k1", ((result as SendResult.Applied).value as JsonObject).getValue("id").jsonPrimitive.content)
    }

    @Test
    fun `a function error is final, except a missing sign-in`() {
        assertEquals(
            SendResult.Rejected("title must not be empty", "invalid_argument"),
            classify(560, """{"status":"error","errorMessage":"title must not be empty","errorData":{"code":"invalid_argument"}}"""),
        )
        assertEquals(SendResult.Rejected("ArgumentValidationError"), classify(560, """{"status":"error","errorMessage":"ArgumentValidationError"}"""))
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
                "app:listProjects" -> """[{"id":"p1","name":"Dom","position":1024.0,"createdAt":1.0,"updatedAt":2.0}]"""
                "app:listTrash" ->
                    """[{"id":"s2","title":"B","status":"todo","isNow":false,"labels":[],"links":[],"createdAt":1,"updatedAt":2,"deletedAt":1761130000001}]"""
                else -> """{"timezone":"Europe/Warsaw","summaryTime":"05:30","defaultReminderMinutes":[0,15.0]}"""
            }
            HttpResponse(200, """{"status":"success","value":$value}""")
        })
        val snapshot = remote.events().first() as RemoteEvent.Snapshot
        assertEquals("Europe/Warsaw", snapshot.timezone)
        assertEquals("05:30", snapshot.summaryTime)
        assertEquals(listOf(0, 15), snapshot.reminderMinutes)
        val (active, trashed) = snapshot.tasks
        assertEquals(1761130000000L, active.updatedAt)
        assertEquals(1_700_000_000_000L, active.createdAt)
        assertEquals(listOf("home"), active.labels)
        assertEquals(listOf(TaskLink("https://a.pl", "A")), active.links)
        assertEquals(RepeatRule(RepeatEvery.WEEK, 2, listOf(1, 5)), active.repeat)
        assertEquals(null, active.deletedAt)
        assertEquals(1761130000001L, trashed.deletedAt)
        assertEquals(listOf("http://h/api/query", "http://h/api/query", "http://h/api/query", "http://h/api/query"), urls)
        assertEquals("Dom", snapshot.projects!!.single().name)
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

    @Test
    fun `new repeat fields, the checklist and reminders arrive from the server`() {
        val task = RemoteJson.task(
            Json.parseToJsonElement(
                """{"id":"s1","title":"A","status":"todo","isNow":false,"createdAt":1,"updatedAt":2,
                   "repeat":{"every":"month","interval":1.0,"from":"completion","weekdayOfMonth":{"nth":-1.0,"weekday":5.0},"count":3.0},
                   "rrule":"FREQ=MONTHLY;BYDAY=-1FR;COUNT=3",
                   "checklist":[{"id":"c1","title":"Milk","done":true},{"id":"c2","title":"Bread","done":false}],
                   "reminders":[{"minutesBefore":15.0},{"time":"18:00","daysBefore":1.0},{"time":"bad"},{"other":1}]}""",
            ).jsonObject,
        )
        assertEquals(
            RepeatRule(RepeatEvery.MONTH, from = RepeatFrom.COMPLETION, weekdayOfMonth = WeekdayOfMonth(-1, 5), count = 3),
            task.repeat,
        )
        assertEquals(listOf(ChecklistItem("c1", "Milk", true), ChecklistItem("c2", "Bread")), task.checklist)
        // Anything that is not a reminder is dropped; an odd time is kept for the rules to refuse.
        assertEquals(listOf(TaskReminder.before(15), TaskReminder.at("18:00", 1), TaskReminder.at("bad")), task.reminders)
    }

    @Test
    fun `a task from an older server has an empty checklist and the default reminders`() {
        val task = RemoteJson.task(
            Json.parseToJsonElement("""{"id":"s1","title":"A","status":"todo","isNow":false,"createdAt":1,"updatedAt":2}""").jsonObject,
        )
        assertEquals(emptyList<ChecklistItem>(), task.checklist)
        assertEquals(null, task.reminders)
        val silent = RemoteJson.task(
            Json.parseToJsonElement("""{"id":"s1","title":"A","status":"todo","isNow":false,"createdAt":1,"updatedAt":2,"reminders":[]}""").jsonObject,
        )
        assertEquals(emptyList<TaskReminder>(), silent.reminders)
    }

    @Test
    fun `settings without reminder fields take the backend defaults`() {
        val snapshot = RemoteJson.snapshot(JsonArray(emptyList()), JsonArray(emptyList()), Json.parseToJsonElement("""{"timezone":"Europe/Warsaw"}"""))
        assertEquals("05:00", snapshot.summaryTime)
        assertEquals(listOf(0), snapshot.reminderMinutes)
    }

    @Test
    fun `export asks app exportPlan with the format and time`() = runTest {
        var sent: JsonObject? = null
        val remote = HttpTaskRemote("http://h", "t", transport = { url, _, body ->
            assertEquals("http://h/api/query", url)
            sent = Json.parseToJsonElement(body).jsonObject
            HttpResponse(200, """{"status":"success","value":{"format":"markdown","content":"# Dayhand plan"}}""")
        })
        val result = PlanExporter(remote).export(ExportFormat.MARKDOWN, at = 1_761_130_000_000L, today = "2026-10-22")
        assertEquals(ExportResult.Ready(ExportFormat.MARKDOWN, "dayhand-plan-2026-10-22.md", "# Dayhand plan"), result)
        assertEquals("app:exportPlan", sent!!.getValue("path").jsonPrimitive.content)
        val args = sent!!.getValue("args").jsonArray[0].jsonObject
        assertEquals("markdown", args.getValue("format").jsonPrimitive.content)
        assertEquals(1_761_130_000_000L, args.getValue("at").jsonPrimitive.content.toLong())
    }

    @Test
    fun `JSON export is the server copy, indented`() {
        val value = Json.parseToJsonElement("""{"format":"json","content":{"version":1,"tasks":[{"title":"A"}]}}""")
        val content = PlanExport.content(ExportFormat.JSON, value)!!
        assertTrue(content.startsWith("{\n    \"version\": 1,"))
        assertEquals(Json.parseToJsonElement("""{"version":1,"tasks":[{"title":"A"}]}"""), Json.parseToJsonElement(content))
        assertEquals(null, PlanExport.content(ExportFormat.MARKDOWN, value))
    }

    @Test
    fun `export without a server answer or with a refused token says so`() = runTest {
        val offline = HttpTaskRemote("http://h", "t", transport = { _, _, _ -> throw IOException("no route") })
        assertTrue(PlanExporter(offline).export(ExportFormat.JSON, 0, "2026-10-22") is ExportResult.Failed)
        val refused = HttpTaskRemote("http://h", "t", transport = { _, _, _ -> HttpResponse(401, "") })
        assertEquals(ExportResult.Unauthorized, PlanExporter(refused).export(ExportFormat.JSON, 0, "2026-10-22"))
    }

    @Test
    fun `a refused app token is refreshed once and the call repeated`() = runTest {
        val tokens = object : AppTokens {
            var issued = 0
            override suspend fun token(forceRefresh: Boolean): TokenResult {
                if (forceRefresh || issued == 0) issued++
                return TokenResult.Issued("jwt$issued", Long.MAX_VALUE)
            }
        }
        val seen = mutableListOf<String>()
        val remote = HttpTaskRemote("http://h", tokens, transport = { _, token, _ ->
            seen += token
            if (token == "jwt1") HttpResponse(401, "") else HttpResponse(200, """{"status":"success","value":null}""")
        })
        assertTrue(remote.send("app:add", buildJsonObject { put("title", "x") }) is SendResult.Applied)
        assertEquals(listOf("jwt1", "jwt2"), seen)
    }

    @Test
    fun `a revoked device or a missing token keeps the change`() = runTest {
        val revoked = HttpTaskRemote("http://h", object : AppTokens {
            override suspend fun token(forceRefresh: Boolean) = TokenResult.Revoked
        }, transport = { _, _, _ -> error("must not be called") })
        assertEquals(SendResult.Unauthorized, revoked.send("app:add", JsonObject(emptyMap())))
        val unavailable = HttpTaskRemote("http://h", object : AppTokens {
            override suspend fun token(forceRefresh: Boolean) = TokenResult.Unavailable("HTTP 503")
        }, transport = { _, _, _ -> error("must not be called") })
        assertTrue(unavailable.send("app:add", JsonObject(emptyMap())) is SendResult.Failed)
    }
}
