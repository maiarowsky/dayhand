package dev.helm.planner.connections

import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentConnectionsTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun `codes are read like pairing codes`() {
        assertEquals("K7QF-M2XA", ConnectionCode.normalize("k7qf m2xa"))
        assertEquals("K7QF-M2XA", ConnectionCode.normalize(" K7QF-M2XA "))
        assertEquals("0110-AAAA", ConnectionCode.normalize("OIlO-aaaa"))
        assertNull(ConnectionCode.normalize("K7QF-M2X"))
        assertNull(ConnectionCode.normalize("K7QF-M2XAB"))
        assertNull(ConnectionCode.normalize("K7QF-M2XU"))
    }

    @Test
    fun `connections are read without trusting the answer's shape`() {
        val list = AgentConnectionsJson.connections(
            json(
                """[{"id":"g1","clientName":"Claude","clientType":"cimd","clientHost":"claude.ai","redirectHost":"claude.ai",
                "scopes":["tasks:read","tasks:write","tasks:admin"],"createdAt":1792746905000,"lastUsedAt":null,"expiresAt":1,"revokedAt":null,"active":true},
                {"clientName":"no id"},
                {"id":"g2","clientName":"Tool","clientType":"dcr","clientHost":null,"redirectHost":"localhost","scopes":["tasks:read"],
                "createdAt":1.7927469e12,"lastUsedAt":1792746999000,"active":false}]""",
            ),
        )!!
        assertEquals(2, list.size)
        assertEquals(AgentConnection("g1", "Claude", "claude.ai", "claude.ai", setOf(AgentScope.READ, AgentScope.WRITE), 1792746905000, null, true), list[0])
        assertEquals(null, list[1].clientHost)
        assertEquals(setOf(AgentScope.READ), list[1].scopes)
        assertEquals(1792746999000, list[1].lastUsedAt)
        assertNull(AgentConnectionsJson.connections(json("{}")))
    }

    @Test
    fun `lookup answers`() {
        val found = AgentConnectionsJson.lookup(
            "K7QF-M2XA",
            json("""{"status":"found","request":{"requestId":"r","clientName":"Claude","clientType":"cimd","clientHost":"claude.ai","redirectHost":"claude.ai","loopback":false,"scopes":["tasks:read","tasks:write"],"createdAt":2,"expiresAt":5}}"""),
        )
        assertEquals(
            Lookup.Found(ConnectionRequest("K7QF-M2XA", "Claude", "claude.ai", "claude.ai", false, setOf(AgentScope.READ, AgentScope.WRITE), 2, 5)),
            found,
        )
        assertEquals(Lookup.NotFound, AgentConnectionsJson.lookup("c", json("""{"status":"not_found"}""")))
        assertEquals(Lookup.RateLimited(60000), AgentConnectionsJson.lookup("c", json("""{"status":"rate_limited","retryAfterMs":60000}""")))
        assertTrue(AgentConnectionsJson.lookup("c", json("""{"status":"found"}""")) is Lookup.Failed)
        assertTrue(AgentConnectionsJson.lookup("c", json("[]")) is Lookup.Failed)
    }

    @Test
    fun `decisions`() {
        assertEquals(Decision.Approved(setOf(AgentScope.READ)), AgentConnectionsJson.decision(json("""{"status":"approved","scopes":["tasks:read"]}""")))
        assertEquals(Decision.Denied, AgentConnectionsJson.decision(json("""{"status":"denied"}""")))
        assertEquals(Decision.Gone, AgentConnectionsJson.decision(json("""{"status":"not_found"}""")))
        assertTrue(AgentConnectionsJson.decision(json("""{"status":"what"}""")) is Decision.Failed)
    }

    @Test
    fun `the api calls the app layer with the code and only the chosen scopes`() = runTest {
        val sent = mutableListOf<Pair<String, JsonObject>>()
        val api = AgentConnectionsApi(
            queries = { path, _ -> SendResult.Applied(json(if (path == AgentConnectionsApi.LIST) "[]" else "null")) },
            mutations = { path, args ->
                sent += path to args
                SendResult.Applied(json("""{"status":"approved","scopes":["tasks:read"]}"""))
            },
        )
        assertEquals(ConnectionsLoad.Loaded(emptyList()), api.list())
        assertEquals(Decision.Approved(setOf(AgentScope.READ)), api.decide("K7QF-M2XA", true, setOf(AgentScope.READ)))
        api.decide("K7QF-M2XA", false, setOf(AgentScope.READ, AgentScope.WRITE))
        val (path, approveArgs) = sent[0]
        assertEquals(AgentConnectionsApi.DECIDE, path)
        assertEquals("K7QF-M2XA", approveArgs.getValue("code").jsonPrimitive.content)
        assertEquals(listOf("tasks:read"), approveArgs.getValue("scopes").jsonArray.map { it.jsonPrimitive.content })
        assertTrue("a refusal sends no scopes", "scopes" !in sent[1].second)
    }

    @Test
    fun `refused sign-in and network problems are told apart`() = runTest {
        val unauthorized = AgentConnectionsApi({ _, _ -> SendResult.Unauthorized }, { _, _ -> SendResult.Unauthorized })
        assertEquals(ConnectionsLoad.Unauthorized, unauthorized.list())
        assertEquals(Lookup.Unauthorized, unauthorized.lookup("K7QF-M2XA"))
        val offline = AgentConnectionsApi({ _, _ -> SendResult.Failed("IOException") }, { _, _ -> SendResult.Failed("IOException") })
        assertTrue(offline.list() is ConnectionsLoad.Failed)
        assertEquals(false, offline.revoke("g1"))
    }
}
