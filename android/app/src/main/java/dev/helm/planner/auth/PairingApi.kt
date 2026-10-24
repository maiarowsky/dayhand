package dev.helm.planner.auth

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

data class PairReply(val status: Int, val body: String, val retryAfter: String? = null)

fun interface PairTransport {
    /** POSTs JSON to [url] without credentials; throws [IOException] when there is no answer. */
    suspend fun post(url: String, body: String): PairReply
}

sealed interface PairResult {
    data class Paired(val deviceId: String, val deviceName: String, val deviceToken: String, val convexUrl: String) : PairResult

    /** Wrong, expired, used or burned code: the server gives the same answer for all of them. */
    data object InvalidCode : PairResult

    /** Too many failed attempts on this server; codes are not checked for [retryAfterSeconds]. */
    data class RateLimited(val retryAfterSeconds: Long?) : PairResult

    /** No answer at all (no route, timeout, TLS failure). */
    data class Unreachable(val reason: String) : PairResult

    /** Something answered, but not a Dayhand server (404, HTML, another JSON). */
    data object NotHelm : PairResult

    /** A Dayhand server with a problem of its own (5xx, 400). */
    data class ServerError(val status: Int) : PairResult
}

sealed interface TokenResult {
    /** An app JWT valid until [expiresAt] (Unix ms). */
    data class Issued(val token: String, val expiresAt: Long) : TokenResult

    /** The device was revoked or its token is corrupt: drop it and pair again. */
    data object Revoked : TokenResult

    /** No network, timeout or `503 not_configured`: keep the device token and try later. */
    data class Unavailable(val reason: String) : TokenResult
}

/**
 * `POST /auth/pair` and `POST /auth/token` on the server's HTTP actions URL (docs/pairing.md).
 * The device token is a secret: it is never logged, and failures carry only a status or an
 * exception class name.
 */
class PairingApi(private val transport: PairTransport = UrlConnectionPairTransport) {

    suspend fun pair(serverUrl: String, code: String, deviceName: String): PairResult {
        val body = buildJsonObject {
            put("code", code)
            put("deviceName", deviceName)
        }.toString()
        val reply = try {
            transport.post("$serverUrl/auth/pair", body)
        } catch (e: IOException) {
            return PairResult.Unreachable(e.javaClass.simpleName)
        }
        return when (reply.status) {
            200 -> paired(reply.body) ?: PairResult.NotHelm
            401 -> if (errorOf(reply.body) == "invalid_grant") PairResult.InvalidCode else PairResult.NotHelm
            429 -> PairResult.RateLimited(reply.retryAfter?.trim()?.toLongOrNull())
            400 -> if (errorOf(reply.body) != null) PairResult.ServerError(reply.status) else PairResult.NotHelm
            in 500..599 -> PairResult.ServerError(reply.status)
            else -> PairResult.NotHelm
        }
    }

    suspend fun token(serverUrl: String, deviceToken: String): TokenResult {
        val body = buildJsonObject { put("deviceToken", deviceToken) }.toString()
        val reply = try {
            transport.post("$serverUrl/auth/token", body)
        } catch (e: IOException) {
            return TokenResult.Unavailable(e.javaClass.simpleName)
        }
        // Only the server's own "not valid" ends the pairing; a proxy's 401 or a wrong address must not.
        if (reply.status == 401 && errorOf(reply.body) == "invalid_grant") return TokenResult.Revoked
        if (reply.status != 200) return TokenResult.Unavailable("HTTP ${reply.status}")
        val o = parse(reply.body) ?: return TokenResult.Unavailable("unreadable answer")
        val token = o.string("token") ?: return TokenResult.Unavailable("no token")
        val expiry = o["expiresAt"] as? JsonPrimitive
        val expiresAt = expiry?.longOrNull ?: expiry?.doubleOrNull?.toLong() ?: return TokenResult.Unavailable("no expiry")
        return TokenResult.Issued(token, expiresAt)
    }

    private fun paired(body: String): PairResult.Paired? {
        val o = parse(body) ?: return null
        return PairResult.Paired(
            deviceId = o.string("deviceId") ?: return null,
            deviceName = o.string("deviceName") ?: return null,
            deviceToken = o.string("deviceToken") ?: return null,
            convexUrl = o.string("convexUrl") ?: return null,
        )
    }

    private fun errorOf(body: String): String? = parse(body)?.string("error")

    private fun parse(body: String): JsonObject? = try {
        json.parseToJsonElement(body) as? JsonObject
    } catch (_: SerializationException) {
        null
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private companion object {
        val json = Json { ignoreUnknownKeys = true }
    }
}

/** [PairTransport] on `HttpURLConnection` with fixed timeouts, so a dead network fails fast. */
object UrlConnectionPairTransport : PairTransport {
    private const val TIMEOUT_MS = 15_000

    override suspend fun post(url: String, body: String): PairReply = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            PairReply(
                status = status,
                body = stream?.bufferedReader()?.use { it.readText() }.orEmpty(),
                retryAfter = connection.getHeaderField("Retry-After"),
            )
        } finally {
            connection.disconnect()
        }
    }
}
