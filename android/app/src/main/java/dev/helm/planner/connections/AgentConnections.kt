package dev.helm.planner.connections

import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** What an agent may do: read the plan, and change it (docs/oauth.md). */
enum class AgentScope(val wire: String) {
    READ("tasks:read"),
    WRITE("tasks:write"),
    ;

    companion object {
        fun of(wire: String): AgentScope? = entries.firstOrNull { it.wire == wire }
    }
}

/** An agent connection (`listConnections` in `backend/convex/oauthOwner.ts`). */
data class AgentConnection(
    val id: String,
    val clientName: String,
    /** The host Dayhand fetched the client's metadata from; null for a client that registered itself. */
    val clientHost: String?,
    val redirectHost: String,
    val scopes: Set<AgentScope>,
    val createdAt: Long,
    val lastUsedAt: Long?,
    val active: Boolean,
)

/** An authorization request waiting for the owner, found by the code its browser page shows. */
data class ConnectionRequest(
    val code: String,
    val clientName: String,
    val clientHost: String?,
    val redirectHost: String,
    /** The answer goes to a program on the computer that opened the page (Claude Code). */
    val loopback: Boolean,
    val scopes: Set<AgentScope>,
    /** When the page asked: an old request is one the owner may not have started. */
    val createdAt: Long,
    val expiresAt: Long,
)

sealed interface Lookup {
    data class Found(val request: ConnectionRequest) : Lookup
    data object NotFound : Lookup
    data class RateLimited(val retryAfterMs: Long) : Lookup
    data object Unauthorized : Lookup
    data class Failed(val message: String) : Lookup
}

sealed interface Decision {
    data class Approved(val scopes: Set<AgentScope>) : Decision
    data object Denied : Decision

    /** The request expired, was decided elsewhere, or the code was wrong. */
    data object Gone : Decision
    data class RateLimited(val retryAfterMs: Long) : Decision
    data object Unauthorized : Decision
    data class Failed(val message: String) : Decision
}

sealed interface ConnectionsLoad {
    data class Loaded(val connections: List<AgentConnection>) : ConnectionsLoad
    data object Unauthorized : ConnectionsLoad
    data class Failed(val message: String) : ConnectionsLoad
}

/** The code shown on the authorization page as typed on the phone: Crockford base32, 8 characters. */
object ConnectionCode {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val LENGTH = 8

    /** `XXXX-XXXX` (any case, dashes and spaces ignored, `O` read as `0`, `I`/`L` as `1`), or null. */
    fun normalize(input: String): String? {
        val code = input.uppercase()
            .filterNot { it.isWhitespace() || it == '-' }
            .replace('O', '0')
            .replace('I', '1')
            .replace('L', '1')
        if (code.length != LENGTH || code.any { it !in ALPHABET }) return null
        return code.chunked(LENGTH / 2).joinToString("-")
    }
}

/** The app layer's answers about connections, read without trusting their shape. */
object AgentConnectionsJson {
    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
        ?: (this[key] as? JsonPrimitive)?.content?.toDoubleOrNull()?.toLong()

    private fun scopes(value: JsonElement?): Set<AgentScope> =
        (value as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content?.let(AgentScope::of) }.toSet()

    fun connections(value: JsonElement): List<AgentConnection>? = (value as? JsonArray)?.mapNotNull { item ->
        val o = item as? JsonObject ?: return@mapNotNull null
        AgentConnection(
            id = o.string("id") ?: return@mapNotNull null,
            clientName = o.string("clientName") ?: return@mapNotNull null,
            clientHost = o.string("clientHost"),
            redirectHost = o.string("redirectHost").orEmpty(),
            scopes = scopes(o["scopes"]),
            createdAt = o.long("createdAt") ?: 0,
            lastUsedAt = o.long("lastUsedAt"),
            active = (o["active"] as? JsonPrimitive)?.booleanOrNull ?: false,
        )
    }

    fun lookup(code: String, value: JsonElement): Lookup {
        val o = value as? JsonObject ?: return Lookup.Failed("unexpected answer")
        return when (o.string("status")) {
            "found" -> {
                val r = o["request"] as? JsonObject ?: return Lookup.Failed("unexpected answer")
                Lookup.Found(
                    ConnectionRequest(
                        code = code,
                        clientName = r.string("clientName") ?: return Lookup.Failed("unexpected answer"),
                        clientHost = r.string("clientHost"),
                        redirectHost = r.string("redirectHost").orEmpty(),
                        loopback = (r["loopback"] as? JsonPrimitive)?.booleanOrNull ?: false,
                        scopes = scopes(r["scopes"]),
                        createdAt = r.long("createdAt") ?: 0,
                        expiresAt = r.long("expiresAt") ?: 0,
                    ),
                )
            }
            "not_found" -> Lookup.NotFound
            "rate_limited" -> Lookup.RateLimited(o.long("retryAfterMs") ?: 0)
            else -> Lookup.Failed("unexpected answer")
        }
    }

    fun decision(value: JsonElement): Decision {
        val o = value as? JsonObject ?: return Decision.Failed("unexpected answer")
        return when (o.string("status")) {
            "approved" -> Decision.Approved(scopes(o["scopes"]))
            "denied" -> Decision.Denied
            "not_found" -> Decision.Gone
            "rate_limited" -> Decision.RateLimited(o.long("retryAfterMs") ?: 0)
            else -> Decision.Failed("unexpected answer")
        }
    }
}

/**
 * Agent connections through the app layer (`app:listConnections`, `app:revokeConnection`,
 * `app:lookupConnectionRequest`, `app:decideConnectionRequest`), signed in as the paired owner.
 */
class AgentConnectionsApi(private val queries: QueryRunner, private val mutations: MutationSender) {
    suspend fun list(): ConnectionsLoad = when (val result = queries.query(LIST, JsonObject(emptyMap()))) {
        is SendResult.Applied -> AgentConnectionsJson.connections(result.value)?.let { ConnectionsLoad.Loaded(it) }
            ?: ConnectionsLoad.Failed("unexpected answer")
        SendResult.Unauthorized -> ConnectionsLoad.Unauthorized
        is SendResult.Rejected -> ConnectionsLoad.Failed(result.message)
        is SendResult.Failed -> ConnectionsLoad.Failed(result.message)
    }

    /** True when the connection is revoked (or already was). */
    suspend fun revoke(id: String): Boolean =
        mutations.send(REVOKE, buildJsonObject { put("connectionId", id) }) is SendResult.Applied

    suspend fun lookup(code: String): Lookup = when (val result = mutations.send(LOOKUP, buildJsonObject { put("code", code) })) {
        is SendResult.Applied -> AgentConnectionsJson.lookup(code, result.value)
        SendResult.Unauthorized -> Lookup.Unauthorized
        is SendResult.Rejected -> Lookup.Failed(result.message)
        is SendResult.Failed -> Lookup.Failed(result.message)
    }

    suspend fun decide(code: String, approve: Boolean, scopes: Set<AgentScope>): Decision {
        val args = buildJsonObject {
            put("code", code)
            put("approve", approve)
            if (approve) put("scopes", JsonArray(AgentScope.entries.filter { it in scopes }.map { JsonPrimitive(it.wire) }))
        }
        return when (val result = mutations.send(DECIDE, args)) {
            is SendResult.Applied -> AgentConnectionsJson.decision(result.value)
            SendResult.Unauthorized -> Decision.Unauthorized
            is SendResult.Rejected -> Decision.Failed(result.message)
            is SendResult.Failed -> Decision.Failed(result.message)
        }
    }

    companion object {
        const val LIST = "app:listConnections"
        const val REVOKE = "app:revokeConnection"
        const val LOOKUP = "app:lookupConnectionRequest"
        const val DECIDE = "app:decideConnectionRequest"
    }
}
