package dev.helm.planner.domain

import dev.helm.planner.data.local.TaskEvent
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Who made a change, as the backend records it (`actorValidator`). */
enum class Actor { APP, AGENT;

    companion object {
        fun fromWire(value: String): Actor = if (value == "agent") AGENT else APP
    }
}

/** Task fields a history entry can show, in the order they are listed. */
enum class HistoryField(val wire: String) {
    TITLE("title"),
    STATUS("status"),
    NOW("isNow"),
    DUE_DATE("dueDate"),
    DUE_TIME("dueTime"),
    REPEAT("repeat"),
    LABELS("labels"),
    LINKS("links"),
    NOTE("note"),
    RESUME_NOTE("resumeNote"),
}

data class FieldChange(val field: HistoryField, val before: JsonElement, val after: JsonElement)

data class HistoryEntry(val at: Long, val actor: Actor, val action: String, val changes: List<FieldChange>)

/**
 * Reads one cached history row: who, when, which action and the changed fields worth showing.
 * Timestamps (`completedAt`, `deletedAt`, ...) are left out; the action already says it.
 */
fun historyEntry(event: TaskEvent): HistoryEntry {
    val before = parse(event.beforeJson)
    val after = parse(event.afterJson)
    val changes = HistoryField.entries.mapNotNull { field ->
        val old = before[field.wire] ?: JsonNull
        val new = after[field.wire] ?: JsonNull
        when {
            field.wire !in before && field.wire !in after -> null
            // A new task lists every field; only the ones it actually set are worth showing.
            field.wire !in before && isUnset(new) -> null
            else -> FieldChange(field, old, new).takeIf { old != new }
        }
    }
    return HistoryEntry(event.at, Actor.fromWire(event.actor), event.action, changes)
}

private fun isUnset(value: JsonElement) =
    value is JsonNull || value == JsonPrimitive(false) || (value is JsonArray && value.isEmpty())

private fun parse(json: String?): JsonObject {
    if (json == null) return JsonObject(emptyMap())
    return try {
        Json.parseToJsonElement(json) as? JsonObject ?: JsonObject(emptyMap())
    } catch (_: SerializationException) {
        JsonObject(emptyMap())
    }
}
