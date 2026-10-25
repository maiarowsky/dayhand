package dev.helm.planner.data.remote

import dev.helm.planner.data.local.AcceptanceItem
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.data.local.TaskReminder
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
    /** Snapshots of every task, the trash included, with the user's time zone. */
    fun events(): Flow<RemoteEvent>
}

fun interface MutationSender {
    suspend fun send(mutation: String, args: JsonObject): SendResult
}

/** One-off reads, e.g. a task's change history for the details screen. */
fun interface QueryRunner {
    suspend fun query(path: String, args: JsonObject): SendResult
}

/** Convex actions, which may draw random values (a new calendar feed address). */
fun interface ActionRunner {
    suspend fun action(path: String, args: JsonObject): SendResult
}

interface TaskRemote : TaskFeed, MutationSender, QueryRunner

sealed interface RemoteEvent {
    data class Snapshot(
        val tasks: List<RemoteTask>,
        val timezone: String,
        val summaryTime: String = ReminderRules.DEFAULT_SUMMARY_TIME,
        val reminderMinutes: List<Int> = ReminderRules.DEFAULT_REMINDER_MINUTES,
        val projects: List<dev.helm.planner.data.local.Project>? = null,
    ) : RemoteEvent
    data object Unauthorized : RemoteEvent
    data class Failed(val message: String) : RemoteEvent
}

sealed interface SendResult {
    /** The server applied the mutation (or had already applied it: same `clientId`). */
    data class Applied(val value: JsonElement) : SendResult

    /** The server's function refused it for good (bad argument, task gone); resending cannot help. [code] is the error's `code`, if any. */
    data class Rejected(val message: String, val code: String? = null) : SendResult

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
    val repeat: RepeatRule? = null,
    val labels: List<String> = emptyList(),
    val links: List<TaskLink> = emptyList(),
    val deletedAt: Long? = null,
    val checklist: List<ChecklistItem> = emptyList(),
    /** Null: the default reminders from the settings. */
    val reminders: List<TaskReminder>? = null,
    val acceptance: List<AcceptanceItem> = emptyList(),
    val proof: TaskProof? = null,
    val claimName: String? = null,
    val claimExpiresAt: Long? = null,
    val ref: Long? = null,
    val plan: String? = null,
    /** Server ids of the tasks this one waits for. */
    val dependsOn: List<String> = emptyList(),
    val blockedReason: String? = null,
    val projectId: String? = null,
)

/** One entry of a task's history (`getTask` in `backend/convex/lib/views.ts`); before/after as JSON objects. */
data class RemoteHistoryEntry(
    val at: Long,
    val actor: String,
    val action: String,
    val before: String?,
    val after: String?,
)
