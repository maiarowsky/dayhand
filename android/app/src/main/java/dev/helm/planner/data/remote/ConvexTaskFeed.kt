package dev.helm.planner.data.remote

import android.content.Context
import dev.convex.android.AuthProvider
import dev.convex.android.ConvexClientWithAuth
import dev.convex.android.ConvexError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Live snapshots through the official Convex client (`dev.convex:android-convexmobile`):
 * the server re-runs the queries on every change and pushes the result over a WebSocket.
 * The client keeps nothing on disk; [dev.helm.planner.sync.SnapshotMerger] writes each
 * snapshot to Room.
 */
class ConvexTaskFeed(deploymentUrl: String, token: String, scope: CoroutineScope) : TaskFeed {
    private val client = ConvexClientWithAuth(deploymentUrl, StaticTokenAuth(token), scope)

    override fun events(): Flow<RemoteEvent> = flow {
        client.loginFromCache()
        val tasks = client.subscribe<JsonElement>(RemoteJson.QUERY_TASKS, RemoteJson.TASKS_ARGS)
        val settings = client.subscribe<JsonElement>(RemoteJson.QUERY_SETTINGS)
        emitAll(
            combine(tasks, settings) { t, s ->
                val failure = t.exceptionOrNull() ?: s.exceptionOrNull()
                if (failure != null) {
                    failure.toEvent()
                } else {
                    RemoteJson.snapshot(t.getOrThrow(), s.getOrThrow())
                }
            },
        )
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
}

/** The app token pasted in Settings; there is no interactive login in this step. */
private class StaticTokenAuth(private val token: String) : AuthProvider<String> {
    override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> = Result.success(token)

    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> = Result.success(token)

    override suspend fun logout(context: Context): Result<Void?> = Result.success(null)

    override fun extractIdToken(authResult: String): String = authResult
}
