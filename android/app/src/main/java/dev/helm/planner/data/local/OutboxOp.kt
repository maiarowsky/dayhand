package dev.helm.planner.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One local change waiting for the server. Rows are sent strictly in [seq] order and deleted
 * only after the server answered, so they survive the app being killed and the phone rebooting.
 *
 * [argsJson] holds the mutation arguments without `taskId`: the task is named by [taskLocalId]
 * and its server id is filled in at send time, because a task created offline has none yet.
 * [clientId] is also inside [argsJson]; the backend applies an operation with a known
 * `clientId` only once, so resending after a lost answer is safe.
 */
@Entity(
    tableName = "outbox",
    indices = [Index(value = ["opId"], unique = true), Index(value = ["taskLocalId"])],
)
data class OutboxOp(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val opId: String,
    /** Convex function name, e.g. `app:add`. */
    val mutation: String,
    val argsJson: String,
    val taskLocalId: String?,
    val clientId: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

/** Mutations of the app layer (`backend/convex/app.ts`) that the outbox sends. */
object Mutations {
    const val ADD = "app:add"
    const val COMPLETE = "app:complete"
    const val SET_STATUS = "app:setStatus"
    const val RESCHEDULE = "app:reschedule"
    const val ARCHIVE = "app:archive"
    const val SET_NOW = "app:setNow"
    const val UPDATE = "app:update"
    const val UPDATE_SETTINGS = "app:updateSettings"
}
