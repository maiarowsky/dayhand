package dev.helm.planner.data.remote

import dev.helm.planner.data.local.AcceptanceItem
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.data.local.TaskReminder
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.ReminderRules
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/** Parsing of the app layer's JSON. Convex sends `v.number()` fields as JSON doubles. */
object RemoteJson {
    const val QUERY_TASKS = "app:listAll"
    const val QUERY_SETTINGS = "app:getSettings"
    const val QUERY_TRASH = "app:listTrash"
    const val QUERY_TASK = "app:getTask"
    const val QUERY_EXPORT = "app:exportPlan"

    /** Arguments of [QUERY_TASKS]: everything except the trash, done and archived included. */
    val TASKS_ARGS = mapOf("includeArchived" to true, "includeDone" to true)

    private val json = Json { ignoreUnknownKeys = true }

    fun tasks(value: JsonElement): List<RemoteTask> = (value as? JsonArray).orEmpty().map { task(it.jsonObject) }

    /** Active tasks ([QUERY_TASKS]) and the trash ([QUERY_TRASH]) as one list; a task is in only one of them. */
    fun tasksWithTrash(active: JsonElement, trash: JsonElement): List<RemoteTask> = tasks(active) + tasks(trash)

    fun timezone(settings: JsonElement): String? = (settings as? JsonObject)?.string("timezone")

    /**
     * A snapshot from the results of [QUERY_TASKS], [QUERY_TRASH] and [QUERY_SETTINGS]; missing
     * settings take the backend defaults.
     */
    fun snapshot(tasks: JsonElement, trash: JsonElement, settings: JsonElement): RemoteEvent.Snapshot {
        val s = settings as? JsonObject
        return RemoteEvent.Snapshot(
            tasks = tasksWithTrash(tasks, trash),
            timezone = timezone(settings) ?: HelmDates.DEFAULT_TIMEZONE,
            summaryTime = s?.string("summaryTime") ?: ReminderRules.DEFAULT_SUMMARY_TIME,
            reminderMinutes = (s?.get("defaultReminderMinutes") as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.doubleOrNull?.toInt() }
                ?: ReminderRules.DEFAULT_REMINDER_MINUTES,
        )
    }

    fun task(o: JsonObject) = RemoteTask(
        id = requireNotNull(o.string("id")) { "task without id" },
        clientId = o.string("clientId"),
        title = o.string("title").orEmpty(),
        note = o.string("note"),
        dueDate = o.string("dueDate"),
        dueTime = o.string("dueTime"),
        status = o.string("status") ?: "todo",
        isNow = (o["isNow"] as? JsonPrimitive)?.booleanOrNull ?: false,
        resumeNote = o.string("resumeNote"),
        completedAt = o.long("completedAt"),
        archivedAt = o.long("archivedAt"),
        createdAt = o.long("createdAt") ?: 0,
        updatedAt = o.long("updatedAt") ?: 0,
        repeat = o["repeat"]?.let(RepeatRule::parse),
        labels = (o["labels"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
        links = (o["links"] as? JsonArray).orEmpty().mapNotNull { decodeOrNull(TaskLink.serializer(), it) },
        deletedAt = o.long("deletedAt"),
        checklist = (o["checklist"] as? JsonArray).orEmpty().mapNotNull { decodeOrNull(ChecklistItem.serializer(), it) },
        reminders = (o["reminders"] as? JsonArray)?.mapNotNull(TaskReminder::parse),
        acceptance = (o["acceptance"] as? JsonArray).orEmpty().mapNotNull { decodeOrNull(AcceptanceItem.serializer(), it) },
        proof = o["proof"]?.let { decodeOrNull(TaskProof.serializer(), it) },
        claimName = (o["claimedBy"] as? JsonObject)?.string("name"),
        claimExpiresAt = o.long("claimExpiresAt"),
        ref = o.long("ref"),
        plan = o.string("plan"),
        dependsOn = (o["dependsOn"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content },
        blockedReason = o.string("blockedReason"),
    )

    /** A task's change history from [QUERY_TASK], newest first. */
    fun history(value: JsonElement): List<RemoteHistoryEntry> =
        ((value as? JsonObject)?.get("history") as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .map { e ->
                RemoteHistoryEntry(
                    at = e.long("at") ?: 0,
                    actor = e.string("actor") ?: "app",
                    action = e.string("action") ?: "update",
                    before = (e["before"] as? JsonObject)?.toString(),
                    after = (e["after"] as? JsonObject)?.toString(),
                )
            }
            .sortedByDescending { it.at }

    private fun <T> decodeOrNull(serializer: kotlinx.serialization.KSerializer<T>, element: JsonElement): T? = try {
        if (element is JsonNull) null else json.decodeFromJsonElement(serializer, element)
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    /** The `{code}` a ConvexError carries in its data, e.g. `unauthenticated`. */
    fun errorCode(data: JsonElement?): String? = (data as? JsonObject)?.string("code")

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

    private fun JsonObject.long(key: String): Long? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull?.toLong()
}
