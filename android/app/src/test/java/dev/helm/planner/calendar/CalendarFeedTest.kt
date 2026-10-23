package dev.helm.planner.calendar

import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarFeedTest {
    private val token = "abcdefghijkl" + "s".repeat(32)
    private val answer = """
        {"url":"https://helm.example/cal/$token.ics","webcalUrl":"webcal://helm.example/cal/$token.ics",
         "googleCalendarUrl":"https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fhelm.example%2Fcal%2F$token.ics",
         "createdAt":1.7926e12}
    """.trimIndent()

    private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

    @Test
    fun `a feed is read with its three addresses`() {
        val feed = CalendarFeedJson.feed(json(answer))!!
        assertEquals("https://helm.example/cal/$token.ics", feed.url)
        assertEquals("webcal://helm.example/cal/$token.ics", feed.webcalUrl)
        assertTrue(feed.googleCalendarUrl.startsWith("https://calendar.google.com/calendar/render?cid="))
        assertEquals(1_792_600_000_000L, feed.createdAt)
    }

    @Test
    fun `null means off, and a link with an unexpected scheme or host is refused`() {
        assertEquals(FeedLoad.Loaded(null), CalendarFeedJson.load(JsonNull))
        assertNull(CalendarFeedJson.feed(json(answer.replace("\"https://helm.example", "\"intent://helm.example"))))
        assertNull(CalendarFeedJson.feed(json(answer.replace("webcal://helm", "javascript://helm"))))
        assertNull(CalendarFeedJson.feed(json(answer.replace("https://calendar.google.com/", "https://evil.example/"))))
        assertTrue(CalendarFeedJson.load(json("[]")) is FeedLoad.Failed)
    }

    @Test
    fun `the api reads with a query, draws a new address in an action and turns off with a mutation`() = runTest {
        val calls = mutableListOf<Pair<String, JsonObject>>()
        val api = CalendarFeedApi(
            queries = { path, args -> calls += path to args; SendResult.Applied(JsonNull) },
            mutations = { path, args -> calls += path to args; SendResult.Applied(json("""{"revoked":true}""")) },
            actions = { path, args -> calls += path to args; SendResult.Applied(json(answer)) },
        )
        assertEquals(FeedLoad.Loaded(null), api.get())
        val created = api.create(replace = true) as FeedLoad.Loaded
        assertEquals("webcal://helm.example/cal/$token.ics", created.feed!!.webcalUrl)
        assertTrue(api.revoke())
        assertEquals(
            listOf(
                "app:getCalendarFeed" to "{}",
                "app:createCalendarFeed" to """{"replace":true}""",
                "app:revokeCalendarFeed" to "{}",
            ),
            calls.map { (path, args) -> path to args.toString() },
        )
    }

    @Test
    fun `a refused sign-in and a lost connection are told apart`() = runTest {
        val unauthorized = CalendarFeedApi({ _, _ -> SendResult.Unauthorized }, { _, _ -> SendResult.Unauthorized }, { _, _ -> SendResult.Unauthorized })
        assertEquals(FeedLoad.Unauthorized, unauthorized.get())
        assertEquals(FeedLoad.Unauthorized, unauthorized.create(replace = false))
        assertFalse(unauthorized.revoke())
        val offline = CalendarFeedApi({ _, _ -> SendResult.Failed("IOException") }, { _, _ -> SendResult.Failed("x") }, { _, _ -> SendResult.Failed("x") })
        assertEquals(FeedLoad.Failed("IOException"), offline.get())
    }
}
