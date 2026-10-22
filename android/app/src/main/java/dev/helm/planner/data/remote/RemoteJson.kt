package dev.helm.planner.data.remote

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

    /** Arguments of [QUERY_TASKS]: everything except the trash, done and archived included. */
    val TASKS_ARGS = mapOf("includeArchived" to true, "includeDone" to true)

    fun tasks(value: JsonElement): List<RemoteTask> = (value as? JsonArray).orEmpty().map { task(it.jsonObject) }

    fun timezone(settings: JsonElement): String? = (settings as? JsonObject)?.string("timezone")

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
    )

    /** The `{code}` a ConvexError carries in its data, e.g. `unauthenticated`. */
    fun errorCode(data: JsonElement?): String? = (data as? JsonObject)?.string("code")

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

    private fun JsonObject.long(key: String): Long? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull?.toLong()
}
