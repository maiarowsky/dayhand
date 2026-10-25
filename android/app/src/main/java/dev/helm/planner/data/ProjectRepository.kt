package dev.helm.planner.data

import androidx.room.withTransaction
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Project
import dev.helm.planner.domain.ProjectRules
import dev.helm.planner.sample.SamplePlan
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Project and task changes are atomic with their ordered outbox records. Nothing waits for a network. */
class ProjectRepository(
    private val db: HelmDatabase,
    private val clock: () -> Long,
    private val newId: () -> String,
    private val onOutboxChanged: () -> Unit,
) {
    val projects = db.projects().observeAll()

    suspend fun add(name: String, color: String? = null, icon: String? = null, note: String? = null,
                    fromLabel: String? = null, removeLabel: Boolean = false): Project {
        val result = db.withTransaction {
            val existing = db.projects().all()
            validate(name, color, icon, note, existing)
            require(existing.count { it.deletedAt == null } < ProjectRules.MAX_PROJECTS) { "project limit" }
            val now = clock()
            val id = newId()
            val project = Project(id, clientId = id, name = requireNotNull(ProjectRules.name(name)), color = color,
                icon = icon?.trim()?.ifEmpty { null }, note = note?.takeIf { it.isNotBlank() },
                position = (existing.maxOfOrNull { it.position } ?: 0.0).coerceAtLeast(0.0) + ProjectRules.POSITION_STEP,
                createdAt = now, updatedAt = now)
            db.projects().upsert(listOf(project))
            queue(Mutations.ADD_PROJECT, project, buildJsonObject {
                put("name", project.name)
                project.color?.let { put("color", it) }
                project.icon?.let { put("icon", it) }
                project.note?.let { put("note", it) }
                put("position", project.position)
                fromLabel?.let { put("fromLabel", it); put("removeLabel", removeLabel) }
            }, clientId = id)
            // Earlier task creations precede this operation. The backend conversion includes trash and archived tasks.
            if (fromLabel != null) {
                val tasks = db.tasks().all().filter { fromLabel in it.labels && it.projectLocalId == null &&
                    (it.claimExpiresAt == null || it.claimExpiresAt <= now) }
                require(tasks.size <= MAX_MOVED_TASKS) { "too many tasks" }
                db.tasks().upsert(tasks.map { it.copy(projectLocalId = id,
                    labels = if (removeLabel) it.labels - fromLabel else it.labels, updatedAt = now) })
            }
            project
        }
        onOutboxChanged()
        return result
    }

    suspend fun update(localId: String, name: String, color: String?, icon: String?, note: String?) {
        db.withTransaction {
            val project = requireNotNull(db.projects().byLocalId(localId))
            validate(name, color, icon, note, db.projects().all(), localId)
            val updated = project.copy(name = requireNotNull(ProjectRules.name(name)), color = color,
                icon = icon?.trim()?.ifEmpty { null }, note = note?.takeIf { it.isNotBlank() }, updatedAt = clock())
            db.projects().upsert(listOf(updated))
            queue(Mutations.UPDATE_PROJECT, updated, buildJsonObject {
                put("name", updated.name)
                put("color", updated.color?.let(::JsonPrimitive) ?: JsonNull)
                put("icon", updated.icon?.let(::JsonPrimitive) ?: JsonNull)
                put("note", updated.note?.let(::JsonPrimitive) ?: JsonNull)
            })
        }
        onOutboxChanged()
    }

    suspend fun archive(localId: String, archived: Boolean, archiveTasks: Boolean = false) {
        db.withTransaction {
            val project = requireNotNull(db.projects().byLocalId(localId))
            val now = clock()
            val updated = project.copy(archivedAt = now.takeIf { archived }, updatedAt = now)
            db.projects().upsert(listOf(updated))
            queue(Mutations.UPDATE_PROJECT, updated, buildJsonObject { put("archived", archived) })
            if (archived && archiveTasks) {
                val tasks = db.tasks().all().filter { it.projectLocalId == localId && it.isActive && it.status != dev.helm.planner.data.local.TaskStatus.DONE }
                db.tasks().upsert(tasks.map { it.copy(archivedAt = now, isNow = false, updatedAt = now) })
                tasks.filterNot { SamplePlan.isSample(it.localId) }.forEach { task ->
                    val clientId = newId()
                    db.outbox().insert(OutboxOp(opId = clientId, mutation = Mutations.ARCHIVE, taskLocalId = task.localId,
                        clientId = clientId, createdAt = now, argsJson = buildJsonObject { put("clientId", clientId) }.toString()))
                }
            }
        }
        onOutboxChanged()
    }

    /** Accessible up/down controls and drag handles use the same midpoint position. */
    suspend fun move(localId: String, by: Int) {
        db.withTransaction {
            val projects = db.projects().all().filter { it.selectable }
            val index = projects.indexOfFirst { it.localId == localId }
            if (index < 0) return@withTransaction
            val to = (index + by).coerceIn(0, projects.lastIndex)
            if (to == index) return@withTransaction
            val others = projects.filterNot { it.localId == localId }
            val before = others.getOrNull(to - 1)?.position
            val after = others.getOrNull(to)?.position
            val position = when {
                before == null -> (after ?: 0.0) - ProjectRules.POSITION_STEP
                after == null -> before + ProjectRules.POSITION_STEP
                else -> before + (after - before) / 2
            }
            val project = projects[index].copy(position = position, updatedAt = clock())
            db.projects().upsert(listOf(project))
            queue(Mutations.UPDATE_PROJECT, project, buildJsonObject { put("position", position) })
        }
        onOutboxChanged()
    }

    /** Always supplies a destination, including for tasks in the trash or only known to the server. */
    suspend fun delete(localId: String, moveTasksTo: String?) {
        db.withTransaction {
            require(localId != moveTasksTo)
            val target = moveTasksTo?.let { requireNotNull(db.projects().byLocalId(it)).also { p -> require(p.selectable) } }
            val project = requireNotNull(db.projects().byLocalId(localId))
            val now = clock()
            val tasks = db.tasks().all().filter { it.projectLocalId == localId }
            require(tasks.size <= MAX_MOVED_TASKS)
            db.tasks().upsert(tasks.map { it.copy(projectLocalId = moveTasksTo, updatedAt = now) })
            db.projects().upsert(listOf(project.copy(deletedAt = now, updatedAt = now)))
            queue(Mutations.DELETE_PROJECT, project, buildJsonObject {
                if (target == null) put("moveTasksTo", "none") else put("moveTasksToLocalId", target.localId)
            })
        }
        onOutboxChanged()
    }

    private fun validate(name: String, color: String?, icon: String?, note: String?, projects: List<Project>, except: String? = null) {
        require(ProjectRules.validName(name, projects, except)) { "invalid project name" }
        require(color == null || color in ProjectRules.colors) { "invalid project color" }
        require(ProjectRules.validIcon(icon.orEmpty())) { "invalid project icon" }
        require((note?.length ?: 0) <= ProjectRules.MAX_NOTE) { "invalid project note" }
    }

    private suspend fun queue(mutation: String, project: Project, args: JsonObject, clientId: String = newId()) {
        if (SamplePlan.isSample(project.localId)) return
        db.outbox().insert(OutboxOp(opId = newId(), mutation = mutation, taskLocalId = null, projectLocalId = project.localId,
            clientId = clientId, createdAt = clock(), argsJson = JsonObject(args + ("clientId" to JsonPrimitive(clientId))).toString()))
    }

    private companion object { const val MAX_MOVED_TASKS = 1000 }
}
