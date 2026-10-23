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

/** Where the next date of a repeating task is counted from (`repeatValidator.from`). */
@Serializable
enum class RepeatFrom {
    @SerialName("due") DUE,
    @SerialName("completion") COMPLETION,
}

/** The [nth] (1 to 5, or -1 = last to -5) [weekday] (1 = Monday) of a month: "the 2nd Tuesday". */
@Serializable
data class WeekdayOfMonth(val nth: Int, val weekday: Int)

/**
 * Repeat every [interval] units; for weekly rules [weekdays] (1 = Monday ... 7 = Sunday) picks the days. Monthly rules
 * may pin [monthDay] (1 to 31, -1 = the last day) or [weekdayOfMonth]. [from] counts the next date from the due date
 * (null or DUE) or from the day the task is done; [until] (the last date) or [count] (occurrences left, this one
 * included) end the series. The backend's `repeatValidator`; the dates are in [dev.helm.planner.domain.Recurrence].
 */
@Serializable
data class RepeatRule(
    val every: RepeatEvery,
    val interval: Int = 1,
    val weekdays: List<Int>? = null,
    val from: RepeatFrom? = null,
    val monthDay: Int? = null,
    val weekdayOfMonth: WeekdayOfMonth? = null,
    val until: String? = null,
    val count: Int? = null,
) {
    val fromCompletion: Boolean get() = from == RepeatFrom.COMPLETION

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
            val from = when ((o["from"] as? JsonPrimitive)?.contentOrNull) {
                "completion" -> RepeatFrom.COMPLETION
                "due" -> RepeatFrom.DUE
                else -> null
            }
            val weekdayOfMonth = (o["weekdayOfMonth"] as? JsonObject)?.let { w ->
                WeekdayOfMonth(wholeNumber(w["nth"]) ?: return null, wholeNumber(w["weekday"]) ?: return null)
            }
            return RepeatRule(
                every = every,
                interval = interval,
                weekdays = weekdays,
                from = from,
                monthDay = wholeNumber(o["monthDay"]),
                weekdayOfMonth = weekdayOfMonth,
                until = (o["until"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
                count = wholeNumber(o["count"]),
            )
        }

        internal fun wholeNumber(element: JsonElement?): Int? {
            val value = (element as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: return null
            return value.toInt().takeIf { it.toDouble() == value }
        }
    }
}

/** One checklist item; the list's order is the order shown. [id] stays with the item across edits. */
@Serializable
data class ChecklistItem(val id: String, val title: String, val done: Boolean = false)

/**
 * One reminder of a task (`reminderValidator`): [minutesBefore] its due time (timed tasks only), or [time] (HH:MM) on
 * the due day or [daysBefore] days earlier. Exactly one of [minutesBefore] and [time] is set.
 */
@Serializable
data class TaskReminder(val minutesBefore: Int? = null, val time: String? = null, val daysBefore: Int? = null) {
    companion object {
        fun before(minutes: Int) = TaskReminder(minutesBefore = minutes)

        fun at(time: String, daysBefore: Int = 0) = TaskReminder(time = time, daysBefore = daysBefore.takeIf { it > 0 })

        /** A reminder as the server sends it (numbers as JSON doubles); anything else is null. */
        fun parse(element: JsonElement): TaskReminder? {
            val o = element as? JsonObject ?: return null
            RepeatRule.wholeNumber(o["minutesBefore"])?.let { return before(it) }
            val time = (o["time"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            return at(time, RepeatRule.wholeNumber(o["daysBefore"]) ?: 0)
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
    @ColumnInfo(defaultValue = "[]") val checklist: List<ChecklistItem> = emptyList(),
    /** This task's own reminders; null = the default reminders from the settings, empty = none. */
    val reminders: List<TaskReminder>? = null,
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
