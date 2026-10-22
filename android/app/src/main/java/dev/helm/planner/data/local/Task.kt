package dev.helm.planner.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/** Task status, spelled as the backend spells it (`convex/lib/validators.ts`). */
enum class TaskStatus(val wire: String) {
    TODO("todo"),
    DOING("doing"),
    DONE("done");

    companion object {
        fun fromWire(value: String?): TaskStatus = entries.firstOrNull { it.wire == value } ?: TODO
    }
}

/** Repeat unit, spelled as the backend spells it (`repeatValidator`). */
@Serializable
enum class RepeatEvery {
    @SerialName("day") DAY,
    @SerialName("week") WEEK,
    @SerialName("month") MONTH,
    @SerialName("year") YEAR,
}

/** Repeat every [interval] units; for weekly rules [weekdays] (1 = Monday ... 7 = Sunday) picks the days. */
@Serializable
data class RepeatRule(val every: RepeatEvery, val interval: Int = 1, val weekdays: List<Int>? = null) {
    companion object {
        /**
         * A rule as the server sends it. Convex sends every `v.number()` as a JSON double
         * (`"interval": 1.0`), so whole numbers are accepted in either form; anything else is null.
         */
        fun parse(element: JsonElement): RepeatRule? {
            val o = element as? JsonObject ?: return null
            val every = when ((o["every"] as? JsonPrimitive)?.contentOrNull) {
                "day" -> RepeatEvery.DAY
                "week" -> RepeatEvery.WEEK
                "month" -> RepeatEvery.MONTH
                "year" -> RepeatEvery.YEAR
                else -> return null
            }
            val interval = wholeNumber(o["interval"]) ?: return null
            val weekdays = when (val days = o["weekdays"]) {
                null, is JsonNull -> null
                is JsonArray -> days.map { wholeNumber(it) ?: return null }
                else -> return null
            }
            return RepeatRule(every, interval, weekdays)
        }

        private fun wholeNumber(element: JsonElement?): Int? {
            val value = (element as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: return null
            return value.toInt().takeIf { it.toDouble() == value }
        }
    }
}

/** A link attached to a task (version 1 has links only, no files). */
@Serializable
data class TaskLink(val url: String, val title: String? = null)

/**
 * A task as the screens see it. Room is the source of truth for the UI; the server copy
 * arrives through sync and local changes leave through the outbox.
 *
 * [localId] is stable from the moment the task exists on the phone: the `clientId` of the
 * `add` mutation for tasks created here, the server id for tasks created elsewhere.
 */
@Entity(
    tableName = "tasks",
    indices = [Index(value = ["serverId"], unique = true), Index(value = ["clientId"])],
)
data class Task(
    @PrimaryKey val localId: String,
    val serverId: String? = null,
    val clientId: String? = null,
    val title: String,
    val note: String? = null,
    /** Calendar day in the user's time zone, YYYY-MM-DD. */
    val dueDate: String? = null,
    /** Local wall-clock time, HH:MM. */
    val dueTime: String? = null,
    val status: TaskStatus = TaskStatus.TODO,
    val isNow: Boolean = false,
    /** "Where I stopped / next step". */
    val resumeNote: String? = null,
    val completedAt: Long? = null,
    val archivedAt: Long? = null,
    val createdAt: Long,
    val updatedAt: Long,
    /** `updatedAt` of the last server copy merged into this row; null until the server has it. */
    val serverUpdatedAt: Long? = null,
    val repeat: RepeatRule? = null,
    /** Labels, which also serve as projects (the backend has one list for both). */
    @ColumnInfo(defaultValue = "[]") val labels: List<String> = emptyList(),
    @ColumnInfo(defaultValue = "[]") val links: List<TaskLink> = emptyList(),
    /** In the trash since then; the server purges it 30 days later unless restored. */
    val deletedAt: Long? = null,
) {
    val inTrash: Boolean get() = deletedAt != null

    /** Shown on Today and the board: neither archived nor in the trash. */
    val isActive: Boolean get() = archivedAt == null && deletedAt == null
}

/**
 * One entry of a task's change history as the server recorded it, cached so the details
 * screen shows it offline. [actor] is `app` or `agent`; [beforeJson] and [afterJson] hold
 * only the changed fields.
 */
@Entity(tableName = "task_events", indices = [Index(value = ["taskServerId"])])
data class TaskEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val taskServerId: String,
    val at: Long,
    val actor: String,
    val action: String,
    val beforeJson: String?,
    val afterJson: String?,
)
