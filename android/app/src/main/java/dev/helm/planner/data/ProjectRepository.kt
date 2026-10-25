package dev.helm.planner.data

import androidx.room.withTransaction
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.RemoteJson
import dev.helm.planner.data.remote.SendResult
import dev.helm.planner.data.remote.TaskRemote
import dev.helm.planner.domain.ProjectRules
import dev.helm.planner.sync.DrainResult
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class ProjectConnectionRequired : Exception("project connection required")
class ProjectCommandRefused : Exception("project command refused")

/** Project management is online-only. Only server-confirmed projects enter the cache; never the outbox. */
class ProjectRepository(
    private val db: HelmDatabase,
    private val newId: () -> String,
    private val remote: suspend () -> TaskRemote?,
    private val applySnapshot: suspend (RemoteEvent.Snapshot) -> Unit,
) {
    val projects = db.projects().observeAll()
    private val commands = Mutex()

    /** Pairing clears the old owner and saves new credentials without an in-flight project reply repopulating it. */
    suspend fun <T> withOwnerChange(block: suspend () -> T): T = commands.withLock { block() }

    suspend fun add(name: String, color: String? = null, icon: String? = null, note: String? = null,
                    fromLabel: String? = null, removeLabel: Boolean = false): Project = command { server ->
        validate(name, color, icon, note)
        val result = send(server, ADD, buildJsonObject {
            put("name", requireNotNull(ProjectRules.name(name)))
            color?.let { put("color", it) }
            icon?.trim()?.takeIf { it.isNotEmpty() }?.let { put("icon", it) }
            note?.takeIf { it.isNotBlank() }?.let { put("note", it) }
            fromLabel?.let { put("fromLabel", it); put("removeLabel", removeLabel) }
        }) as JsonObject
        val project = parse(requireNotNull(result["project"]))
        db.projects().upsert(listOf(project))
        refresh(server)
        project
    }

    suspend fun update(id: String, name: String, color: String?, icon: String?, note: String?) = command { server ->
        validate(name, color, icon, note, id)
        update(server, id, buildJsonObject {
            put("name", requireNotNull(ProjectRules.name(name)))
            put("color", color?.let(::JsonPrimitive) ?: JsonNull)
            put("icon", icon?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
            put("note", note?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
        })
    }

    suspend fun archive(id: String, archived: Boolean, archiveTasks: Boolean = false) = command { server ->
        val project = confirmed(id)
        update(server, id, buildJsonObject { put("archived", archived) })
        if (archived && archiveTasks) {
            // The preceding drain/refresh includes tasks created on this phone and by other devices.
            val tasks = db.tasks().all().filter { it.projectId == project.serverId && it.isActive &&
                it.status != dev.helm.planner.data.local.TaskStatus.DONE }
            tasks.forEach { task -> task.serverId?.let { taskId ->
                send(server, "app:archive", buildJsonObject { put("taskId", taskId) })
            } }
            refresh(server)
        }
    }

    /** Re-space on ties, exhausted floating-point gaps or endpoints; all positions stay in the backend range. */
    suspend fun move(id: String, by: Int) = command { server ->
        val ordered = db.projects().all().filter { it.selectable }
        val from = ordered.indexOfFirst { it.localId == id }
        if (from < 0) return@command
        val to = (from + by).coerceIn(0, ordered.lastIndex)
        if (from == to) return@command
        val desired = ordered.toMutableList().apply { add(to, removeAt(from)) }
        val before = desired.getOrNull(to - 1)?.position
        val after = desired.getOrNull(to + 1)?.position
        val position = when {
            before == null -> (after ?: 0.0) - ProjectRules.POSITION_STEP
            after == null -> before + ProjectRules.POSITION_STEP
            else -> before + (after - before) / 2
        }
        if (position.isFinite() && kotlin.math.abs(position) <= ProjectRules.MAX_POSITION &&
            (before == null || position > before) && (after == null || position < after) &&
            ordered.zipWithNext().all { (a, b) -> a.position < b.position }) {
            update(server, id, buildJsonObject { put("position", position) })
        } else desired.forEachIndexed { index, project ->
            update(server, project.localId, buildJsonObject { put("position", (index + 1) * ProjectRules.POSITION_STEP) })
        }
    }

    /** The backend moves every state, including trash. No optimistic task move can survive a refusal. */
    suspend fun delete(id: String, moveTasksTo: String?) = command { server ->
        require(id != moveTasksTo)
        val project = confirmed(id)
        val target = moveTasksTo?.let { confirmed(it).also { p -> require(p.selectable) } }
        send(server, DELETE, buildJsonObject {
            put("projectId", requireNotNull(project.serverId))
            put("moveTasksTo", target?.serverId ?: "none")
        })
        db.withTransaction {
            db.projects().delete(listOf(id))
            // A stale feed must not hide the server's moves behind an unchanged cached task version.
            db.tasks().upsert(db.tasks().all().map { it.copy(serverUpdatedAt = null) })
        }
        refresh(server)
    }

    /** Obtain the latest server project set before a capacity-sensitive restore, without changing projects. */
    suspend fun refreshForRestore() = command { }

    private suspend fun <T> command(block: suspend (TaskRemote) -> T): T = commands.withLock {
        val server = remote() ?: throw ProjectConnectionRequired()
        val processor = OutboxProcessor(RoomOutboxStore(db), server)
        var drained = processor.drain()
        while (drained == DrainResult.MORE_LEFT) drained = processor.drain()
        if (drained != DrainResult.DONE) throw ProjectConnectionRequired()
        refresh(server)
        block(server)
    }

    private suspend fun update(server: TaskRemote, id: String, fields: JsonObject) {
        val project = confirmed(id)
        val value = send(server, UPDATE, JsonObject(fields + ("projectId" to JsonPrimitive(requireNotNull(project.serverId)))))
        db.projects().upsert(listOf(parse(value)))
    }

    private suspend fun confirmed(id: String): Project = requireNotNull(db.projects().byLocalId(id)).also {
        if (it.serverId == null) throw ProjectConnectionRequired()
    }

    private suspend fun validate(name: String, color: String?, icon: String?, note: String?, except: String? = null) {
        require(ProjectRules.validName(name, db.projects().all(), except))
        require(color == null || color in ProjectRules.colors)
        require(ProjectRules.validIcon(icon.orEmpty()))
        require((note?.length ?: 0) <= ProjectRules.MAX_NOTE)
    }

    private suspend fun send(server: TaskRemote, path: String, args: JsonObject): JsonElement =
        value(server.send(path, JsonObject(args + ("clientId" to JsonPrimitive(newId())))))

    private fun value(result: SendResult): JsonElement = when (result) {
        is SendResult.Applied -> result.value
        is SendResult.Rejected -> throw ProjectCommandRefused()
        is SendResult.Failed, SendResult.Unauthorized -> throw ProjectConnectionRequired()
    }

    private suspend fun refresh(server: TaskRemote) {
        val empty = JsonObject(emptyMap())
        val tasks = value(server.query(RemoteJson.QUERY_TASKS, buildJsonObject {
            RemoteJson.TASKS_ARGS.forEach { (key, value) -> put(key, value) }
        }))
        val trash = value(server.query(RemoteJson.QUERY_TRASH, empty))
        val settings = value(server.query(RemoteJson.QUERY_SETTINGS, empty))
        val projects = value(server.query(RemoteJson.QUERY_PROJECTS, empty))
        applySnapshot(RemoteJson.snapshot(tasks, trash, settings, projects))
    }

    private fun parse(value: JsonElement) = RemoteJson.projects(JsonArray(listOf(value))).single()

    private companion object {
        const val ADD = "app:addProject"
        const val UPDATE = "app:updateProject"
        const val DELETE = "app:deleteProject"
    }
}
