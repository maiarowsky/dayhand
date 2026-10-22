package dev.helm.planner.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Task status, spelled as the backend spells it (`convex/lib/validators.ts`). */
enum class TaskStatus(val wire: String) {
    TODO("todo"),
    DOING("doing"),
    DONE("done");

    companion object {
        fun fromWire(value: String?): TaskStatus = entries.firstOrNull { it.wire == value } ?: TODO
    }
}

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
)
