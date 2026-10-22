package dev.helm.planner.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceTokensTest {
    private var now = 1_000_000L
    private val replies = ArrayDeque<PairReply>()
    private var calls = 0
    private var revoked = 0

    private val api = PairingApi { _, _ ->
        calls++
        replies.removeFirst()
    }

    private fun tokens() = DeviceTokens("https://x", "helmdev_a.b", api, onRevoked = { revoked++ }, clock = { now })

    private fun issued(token: String, expiresAt: Long) =
        PairReply(200, """{"token":"$token","tokenType":"Bearer","expiresIn":3600,"expiresAt":$expiresAt}""")

    @Test
    fun `a token is reused until five minutes before it ends`() = runTest {
        val tokens = tokens()
        replies += issued("t1", now + HOUR)
        replies += issued("t2", now + 2 * HOUR)
        assertEquals("t1", (tokens.token() as TokenResult.Issued).token)
        now += HOUR - DeviceTokens.REFRESH_MARGIN_MS - 1000
        assertEquals("t1", (tokens.token() as TokenResult.Issued).token)
        assertEquals(1, calls)
        now += 2000
        assertEquals("t2", (tokens.token() as TokenResult.Issued).token)
        assertEquals(2, calls)
    }

    @Test
    fun `a forced refresh asks the server even with a fresh token`() = runTest {
        val tokens = tokens()
        replies += issued("t1", now + HOUR)
        replies += issued("t2", now + HOUR)
        tokens.token()
        assertEquals("t2", (tokens.token(forceRefresh = true) as TokenResult.Issued).token)
    }

    @Test
    fun `without the server a cached token that is still valid is used`() = runTest {
        val tokens = tokens()
        replies += issued("t1", now + HOUR)
        replies += PairReply(503, """{"error":"not_configured"}""")
        tokens.token()
        assertEquals("t1", (tokens.token(forceRefresh = true) as TokenResult.Issued).token)
        assertEquals(0, revoked)
    }

    @Test
    fun `without the server and without a usable token the result is temporary`() = runTest {
        val tokens = tokens()
        replies += PairReply(503, """{"error":"not_configured"}""")
        assertTrue(tokens.token() is TokenResult.Unavailable)
        assertEquals(0, revoked)
    }

    @Test
    fun `a revoked device is dropped`() = runTest {
        val tokens = tokens()
        replies += issued("t1", now + HOUR)
        replies += PairReply(401, """{"error":"invalid_grant","error_description":"The code or token is not valid"}""")
        tokens.token()
        assertEquals(TokenResult.Revoked, tokens.token(forceRefresh = true))
        assertEquals(1, revoked)
    }

    @Test
    fun `a pasted token is used as it is`() = runTest {
        assertEquals(TokenResult.Issued("a.b.c", Long.MAX_VALUE), StaticTokens("a.b.c").token(forceRefresh = true))
    }

    private companion object {
        const val HOUR = 3_600_000L
    }
}
