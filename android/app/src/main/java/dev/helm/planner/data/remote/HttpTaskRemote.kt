package dev.helm.planner.data.remote

import dev.helm.planner.auth.AppTokens
import dev.helm.planner.auth.StaticTokens
import dev.helm.planner.auth.TokenResult
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class HttpResponse(val status: Int, val body: String)

fun interface HttpTransport {
    /** POSTs JSON to [url]; throws [IOException] when there is no answer. */
    suspend fun postJson(url: String, token: String, body: String): HttpResponse
}

/**
 * The Convex HTTP API (`POST /api/mutation`, `POST /api/query`), the same calls the official
 * `ConvexHttpClient` makes. A function that failed answers 560 with `{status: "error"}`.
 * The app JWT comes from [tokens]; a refused one is refreshed and the call tried once more.
 */
class HttpTaskRemote(
    private val deploymentUrl: String,
    private val tokens: AppTokens,
    private val transport: HttpTransport = UrlConnectionTransport,
    private val pollIntervalMs: Long = POLL_INTERVAL_MS,
) : TaskRemote {

    constructor(
        deploymentUrl: String,
        token: String,
        transport: HttpTransport = UrlConnectionTransport,
        pollIntervalMs: Long = POLL_INTERVAL_MS,
    ) : this(deploymentUrl, StaticTokens(token), transport, pollIntervalMs)

    override suspend fun send(mutation: String, args: JsonObject): SendResult =
        call("$deploymentUrl/api/mutation", requestBody(mutation, args))

    /** The whole plan as `app:exportPlan` renders it, for [format] `markdown` or `json`. */
    suspend fun exportPlan(format: String, at: Long): SendResult = query(RemoteJson.QUERY_EXPORT, buildJsonObject {
        put("format", format)
        put("at", at)
    })

    override fun events(): Flow<RemoteEvent> = flow {
        while (true) {
            emit(snapshot())
            delay(pollIntervalMs)
        }
    }

    private suspend fun snapshot(): RemoteEvent {
        val tasks = query(RemoteJson.QUERY_TASKS, buildJsonObject {
            RemoteJson.TASKS_ARGS.forEach { (key, value) -> put(key, value) }
        })
        val settings = query(RemoteJson.QUERY_SETTINGS, JsonObject(emptyMap()))
        if (tasks !is SendResult.Applied) return tasks.toEvent()
        if (settings !is SendResult.Applied) return settings.toEvent()
        return RemoteJson.snapshot(tasks.value, settings.value)
    }

    private suspend fun query(path: String, args: JsonObject): SendResult =
        call("$deploymentUrl/api/query", requestBody(path, args))

    private suspend fun call(url: String, body: String): SendResult {
        val first = tokens.token()
        if (first !is TokenResult.Issued) return first.asSendResult()
        val result = post(url, first.token, body)
        if (result != SendResult.Unauthorized) return result
        // The JWT may have expired early (clock skew) or been rotated: one more try with a new one.
        val second = tokens.token(forceRefresh = true)
        if (second !is TokenResult.Issued || second.token == first.token) return result
        return post(url, second.token, body)
    }

    private fun TokenResult.asSendResult(): SendResult = when (this) {
        TokenResult.Revoked -> SendResult.Unauthorized
        is TokenResult.Unavailable -> SendResult.Failed(reason)
        is TokenResult.Issued -> SendResult.Failed("unexpected")
    }

    private suspend fun post(url: String, token: String, body: String): SendResult = try {
        classify(transport.postJson(url, token, body))
    } catch (e: IOException) {
        SendResult.Failed(e.javaClass.simpleName)
    }

    private fun SendResult.toEvent(): RemoteEvent = when (this) {
        SendResult.Unauthorized -> RemoteEvent.Unauthorized
        is SendResult.Rejected -> RemoteEvent.Failed(message)
        is SendResult.Failed -> RemoteEvent.Failed(message)
        is SendResult.Applied -> RemoteEvent.Failed("unexpected")
    }

    companion object {
        const val POLL_INTERVAL_MS = 30_000L
        const val UDF_FAILED = 560
        private val json = Json { ignoreUnknownKeys = true }

        fun requestBody(path: String, args: JsonObject): String = buildJsonObject {
            put("path", path)
            put("format", "convex_encoded_json")
            put("args", JsonArray(listOf(args)))
        }.toString()

        /**
         * Only a function that ran and refused the change is final. Anything else (no answer,
         * 5xx, a wrong address answering 404) keeps the change for a later try, so a
         * misconfigured backend never throws away the user's work.
         */
        fun classify(response: HttpResponse): SendResult {
            if (response.status == 401 || response.status == 403) return SendResult.Unauthorized
            if (response.status != 200 && response.status != UDF_FAILED) {
                return SendResult.Failed("HTTP ${response.status}")
            }
            val body = try {
                json.parseToJsonElement(response.body) as? JsonObject
            } catch (_: SerializationException) {
                null
            } ?: return SendResult.Failed("unreadable answer")
            return when ((body["status"] as? JsonPrimitive)?.content) {
                "success" -> SendResult.Applied(body["value"] ?: JsonObject(emptyMap()))
                "error" -> {
                    val message = (body["errorMessage"] as? JsonPrimitive)?.content ?: "error"
                    if (RemoteJson.errorCode(body["errorData"]) == "unauthenticated") SendResult.Unauthorized
                    else SendResult.Rejected(message)
                }
                else -> SendResult.Failed("unexpected answer")
            }
        }
    }
}

/** [HttpTransport] on `HttpURLConnection`, with fixed timeouts so a dead network fails fast. */
object UrlConnectionTransport : HttpTransport {
    private const val TIMEOUT_MS = 15_000

    override suspend fun postJson(url: String, token: String, body: String): HttpResponse =
        withContext(Dispatchers.IO) {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.outputStream.use { it.write(body.toByteArray()) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                HttpResponse(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
            } finally {
                connection.disconnect()
            }
        }
}
