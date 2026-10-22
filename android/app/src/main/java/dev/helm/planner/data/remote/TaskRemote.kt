package dev.helm.planner.data.remote

import dev.helm.planner.domain.ReminderRules
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The server, seen from the app. Reads arrive as a stream of full snapshots ([TaskFeed]);
 * writes leave one mutation at a time ([MutationSender]). The live screen uses the Convex
 * subscription ([ConvexTaskFeed]); the outbox uses plain HTTP ([HttpTaskRemote]), which can
 * also stand in for the feed by polling.
 */
interface TaskFeed {
    /** Snapshots of every task that is not in the trash, with the user's time zone. */
    fun events(): Flow<RemoteEvent>
}

fun interface MutationSender {
    suspend fun send(mutation: String, args: JsonObject): SendResult
}

interface TaskRemote : TaskFeed, MutationSender

sealed interface RemoteEvent {
    data class Snapshot(
        val tasks: List<RemoteTask>,
        val timezone: String,
        val summaryTime: String = ReminderRules.DEFAULT_SUMMARY_TIME,
        val reminderMinutes: List<Int> = ReminderRules.DEFAULT_REMINDER_MINUTES,
    ) : RemoteEvent
    data object Unauthorized : RemoteEvent
    data class Failed(val message: String) : RemoteEvent
}

sealed interface SendResult {
    /** The server applied the mutation (or had already applied it: same `clientId`). */
    data class Applied(val value: JsonElement) : SendResult

    /** The server's function refused it for good (bad argument, task gone); resending cannot help. */
    data class Rejected(val message: String) : SendResult

    /** The token is missing, wrong or expired; keep the change until the user fixes it. */
    data object Unauthorized : SendResult

    /** No answer or a transient server problem; try again later. */
    data class Failed(val message: String) : SendResult
}

/** A task as the app layer returns it (`toTask` in `backend/convex/lib/core.ts`). */
data class RemoteTask(
    val id: String,
    val clientId: String?,
    val title: String,
    val note: String?,
    val dueDate: String?,
    val dueTime: String?,
    val status: String,
    val isNow: Boolean,
    val resumeNote: String?,
    val completedAt: Long?,
    val archivedAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
)
