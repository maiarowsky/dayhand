package dev.helm.planner.data

import androidx.room.withTransaction
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskEvent
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteHistoryEntry
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.sync.SnapshotMerger
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Every user action changes the local row and appends its server mutation to the outbox in
 * one Room transaction, so the screen updates at once and the change cannot be lost or sent
 * without being shown.
 */
class TaskRepository(
    private val db: HelmDatabase,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val onOutboxChanged: () -> Unit = {},
) {
    val tasks: Flow<List<Task>> = db.tasks().observeAll()
    val pendingChanges: Flow<Int> = db.outbox().observeCount()

    fun task(localId: String): Flow<Task?> = db.tasks().observe(localId)

    fun pendingChangesFor(localId: String): Flow<Int> = db.outbox().observeCountFor(localId)

    /** The cached change history of a task the server knows, newest first. */
    fun history(serverId: String): Flow<List<TaskEvent>> = db.events().observe(serverId)

    /** Adds a task; [dueTime] is kept only together with [dueDate], as the backend requires. */
    suspend fun add(title: String, dueDate: String?, dueTime: String?, note: String?): Task {
        val cleanTitle = title.trim()
        require(cleanTitle.isNotEmpty() && cleanTitle.length <= MAX_TITLE) { "title must be 1 to $MAX_TITLE characters" }
        val now = clock()
        val localId = newId()
        val time = dueTime.takeIf { dueDate != null }
        val cleanNote = note?.takeIf { it.isNotBlank() }
        require((cleanNote?.length ?: 0) <= MAX_NOTE) { "note is longer than $MAX_NOTE characters" }
        val task = Task(
            localId = localId,
            clientId = localId,
            title = cleanTitle,
            note = cleanNote,
            dueDate = dueDate,
            dueTime = time,
            createdAt = now,
            updatedAt = now,
        )
        val args = buildJsonObject {
            put("title", cleanTitle)
            cleanNote?.let { put("note", it) }
            dueDate?.let { put("dueDate", it) }
            time?.let { put("dueTime", it) }
        }
        db.withTransaction {
            db.tasks().upsert(listOf(task))
            enqueue(Mutations.ADD, localId, args, clientId = localId, now = now)
        }
        onOutboxChanged()
        return task
    }

    suspend fun complete(localId: String) = edit(localId, Mutations.COMPLETE) { task, now ->
        task.copy(status = TaskStatus.DONE, completedAt = now, isNow = false)
    }

    /** Back from done to the to-do list. */
    suspend fun reopen(localId: String) = edit(localId, Mutations.SET_STATUS, { put("status", TaskStatus.TODO.wire) }) { task, _ ->
        task.copy(status = TaskStatus.TODO, completedAt = null, isNow = false)
    }

    /**
     * Moves a task to another board column: to do and in progress through `setStatus`, done
     * through `complete` (which also creates a repeating task's next occurrence on the server).
     * Leaving "in progress" ends the "now" flag, as on the server.
     */
    suspend fun moveTo(localId: String, status: TaskStatus) {
        val current = db.tasks().byLocalId(localId) ?: return
        if (current.status == status) return
        when (status) {
            TaskStatus.DONE -> complete(localId)
            TaskStatus.TODO -> reopen(localId)
            TaskStatus.DOING -> edit(localId, Mutations.SET_STATUS, { put("status", TaskStatus.DOING.wire) }) { task, _ ->
                task.copy(status = TaskStatus.DOING, completedAt = null)
            }
        }
    }

    suspend fun rename(localId: String, title: String) {
        val clean = requireNotNull(TaskRules.title(title)) { "title must be 1 to $MAX_TITLE characters" }
        edit(localId, Mutations.UPDATE, { put("title", clean) }) { task, _ -> task.copy(title = clean) }
    }

    /** Sets the note; a blank note clears it. */
    suspend fun setNote(localId: String, note: String) {
        val clean = note.takeIf { it.isNotBlank() }
        require((clean?.length ?: 0) <= MAX_NOTE) { "note is longer than $MAX_NOTE characters" }
        edit(localId, Mutations.UPDATE, { put("note", clean.orNull()) }) { task, _ -> task.copy(note = clean) }
    }

    /** Sets the day ([date], YYYY-MM-DD) and the optional [time] (HH:MM); no day clears both. */
    suspend fun setDue(localId: String, date: String?, time: String?) {
        val cleanTime = time.takeIf { date != null }
        edit(localId, Mutations.UPDATE, {
            put("dueDate", date.orNull())
            put("dueTime", cleanTime.orNull())
        }) { task, _ -> task.copy(dueDate = date, dueTime = cleanTime) }
    }

    /** Sets the repeat rule; null stops repeating. */
    suspend fun setRepeat(localId: String, rule: RepeatRule?) {
        require(rule == null || TaskRules.isValid(rule)) { "invalid repeat rule" }
        val value: JsonElement = rule?.let { Json.encodeToJsonElement(RepeatRule.serializer(), it) } ?: JsonNull
        edit(localId, Mutations.UPDATE, { put("repeat", value) }) { task, _ -> task.copy(repeat = rule) }
    }

    /** Sets the labels (which also serve as projects), cleaned as the backend cleans them. */
    suspend fun setLabels(localId: String, labels: List<String>) {
        val clean = requireNotNull(TaskRules.labels(labels)) { "too many or too long labels" }
        edit(localId, Mutations.UPDATE, { put("labels", JsonArray(clean.map(::JsonPrimitive))) }) { task, _ ->
            task.copy(labels = clean)
        }
    }

    suspend fun setLinks(localId: String, links: List<TaskLink>) {
        require(links.size <= TaskRules.MAX_LINKS && links.all { TaskRules.isLinkUrl(it.url) }) { "invalid links" }
        val value = JsonArray(links.map { Json.encodeToJsonElement(TaskLink.serializer(), it) })
        edit(localId, Mutations.UPDATE, { put("links", value) }) { task, _ -> task.copy(links = links) }
    }

    /** Moves a task to the trash; the server keeps it there for 30 days. */
    suspend fun moveToTrash(localId: String) = edit(localId, Mutations.SOFT_DELETE) { task, now ->
        task.copy(deletedAt = now, isNow = false)
    }

    /** Brings a task back from the trash, or from the archive when it is not in the trash (backend `restore`). */
    suspend fun restore(localId: String) = edit(localId, Mutations.RESTORE) { task, _ ->
        if (task.deletedAt != null) task.copy(deletedAt = null) else task.copy(archivedAt = null)
    }

    /** Replaces the cached history of [serverId] with the server's copy. */
    suspend fun saveHistory(serverId: String, entries: List<RemoteHistoryEntry>) {
        db.events().replace(
            serverId,
            entries.map { TaskEvent(taskServerId = serverId, at = it.at, actor = it.actor, action = it.action, beforeJson = it.before, afterJson = it.after) },
        )
    }

    /** Moves a task to [date] (YYYY-MM-DD), keeping its time. */
    suspend fun reschedule(localId: String, date: String) = edit(localId, Mutations.RESCHEDULE, { put("dueDate", date) }) { task, _ ->
        task.copy(dueDate = date)
    }

    suspend fun archive(localId: String) = edit(localId, Mutations.ARCHIVE) { task, now ->
        task.copy(archivedAt = now, isNow = false)
    }

    suspend fun setResumeNote(localId: String, note: String) {
        val clean = note.trim().takeIf { it.isNotEmpty() }
        require((clean?.length ?: 0) <= MAX_RESUME_NOTE) { "note is longer than $MAX_RESUME_NOTE characters" }
        edit(localId, Mutations.UPDATE, { put("resumeNote", clean?.let { JsonPrimitive(it) } ?: JsonNull) }) { task, _ ->
            task.copy(resumeNote = clean)
        }
    }

    /** Makes [localId] the single "now" task (status doing), as the backend's `setNow` does. */
    suspend fun setNow(localId: String) {
        val now = clock()
        val changed = db.withTransaction {
            val target = db.tasks().byLocalId(localId) ?: return@withTransaction false
            val others = db.tasks().nowTasks().filter { it.localId != localId }
            db.tasks().upsert(
                others.map { it.copy(isNow = false, updatedAt = now) } +
                    target.copy(isNow = true, status = TaskStatus.DOING, completedAt = null, updatedAt = now),
            )
            enqueue(Mutations.SET_NOW, localId, JsonObject(emptyMap()), now = now)
            true
        }
        if (changed) onOutboxChanged()
    }

    /** No task is "now" any more. */
    suspend fun clearNow() {
        val now = clock()
        db.withTransaction {
            db.tasks().upsert(db.tasks().nowTasks().map { it.copy(isNow = false, updatedAt = now) })
            enqueue(Mutations.SET_NOW, null, buildJsonObject { put("taskId", JsonNull) }, now = now)
        }
        onOutboxChanged()
    }

    /**
     * Queues a change of the server settings (`summaryTime`, `defaultReminderMinutes`); the
     * caller has already stored the new value on the phone.
     */
    suspend fun queueSettingsChange(args: JsonObject) {
        enqueue(Mutations.UPDATE_SETTINGS, null, args, now = clock())
        onOutboxChanged()
    }

    /** True while a settings change waits in the outbox, so a snapshot must not overwrite it. */
    suspend fun hasPendingSettingsChange(): Boolean = db.outbox().countFor(Mutations.UPDATE_SETTINGS) > 0

    /** Writes a server snapshot into Room (see [SnapshotMerger]). */
    suspend fun applySnapshot(snapshot: RemoteEvent.Snapshot) {
        db.withTransaction {
            val plan = SnapshotMerger.merge(db.tasks().all(), db.outbox().all(), snapshot.tasks, clock())
            if (plan.upserts.isNotEmpty()) db.tasks().upsert(plan.upserts)
            if (plan.deletes.isNotEmpty()) {
                db.tasks().delete(plan.deletes)
                db.events().deleteOrphans()
            }
        }
    }

    private suspend fun edit(
        localId: String,
        mutation: String,
        args: JsonObjectBuilder.() -> Unit = {},
        change: (Task, Long) -> Task,
    ) {
        val now = clock()
        val changed = db.withTransaction {
            val task = db.tasks().byLocalId(localId) ?: return@withTransaction false
            // The server refuses every other change to a task in the trash; restore it first.
            if (task.inTrash && mutation != Mutations.RESTORE) return@withTransaction false
            db.tasks().upsert(listOf(change(task, now).copy(updatedAt = now)))
            enqueue(mutation, localId, buildJsonObject(args), now = now)
            true
        }
        if (changed) onOutboxChanged()
    }

    /** Appends a change; its `clientId` makes the server apply it once however often it is sent. */
    private suspend fun enqueue(mutation: String, taskLocalId: String?, args: JsonObject, now: Long, clientId: String = newId()) {
        val withClientId = JsonObject(args + ("clientId" to JsonPrimitive(clientId)))
        db.outbox().insert(
            OutboxOp(
                opId = if (mutation == Mutations.ADD) newId() else clientId,
                mutation = mutation,
                argsJson = withClientId.toString(),
                taskLocalId = taskLocalId,
                clientId = clientId,
                createdAt = now,
            ),
        )
    }

    private fun String?.orNull(): JsonElement = this?.let(::JsonPrimitive) ?: JsonNull

    companion object {
        /** Backend limits (`LIMITS` in `backend/convex/lib/core.ts`). */
        const val MAX_TITLE = TaskRules.MAX_TITLE
        const val MAX_NOTE = TaskRules.MAX_NOTE
        const val MAX_RESUME_NOTE = TaskRules.MAX_RESUME_NOTE
    }
}
