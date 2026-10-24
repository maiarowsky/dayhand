package dev.helm.planner.auth

import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingApiTest {
    private val invalid = """{"error":"invalid_grant","error_description":"The code or token is not valid"}"""

    private fun api(reply: PairReply) = PairingApi { _, _ -> reply }

    @Test
    fun `pair posts the code and the device name to auth pair`() = runTest {
        var seenUrl = ""
        var seenBody = ""
        val api = PairingApi { url, body ->
            seenUrl = url
            seenBody = body
            PairReply(200, """{"deviceId":"jd7","deviceName":"Pixel 9","deviceToken":"helmdev_a.b","convexUrl":"https://x.convex.cloud"}""")
        }
        val result = api.pair("https://x.convex.site", "E6M8-FE02-XSNT", "Pixel 9")
        assertEquals(PairResult.Paired("jd7", "Pixel 9", "helmdev_a.b", "https://x.convex.cloud"), result)
        assertEquals("https://x.convex.site/auth/pair", seenUrl)
        val body = Json.parseToJsonElement(seenBody).jsonObject
        assertEquals("E6M8-FE02-XSNT", body.getValue("code").jsonPrimitive.content)
        assertEquals("Pixel 9", body.getValue("deviceName").jsonPrimitive.content)
    }

    @Test
    fun `pair answers are told apart`() = runTest {
        assertEquals(PairResult.InvalidCode, api(PairReply(401, invalid)).pair("https://x", "c", "n"))
        assertEquals(PairResult.RateLimited(540), api(PairReply(429, """{"error":"rate_limited"}""", retryAfter = "540")).pair("https://x", "c", "n"))
        assertEquals(PairResult.RateLimited(null), api(PairReply(429, "")).pair("https://x", "c", "n"))
        assertEquals(PairResult.ServerError(500), api(PairReply(500, "")).pair("https://x", "c", "n"))
        assertEquals(PairResult.ServerError(400), api(PairReply(400, """{"error":"invalid_request"}""")).pair("https://x", "c", "n"))
        assertTrue(PairingApi { _, _ -> throw IOException("no route") }.pair("https://x", "c", "n") is PairResult.Unreachable)
    }

    @Test
    fun `an address that is not a Dayhand server is recognized`() = runTest {
        assertEquals(PairResult.NotHelm, api(PairReply(404, "Not found")).pair("https://x", "c", "n"))
        assertEquals(PairResult.NotHelm, api(PairReply(200, "<html>login</html>")).pair("https://x", "c", "n"))
        assertEquals(PairResult.NotHelm, api(PairReply(200, """{"status":"ok"}""")).pair("https://x", "c", "n"))
        assertEquals(PairResult.NotHelm, api(PairReply(401, "Unauthorized")).pair("https://x", "c", "n"))
    }

    @Test
    fun `token returns the JWT and its expiry`() = runTest {
        var seenUrl = ""
        val api = PairingApi { url, _ ->
            seenUrl = url
            PairReply(200, """{"token":"a.b.c","tokenType":"Bearer","expiresIn":3600,"expiresAt":1792691766000}""")
        }
        assertEquals(TokenResult.Issued("a.b.c", 1792691766000), api.token("https://x.convex.site", "helmdev_a.b"))
        assertEquals("https://x.convex.site/auth/token", seenUrl)
    }

    @Test
    fun `only the server's invalid grant revokes, everything else is temporary`() = runTest {
        assertEquals(TokenResult.Revoked, api(PairReply(401, invalid)).token("https://x", "t"))
        assertTrue(api(PairReply(401, "proxy says no")).token("https://x", "t") is TokenResult.Unavailable)
        assertTrue(api(PairReply(503, """{"error":"not_configured"}""")).token("https://x", "t") is TokenResult.Unavailable)
        assertTrue(api(PairReply(200, "garbage")).token("https://x", "t") is TokenResult.Unavailable)
        assertTrue(PairingApi { _, _ -> throw IOException("timeout") }.token("https://x", "t") is TokenResult.Unavailable)
    }
}
