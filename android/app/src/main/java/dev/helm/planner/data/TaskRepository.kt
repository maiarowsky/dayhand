package dev.helm.planner.data

import androidx.room.withTransaction
import dev.helm.planner.backup.BackupTask
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.FieldJson
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskEvent
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteHistoryEntry
import dev.helm.planner.domain.Recurrence
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.sample.SamplePlan
import dev.helm.planner.sync.MissingTasks
import dev.helm.planner.sync.SnapshotMerger
import dev.helm.planner.sync.dropAssignment
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What a restore did: tasks [added], tasks [alreadyHere] (same id on the phone) and skipped. */
data class RestoreResult(val added: Int, val alreadyHere: Int)

/**
 * Every user action changes the local row and appends its server mutation to the outbox in
 * one Room transaction, so the screen updates at once and the change cannot be lost or sent
 * without being shown. Sample tasks ([SamplePlan]) change only on the phone.
 */
class TaskRepository(
    private val db: HelmDatabase,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val onOutboxChanged: () -> Unit = {},
    /**
     * Today (YYYY-MM-DD in the user's zone) while the phone has no server, which then makes a repeating task's next
     * occurrence itself; null when a server does it on `complete`.
     */
    private val repeatsOnPhone: suspend () -> String? = { null },
    projectRemote: suspend () -> dev.helm.planner.data.remote.TaskRemote? = { null },
    /** Reads a known task the snapshot's lists both miss ([MissingTasks]); null without a server. */
    private val taskQueries: suspend () -> dev.helm.planner.data.remote.QueryRunner? = { null },
) {
    val projectStore = ProjectRepository(db, newId, projectRemote, ::applySnapshot)
    val projects = projectStore.projects
    val tasks: Flow<List<Task>> = db.tasks().observeAll()
    val pendingChanges: Flow<Int> = db.outbox().observeCount()

    fun task(localId: String): Flow<Task?> = db.tasks().observe(localId)

    fun pendingChangesFor(localId: String): Flow<Int> = db.outbox().observeCountFor(localId)

    /** The cached change history of a task the server knows, newest first. */
    fun history(serverId: String): Flow<List<TaskEvent>> = db.events().observe(serverId)

    /** Adds a task; [dueTime] is kept only together with [dueDate], as the backend requires. */
    suspend fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String? = null): Task {
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
            projectId = projectId,
            title = cleanTitle,
            note = cleanNote,
            dueDate = dueDate,
            dueTime = time,
            createdAt = now,
            updatedAt = now,
        )
        val args = buildJsonObject {
            put("title", cleanTitle)
            projectId?.let { put("projectId", it) }
            cleanNote?.let { put("note", it) }
            dueDate?.let { put("dueDate", it) }
            time?.let { put("dueTime", it) }
        }
        db.withTransaction {
            projectId?.let { require(db.projects().byLocalId(it)?.assignable == true) { "project is not confirmed and active" } }
            db.tasks().upsert(listOf(task))
            enqueue(Mutations.ADD, localId, args, clientId = localId, now = now)
        }
        onOutboxChanged()
        return task
    }

    /**
     * Marks a task done. Without a server the phone adds a repeating task's next occurrence itself (as the backend's
     * `complete` would) and queues it as a task of its own; the done task loses its rule first, so the server, once
     * connected, does not add another one.
     */
    suspend fun complete(localId: String) {
        val today = repeatsOnPhone()
        val now = clock()
        val changed = db.withTransaction {
            val task = db.tasks().byLocalId(localId) ?: return@withTransaction false
            if (task.inTrash) return@withTransaction false
            val done = task.copy(status = TaskStatus.DONE, completedAt = now, isNow = false, updatedAt = now)
            val rule = task.repeat
            if (today == null || rule == null || task.status == TaskStatus.DONE) {
                db.tasks().upsert(listOf(done))
                enqueue(Mutations.COMPLETE, localId, JsonObject(emptyMap()), now = now)
                return@withTransaction true
            }
            val next = Recurrence.advance(rule, task.dueDate, today)?.let { occurrence ->
                val id = if (SamplePlan.isSample(localId)) SamplePlan.ID_PREFIX + newId() else newId()
                Task(
                    localId = id,
                    clientId = id,
                    title = task.title,
                    projectId = task.projectId,
                    note = task.note,
                    dueDate = occurrence.dueDate,
                    dueTime = task.dueTime,
                    repeat = occurrence.repeat,
                    links = task.links,
                    checklist = task.checklist.map { it.copy(done = false) },
                    reminders = task.reminders,
                    createdAt = now,
                    updatedAt = now,
                )
            }
            db.tasks().upsert(listOfNotNull(done.copy(repeat = null), next))
            val completedBy = newId()
            enqueue(Mutations.UPDATE, localId, buildJsonObject { put("repeat", JsonNull) }, now = now)
            enqueue(Mutations.COMPLETE, localId, JsonObject(emptyMap()), now = now, clientId = completedBy)
            next?.let { occurrence ->
                val args = buildJsonObject {
                    addArgs(occurrence).forEach { (key, value) -> put(key, value) }
                    if (occurrence.projectId != null && !SamplePlan.isSample(occurrence.projectId)) {
                        // These local-only references become app:add.repeatedFrom after the parent was sent.
                        put("repeatParentLocalId", localId)
                        put("repeatCompletedBy", completedBy)
                        put("repeatCompletedOn", today)
                    }
                }
                enqueue(Mutations.ADD, occurrence.localId, args, clientId = occurrence.localId, now = now)
            }
            true
        }
        if (changed) onOutboxChanged()
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
        val value: JsonElement = rule?.let(FieldJson::wireRepeat) ?: JsonNull
        edit(localId, Mutations.UPDATE, { put("repeat", value) }) { task, _ -> task.copy(repeat = rule) }
    }

    /** The task's own reminders instead of the defaults; null goes back to the defaults, an empty list means none. */
    suspend fun setReminders(localId: String, reminders: List<TaskReminder>?) {
        val clean = reminders?.let { requireNotNull(TaskRules.reminders(it)) { "invalid reminders" } }
        val value: JsonElement = clean?.let(FieldJson::wireReminders) ?: JsonNull
        edit(localId, Mutations.UPDATE, { put("reminders", value) }) { task, _ -> task.copy(reminders = clean) }
    }

    /** Ticks or unticks one checklist item. */
    suspend fun toggleItem(localId: String, itemId: String) = editChecklist(localId) { items ->
        items.map { if (it.id == itemId) it.copy(done = !it.done) else it }
    }

    /** Adds an item at the end; its id is made here, so later changes can name it before the server has it. */
    suspend fun addItem(localId: String, title: String) = editChecklist(localId) { items -> items + ChecklistItem(newId(), title) }

    suspend fun renameItem(localId: String, itemId: String, title: String) = editChecklist(localId) { items ->
        items.map { if (it.id == itemId) it.copy(title = title) else it }
    }

    suspend fun removeItem(localId: String, itemId: String) = editChecklist(localId) { items -> items.filter { it.id != itemId } }

    /** Moves an item [by] places (negative = up), within the list. */
    suspend fun moveItem(localId: String, itemId: String, by: Int) = editChecklist(localId) { items ->
        val from = items.indexOfFirst { it.id == itemId }
        if (from < 0) return@editChecklist items
        val to = (from + by).coerceIn(0, items.lastIndex)
        items.toMutableList().apply { add(to, removeAt(from)) }
    }

    /**
     * Changes the checklist from its current state in Room and queues the whole new list (the backend replaces it as
     * a whole), in one transaction, so quick taps in a row each build on the one before.
     */
    private suspend fun editChecklist(localId: String, change: (List<ChecklistItem>) -> List<ChecklistItem>) {
        val now = clock()
        val changed = db.withTransaction {
            val task = db.tasks().byLocalId(localId) ?: return@withTransaction false
            if (task.inTrash) return@withTransaction false
            val items = requireNotNull(TaskRules.checklist(change(task.checklist))) { "too many or too long checklist items" }
            if (items == task.checklist) return@withTransaction false
            db.tasks().upsert(listOf(task.copy(checklist = items, updatedAt = now)))
            enqueue(Mutations.UPDATE, localId, buildJsonObject { put("checklist", FieldJson.wireChecklist(items)) }, now = now)
            true
        }
        if (changed) onOutboxChanged()
    }

    /** Moves a task to an active project, or clears its project. */
    suspend fun setProject(localId: String, projectId: String?) {
        val now = clock()
        db.withTransaction {
            projectId?.let { require(db.projects().byLocalId(it)?.assignable == true) { "project is not confirmed and active" } }
            val task = db.tasks().byLocalId(localId) ?: return@withTransaction
            if (task.inTrash || task.projectId == projectId) return@withTransaction
            db.tasks().upsert(listOf(task.copy(projectId = projectId, updatedAt = now)))
            enqueue(Mutations.UPDATE, localId, buildJsonObject { put("projectId", projectId.orNull()) }, now = now)
        }
        onOutboxChanged()
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

    /** Ends an agent's claim on a task at once (backend `app:release`): the owner takes it over. */
    suspend fun release(localId: String) = edit(localId, Mutations.RELEASE) { task, _ ->
        task.copy(claimName = null, claimExpiresAt = null)
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
            // A sample task stays on the phone; the server only hears that a task of its own is not "now" any more.
            if (SamplePlan.isSample(localId)) {
                if (others.any { !SamplePlan.isSample(it.localId) }) {
                    enqueue(Mutations.SET_NOW, null, buildJsonObject { put("taskId", JsonNull) }, now = now)
                }
            } else {
                enqueue(Mutations.SET_NOW, localId, JsonObject(emptyMap()), now = now)
            }
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

    /** Sample tasks on the phone, if any ([SamplePlan]). */
    val hasSample: Flow<Boolean> = db.tasks().observeSampleCount(SAMPLE_PATTERN).map { it > 0 }

    /** Puts the sample plan on the phone, without queueing anything for a server. */
    suspend fun loadSample(tasks: List<Task>, projects: List<dev.helm.planner.data.local.Project> = emptyList()) {
        require(tasks.all { SamplePlan.isSample(it.localId) } && projects.all { SamplePlan.isSample(it.localId) }) { "not sample data" }
        db.withTransaction {
            db.projects().upsert(projects)
            db.tasks().upsert(tasks)
        }
    }

    /** Removes every sample task (and anything queued for one, which there should not be). */
    suspend fun removeSample() = db.withTransaction {
        db.outbox().deleteForTasksLike(SAMPLE_PATTERN)
        val sampleProjects = db.projects().all().filter { SamplePlan.isSample(it.localId) }.map { it.localId }.toSet()
        db.tasks().upsert(db.tasks().all().filter { it.projectId in sampleProjects && !SamplePlan.isSample(it.localId) }
            .map { it.copy(projectId = null, serverUpdatedAt = null) })
        db.outbox().all().filter { it.taskLocalId != null }.forEach { op ->
            val args = Json.parseToJsonElement(op.argsJson) as JsonObject
            val projectId = (args["projectId"] as? JsonPrimitive)?.content
            if (projectId in sampleProjects) db.dropAssignment(op, args)
        }
        db.tasks().deleteLike(SAMPLE_PATTERN)
        db.projects().deleteLike(SAMPLE_PATTERN)
    }

    /** The tasks a backup holds: everything on the phone except the sample plan. */
    suspend fun backupSnapshot(): PlanSnapshot = db.withTransaction {
        PlanSnapshot(db.tasks().all().filterNot { SamplePlan.isSample(it.localId) },
            db.projects().all().filterNot { SamplePlan.isSample(it.localId) })
    }

    /** Project-only plans must also be confirmed and cleared before changing owners. */
    suspend fun planSize(): PlanSize = db.withTransaction {
        PlanSize(db.tasks().all().count { !SamplePlan.isSample(it.localId) }, db.outbox().count(),
            db.projects().all().count { !SamplePlan.isSample(it.localId) })
    }

    /**
     * Restores tasks from a backup as new tasks on the phone, each queued for the server like a task added here. A
     * task whose id is already on the phone (as its local, server or client id) is skipped, so restoring the same file
     * twice adds nothing; otherwise the file's id becomes the local id, and a server that already knows it as a
     * `clientId` keeps one copy. A done task is queued without its repeat rule, so the server does not add its next
     * occurrence again; archived tasks are archived.
     */
    suspend fun restore(tasks: List<BackupTask>, projects: List<dev.helm.planner.backup.BackupProject> = emptyList()): RestoreResult {
        // Check all missing names before a single network mutation or local change.
        checkRestoreCapacity(projects)
        if (projects.isNotEmpty()) projectStore.refreshForRestore()
        checkRestoreCapacity(projects)
        val projectIds = projects.associate { imported ->
            val existing = db.projects().all().firstOrNull { dev.helm.planner.domain.ProjectRules.nameKey(it.name) == dev.helm.planner.domain.ProjectRules.nameKey(imported.name) }
            val created = existing ?: projectStore.add(imported.name, imported.color, imported.icon, imported.note)
                .also { if (imported.archived) projectStore.archive(it.localId, true) }
            val project = requireNotNull(db.projects().byLocalId(created.localId))
            imported.id to project.serverId?.takeUnless { project.archived }
        }
        val now = clock()
        val result = db.withTransaction {
            val known = db.tasks().all().flatMap { listOfNotNull(it.localId, it.serverId, it.clientId) }.toMutableSet()
            var added = 0
            for (item in tasks) {
                if (item.id in known) continue
                val id = item.id.takeUnless { SamplePlan.isSample(it) } ?: newId()
                known += id
                val done = item.status == TaskStatus.DONE
                val task = Task(
                    localId = id,
                    clientId = id,
                    title = item.title,
                    projectId = item.projectId?.let { projectIds[it] },
                    note = item.note,
                    dueDate = item.dueDate,
                    dueTime = item.dueTime,
                    status = item.status,
                    resumeNote = item.resumeNote,
                    completedAt = if (done) item.completedAt ?: now else null,
                    archivedAt = item.archivedAt,
                    createdAt = now,
                    updatedAt = now,
                    repeat = item.repeat.takeUnless { done },
                    links = item.links,
                    checklist = item.checklist,
                    reminders = item.reminders,
                )
                db.tasks().upsert(listOf(task))
                enqueue(Mutations.ADD, id, addArgs(task.copy(status = if (done) TaskStatus.TODO else task.status)), clientId = id, now = now)
                if (done) enqueue(Mutations.COMPLETE, id, JsonObject(emptyMap()), now = now)
                if (item.archivedAt != null) enqueue(Mutations.ARCHIVE, id, JsonObject(emptyMap()), now = now)
                added++
            }
            RestoreResult(added, tasks.size - added)
        }
        if (result.added > 0) onOutboxChanged()
        return result
    }

    private suspend fun checkRestoreCapacity(imported: List<dev.helm.planner.backup.BackupProject>) = db.withTransaction {
        val existing = db.projects().all().filterNot { SamplePlan.isSample(it.localId) }
        val names = (existing.map { dev.helm.planner.domain.ProjectRules.nameKey(it.name) } +
            imported.map { dev.helm.planner.domain.ProjectRules.nameKey(it.name) }).toSet()
        if (names.size > dev.helm.planner.domain.ProjectRules.MAX_PROJECTS) throw RestoreCapacityExceeded()
    }

    /**
     * Empties the phone: tasks, history and waiting changes. Used before the phone pairs with another server, so
     * the plan and the unsent changes of the old one cannot reach the new one.
     */
    suspend fun clearAll() = db.withTransaction {
        db.outbox().deleteAll()
        db.events().deleteAll()
        db.tasks().deleteAll()
        db.projects().deleteAll()
    }

    /** Writes a server snapshot into Room (see [SnapshotMerger]). */
    suspend fun applySnapshot(snapshot: RemoteEvent.Snapshot) {
        val missing = MissingTasks.check(db.tasks().all(), snapshot.tasks, taskQueries)
        db.withTransaction {
            val pending = db.outbox().all()
            snapshot.projects?.let { remote ->
                val projects = dev.helm.planner.sync.ProjectSnapshotMerger.merge(db.projects().all(), remote, clock())
                db.projects().upsert(projects.upserts)
                db.projects().delete(projects.deletes)
            }
            val plan = SnapshotMerger.merge(db.tasks().all(), pending, snapshot.tasks + missing.found, clock())
            val deletes = plan.deletes - missing.keep
            if (plan.upserts.isNotEmpty()) db.tasks().upsert(plan.upserts)
            if (deletes.isNotEmpty()) {
                db.tasks().delete(deletes)
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

    /** The arguments of `app:add` for a task with all its fields (a restored task, a repeat made on the phone). */
    private fun addArgs(task: Task): JsonObject = buildJsonObject {
        put("title", task.title)
        task.projectId?.takeUnless { SamplePlan.isSample(it) }?.let { put("projectId", it) }
        task.note?.let { put("note", it) }
        task.dueDate?.let { put("dueDate", it) }
        task.dueTime?.let { put("dueTime", it) }
        if (task.status == TaskStatus.DOING) put("status", TaskStatus.DOING.wire)
        task.resumeNote?.let { put("resumeNote", it) }
        task.repeat?.let { put("repeat", FieldJson.wireRepeat(it)) }
        if (task.links.isNotEmpty()) put("links", JsonArray(task.links.map { Json.encodeToJsonElement(TaskLink.serializer(), it) }))
        if (task.checklist.isNotEmpty()) put("checklist", FieldJson.wireChecklist(task.checklist))
        task.reminders?.let { put("reminders", FieldJson.wireReminders(it)) }
    }

    /**
     * Appends a change; its `clientId` makes the server apply it once however often it is sent. A change of a sample
     * task is not queued: sample tasks never reach a server.
     */
    private suspend fun enqueue(mutation: String, taskLocalId: String?, args: JsonObject, now: Long, clientId: String = newId()) {
        if (taskLocalId != null && SamplePlan.isSample(taskLocalId)) return
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

        /** SQL `LIKE` pattern of the sample tasks' ids. */
        private const val SAMPLE_PATTERN = SamplePlan.ID_PREFIX + "%"
    }
}
