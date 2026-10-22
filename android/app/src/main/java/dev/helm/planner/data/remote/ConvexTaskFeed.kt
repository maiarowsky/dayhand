package dev.helm.planner.data.remote

import android.content.Context
import dev.convex.android.AuthProvider
import dev.convex.android.ConvexClientWithAuth
import dev.convex.android.ConvexError
import dev.helm.planner.auth.AppTokens
import dev.helm.planner.auth.DeviceTokens
import dev.helm.planner.auth.TokenResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.ProducerScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Live snapshots through the official Convex client (`dev.convex:android-convexmobile`):
 * the server re-runs the queries on every change and pushes the result over a WebSocket.
 * The client keeps nothing on disk; [dev.helm.planner.sync.SnapshotMerger] writes each
 * snapshot to Room. The app JWT is handed over again before it expires.
 */
class ConvexTaskFeed(
    deploymentUrl: String,
    private val tokens: AppTokens,
    scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) : TaskFeed {
    private val auth = TokenAuth(tokens)
    private val client = ConvexClientWithAuth(deploymentUrl, auth, scope)

    override fun events(): Flow<RemoteEvent> = channelFlow {
        val first = firstToken() ?: return@channelFlow
        client.loginFromCache()
        launch { keepFresh(first.expiresAt) }
        val tasks = client.subscribe<JsonElement>(RemoteJson.QUERY_TASKS, RemoteJson.TASKS_ARGS)
        val settings = client.subscribe<JsonElement>(RemoteJson.QUERY_SETTINGS)
        combine(tasks, settings) { t, s ->
            val failure = t.exceptionOrNull() ?: s.exceptionOrNull()
            if (failure != null) {
                failure.toEvent()
            } else {
                RemoteJson.snapshot(t.getOrThrow(), s.getOrThrow())
            }
        }.collect { send(it) }
    }

    /** Waits for a first token while the server cannot issue one; null when the device was revoked. */
    private suspend fun ProducerScope<RemoteEvent>.firstToken(): TokenResult.Issued? {
        while (true) {
            when (val result = tokens.token()) {
                is TokenResult.Issued -> return result
                TokenResult.Revoked -> {
                    send(RemoteEvent.Unauthorized)
                    return null
                }
                is TokenResult.Unavailable -> {
                    send(RemoteEvent.Failed(result.reason))
                    delay(RETRY_MS)
                }
            }
        }
    }

    /** Fetches a new JWT a few minutes before the current one ends and gives it to the client. */
    private suspend fun ProducerScope<RemoteEvent>.keepFresh(firstExpiresAt: Long) {
        var expiresAt = firstExpiresAt
        while (expiresAt != Long.MAX_VALUE) {
            delay((expiresAt - DeviceTokens.REFRESH_MARGIN_MS - clock()).coerceAtLeast(MIN_WAIT_MS))
            when (val result = tokens.token()) {
                is TokenResult.Issued -> {
                    expiresAt = result.expiresAt
                    auth.push(result.token)
                }
                TokenResult.Revoked -> {
                    send(RemoteEvent.Unauthorized)
                    return
                }
                is TokenResult.Unavailable -> delay(RETRY_MS)
            }
        }
    }

    private fun Throwable.toEvent(): RemoteEvent {
        if (this is ConvexError) {
            val code = try {
                RemoteJson.errorCode(Json.parseToJsonElement(data))
            } catch (_: SerializationException) {
                null
            }
            if (code == "unauthenticated") return RemoteEvent.Unauthorized
        }
        return RemoteEvent.Failed(javaClass.simpleName)
    }

    private companion object {
        const val RETRY_MS = 30_000L
        const val MIN_WAIT_MS = 1_000L
    }
}

/**
 * Gives the Convex client the app JWT. The client asks again (through [loginFromCache]) when
 * the server refuses a token, so after the first login every request gets a new one.
 */
private class TokenAuth(private val tokens: AppTokens) : AuthProvider<String> {
    @Volatile private var onIdToken: ((String?) -> Unit)? = null
    @Volatile private var loggedIn = false

    override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> =
        loginFromCache(onIdToken)

    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> {
        this.onIdToken = onIdToken
        val result = tokens.token(forceRefresh = loggedIn)
        loggedIn = true
        return when (result) {
            is TokenResult.Issued -> Result.success(result.token)
            TokenResult.Revoked -> Result.failure(IllegalStateException("device revoked"))
            is TokenResult.Unavailable -> Result.failure(IllegalStateException("no token: ${result.reason}"))
        }
    }

    /** A token refreshed outside the client: the client re-authenticates its connection with it. */
    fun push(token: String) {
        onIdToken?.invoke(token)
    }

    override suspend fun logout(context: Context): Result<Void?> = Result.success(null)

    override fun extractIdToken(authResult: String): String = authResult
}
