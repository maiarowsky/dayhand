package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.remote.RemoteTask
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/** Groups of task fields that one kind of change touches. */
enum class Field { TITLE, NOTE, DUE, STATUS, NOW, RESUME, ARCHIVED, REPEAT, LABELS, LINKS, DELETED, CHECKLIST, REMINDERS, CLAIM }

data class MergePlan(val upserts: List<Task>, val deletes: List<String>)

/**
 * Merges a server snapshot into the local rows, last write wins per field:
 *
 * - A field changed by a change still in the outbox keeps its local value. That change reaches
 *   the server after everything already there, so the server will end up with it too.
 * - Every other field takes the server value, but only from a server copy newer than the one
 *   merged before (`updatedAt`), so a late snapshot never undoes a newer state.
 * - A task missing from the snapshot was purged (or never reached the server) and goes, unless
 *   it still has changes waiting or is too fresh to be in any snapshot yet. Tasks in the trash
 *   are part of the snapshot, with `deletedAt` set.
 */
object SnapshotMerger {
    /** How long a task the server has not shown yet is kept (a snapshot may predate it). */
    const val UNSEEN_GRACE_MS = 2 * 60 * 1000L

    fun merge(local: List<Task>, pending: List<OutboxOp>, remote: List<RemoteTask>, nowMs: Long): MergePlan {
        val dirty = DirtyFields.of(pending)
        val byServerId = local.filter { it.serverId != null }.associateBy { it.serverId }
        val byClientId = local.filter { it.clientId != null }.associateBy { it.clientId }
        val seen = mutableSetOf<String>()
        val upserts = mutableListOf<Task>()
        for (r in remote) {
            val row = byServerId[r.id] ?: r.clientId?.let { byClientId[it] }
            if (row != null) seen += row.localId
            val known = row?.serverUpdatedAt
            if (row != null && known != null && r.updatedAt <= known) continue
            val merged = mergeRow(row, r, row?.let { dirty.forTask(it.localId) }.orEmpty())
            if (merged != row) upserts += merged
        }
        val deletes = local
            .filter { it.localId !in seen && !dirty.hasChanges(it.localId) }
            .filter { it.serverUpdatedAt != null || nowMs - it.updatedAt > UNSEEN_GRACE_MS }
            .map { it.localId }
        return MergePlan(upserts, deletes)
    }

    private fun mergeRow(row: Task?, r: RemoteTask, keepLocal: Set<Field>): Task {
        var task = Task(
            localId = row?.localId ?: r.clientId ?: r.id,
            serverId = r.id,
            clientId = r.clientId,
            title = r.title,
            note = r.note,
            dueDate = r.dueDate,
            dueTime = r.dueTime,
            status = TaskStatus.fromWire(r.status),
            isNow = r.isNow,
            resumeNote = r.resumeNote,
            completedAt = r.completedAt,
            archivedAt = r.archivedAt,
            createdAt = r.createdAt,
            updatedAt = r.updatedAt,
            serverUpdatedAt = r.updatedAt,
            repeat = r.repeat,
            labels = r.labels,
            links = r.links,
            deletedAt = r.deletedAt,
            checklist = r.checklist,
            reminders = r.reminders,
            acceptance = r.acceptance,
            proof = r.proof,
            claimName = r.claimName,
            claimExpiresAt = r.claimExpiresAt,
            ref = r.ref,
            plan = r.plan,
            dependsOn = r.dependsOn,
            blockedReason = r.blockedReason,
        )
        if (row == null || keepLocal.isEmpty()) return task
        if (Field.TITLE in keepLocal) task = task.copy(title = row.title)
        if (Field.NOTE in keepLocal) task = task.copy(note = row.note)
        if (Field.DUE in keepLocal) task = task.copy(dueDate = row.dueDate, dueTime = row.dueTime)
        if (Field.STATUS in keepLocal) task = task.copy(status = row.status, completedAt = row.completedAt)
        if (Field.NOW in keepLocal) task = task.copy(isNow = row.isNow)
        if (Field.RESUME in keepLocal) task = task.copy(resumeNote = row.resumeNote)
        if (Field.ARCHIVED in keepLocal) task = task.copy(archivedAt = row.archivedAt)
        if (Field.REPEAT in keepLocal) task = task.copy(repeat = row.repeat)
        if (Field.LABELS in keepLocal) task = task.copy(labels = row.labels)
        if (Field.LINKS in keepLocal) task = task.copy(links = row.links)
        if (Field.DELETED in keepLocal) task = task.copy(deletedAt = row.deletedAt)
        if (Field.CHECKLIST in keepLocal) task = task.copy(checklist = row.checklist)
        if (Field.REMINDERS in keepLocal) task = task.copy(reminders = row.reminders)
        if (Field.CLAIM in keepLocal) task = task.copy(claimName = row.claimName, claimExpiresAt = row.claimExpiresAt)
        return task.copy(updatedAt = maxOf(row.updatedAt, r.updatedAt))
    }
}

/** Which fields of which tasks have changes still waiting in the outbox. */
class DirtyFields private constructor(
    private val byTask: Map<String, Set<Field>>,
    /** `setNow` moves the "now" flag off every other task too. */
    private val nowEverywhere: Boolean,
) {
    fun hasChanges(localId: String) = localId in byTask

    fun forTask(localId: String): Set<Field> =
        byTask[localId].orEmpty() + if (nowEverywhere) setOf(Field.NOW) else emptySet()

    companion object {
        fun of(pending: List<OutboxOp>): DirtyFields {
            val byTask = mutableMapOf<String, MutableSet<Field>>()
            var nowEverywhere = false
            for (op in pending) {
                if (op.mutation == Mutations.SET_NOW) nowEverywhere = true
                val localId = op.taskLocalId ?: continue
                byTask.getOrPut(localId) { mutableSetOf() } += fieldsOf(op)
            }
            return DirtyFields(byTask, nowEverywhere)
        }

        private fun fieldsOf(op: OutboxOp): Set<Field> = when (op.mutation) {
            Mutations.ADD -> Field.entries.toSet() - Field.CLAIM
            Mutations.COMPLETE, Mutations.SET_STATUS -> setOf(Field.STATUS, Field.NOW)
            Mutations.RESCHEDULE -> setOf(Field.DUE)
            Mutations.ARCHIVE -> setOf(Field.ARCHIVED, Field.NOW)
            Mutations.SET_NOW -> setOf(Field.STATUS, Field.NOW, Field.RESUME)
            Mutations.SOFT_DELETE -> setOf(Field.DELETED, Field.NOW)
            // `restore` clears the trash, or the archive when the task is not in the trash.
            Mutations.RESTORE -> setOf(Field.DELETED, Field.ARCHIVED)
            Mutations.RELEASE -> setOf(Field.CLAIM)
            Mutations.UPDATE -> updatedFields(op.argsJson)
            else -> Field.entries.toSet() - Field.CLAIM
        }

        private fun updatedFields(argsJson: String): Set<Field> {
            val keys = try {
                Json.parseToJsonElement(argsJson).jsonObject.keys
            } catch (_: SerializationException) {
                return Field.entries.toSet() - Field.CLAIM
            }
            return buildSet {
                if ("title" in keys) add(Field.TITLE)
                if ("note" in keys) add(Field.NOTE)
                if ("dueDate" in keys || "dueTime" in keys) add(Field.DUE)
                if ("resumeNote" in keys) add(Field.RESUME)
                if ("repeat" in keys) add(Field.REPEAT)
                if ("labels" in keys) add(Field.LABELS)
                if ("links" in keys) add(Field.LINKS)
                if ("checklist" in keys) add(Field.CHECKLIST)
                if ("reminders" in keys) add(Field.REMINDERS)
            }
        }
    }
}
