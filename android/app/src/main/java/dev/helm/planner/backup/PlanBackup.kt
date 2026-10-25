package dev.helm.planner.backup

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.FieldJson
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.domain.ProjectRules
import dev.helm.planner.data.local.Project
import java.security.MessageDigest
import java.time.DateTimeException
import java.time.LocalDate
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/** The settings a backup carries, as the server's export names them. */
data class BackupSettings(val timezone: String, val summaryTime: String, val defaultReminderMinutes: List<Int>)

/**
 * One task read from a backup and checked by the backend's rules. [id] is its id in the file; a task without one
 * gets an id made from its content, so restoring the same file twice still adds it once.
 */
data class BackupTask(
    val id: String,
    val title: String,
    val note: String? = null,
    val dueDate: String? = null,
    val dueTime: String? = null,
    val status: TaskStatus = TaskStatus.TODO,
    val resumeNote: String? = null,
    val repeat: RepeatRule? = null,
    val labels: List<String> = emptyList(),
    val links: List<TaskLink> = emptyList(),
    val checklist: List<ChecklistItem> = emptyList(),
    val reminders: List<TaskReminder>? = null,
    val completedAt: Long? = null,
    val archivedAt: Long? = null,
    val projectId: String? = null,
)

data class BackupProject(val id: String, val name: String, val color: String?, val icon: String?, val note: String?, val archived: Boolean)

/** Why a file is not a backup Dayhand can read. */
enum class BackupProblem { NOT_JSON, NOT_HELM, TOO_MANY }

sealed interface BackupRead {
    /** [tasks] to restore; [trashed] tasks in the trash and [invalid] ones (their titles) are left out. */
    data class Plan(
        val tasks: List<BackupTask>,
        val settings: BackupSettings?,
        val trashed: Int,
        val invalid: List<String>,
        val projects: List<BackupProject> = emptyList(),
    ) : BackupRead

    data class Unreadable(val problem: BackupProblem) : BackupRead
}

/**
 * A backup of the plan on this phone in Dayhand's JSON export format (version 1, as `app:exportPlan` and
 * `dayhand export --format json` write it), so the server's import (`POST /api/v1/import`, `dayhand import`) reads it too.
 * Backup contents and restore limits: `android/README.md#backups`.
 */
object PlanBackup {
    const val VERSION = 1

    /** The server imports at most this many tasks at once (docs/api.md#import); a restore keeps the same limit. */
    const val MAX_TASKS = 2000

    private val pretty = Json { prettyPrint = true }

    /** `dayhand-backup-2026-10-23.json`: the name offered in the save dialog and the share sheet. */
    fun fileName(today: String) = "dayhand-backup-$today.json"

    /** The backup file of [tasks] (trash included, as in the server's export) with [settings], made at [at]. */
    fun write(tasks: List<Task>, settings: BackupSettings, at: Long, projects: List<Project> = emptyList()): String {
        val projectIds = projects.associate { it.localId to (it.serverId ?: it.localId) }
        val content = buildJsonObject {
            put("version", VERSION)
            put("exportedAt", at)
            put("settings", buildJsonObject {
                put("timezone", settings.timezone)
                put("summaryTime", settings.summaryTime)
                put("defaultReminderMinutes", JsonArray(settings.defaultReminderMinutes.map { JsonPrimitive(it) }))
            })
            put("projects", JsonArray(projects.sortedBy { it.position }.map { project -> buildJsonObject {
                put("id", project.serverId ?: project.localId)
                put("name", project.name)
                project.color?.let { put("color", it) }
                project.icon?.let { put("icon", it) }
                project.note?.let { put("note", it) }
                put("position", project.position)
                put("archived", project.archived)
                project.archivedAt?.let { put("archivedAt", it) }
                put("createdAt", project.createdAt)
                put("updatedAt", project.updatedAt)
            } }))
            put("tasks", JsonArray(tasks.sortedBy { it.createdAt }.map { taskJson(it, projectIds) }))
            put("events", buildJsonArray {})
        }
        return pretty.encodeToString(JsonElement.serializer(), content) + "\n"
    }

    /** A task as the server's export writes it (`toTask`): the server id where there is one, else the phone's. */
    private fun taskJson(task: Task, projects: Map<String, String>): JsonObject = buildJsonObject {
        projects[task.projectId]?.let { put("projectId", it) }
        put("id", task.serverId ?: task.localId)
        put("title", task.title)
        put("status", task.status.wire)
        put("isNow", task.isNow)
        task.note?.let { put("note", it) }
        task.dueDate?.let { put("dueDate", it) }
        task.dueTime?.let { put("dueTime", it) }
        task.resumeNote?.let { put("resumeNote", it) }
        task.repeat?.let { put("repeat", FieldJson.wireRepeat(it)) }
        put("labels", JsonArray(task.labels.map(::JsonPrimitive)))
        put("links", JsonArray(task.links.map { link -> buildJsonObject { put("url", link.url); link.title?.let { put("title", it) } } }))
        if (task.checklist.isNotEmpty()) put("checklist", FieldJson.wireChecklist(task.checklist))
        task.reminders?.let { put("reminders", FieldJson.wireReminders(it)) }
        task.completedAt?.let { put("completedAt", it) }
        task.archivedAt?.let { put("archivedAt", it) }
        task.deletedAt?.let { put("deletedAt", it) }
        put("createdAt", task.createdAt)
        put("updatedAt", task.updatedAt)
        task.clientId?.let { put("clientId", it) }
    }

    /**
     * Reads a backup or a server export (also wrapped as `{format: "json", content}`). Every task is checked by the
     * rules the phone applies before a change is queued; one that fails is reported by title and left out, as the
     * server's import does. Checklist items without an id get one from [newId].
     */
    fun read(text: String, newId: () -> String): BackupRead {
        val root = try {
            Json.parseToJsonElement(text.removePrefix("\uFEFF")) as? JsonObject
        } catch (_: SerializationException) {
            null
        } ?: return BackupRead.Unreadable(BackupProblem.NOT_JSON)
        val plan = root.takeIf { it.string("format") == "json" }?.get("content") as? JsonObject ?: root
        val tasks = plan["tasks"] as? JsonArray
        if (RepeatRule.wholeNumber(plan["version"]) != VERSION || tasks == null) return BackupRead.Unreadable(BackupProblem.NOT_HELM)
        if (tasks.size > MAX_TASKS) return BackupRead.Unreadable(BackupProblem.TOO_MANY)
        var trashed = 0
        val invalid = mutableListOf<String>()
        val projectValues = plan["projects"] as? JsonArray ?: JsonArray(emptyList())
        if (projectValues.size > ProjectRules.MAX_PROJECTS) return BackupRead.Unreadable(BackupProblem.TOO_MANY)
        val projects = projectValues.mapNotNull { element ->
            val o = element as? JsonObject
            val name = o?.string("name")?.let(ProjectRules::name)
            val id = o?.string("id")
            if (o == null || id == null || name == null || !ProjectRules.validIcon(o.string("icon").orEmpty()) ||
                (o.string("note")?.length ?: 0) > ProjectRules.MAX_NOTE || o.string("color")?.let { it !in ProjectRules.colors } == true) {
                invalid += o?.string("name") ?: "Project"
                null
            } else BackupProject(id, name, o.string("color"), o.string("icon"), o.string("note"),
                (o["archived"] as? JsonPrimitive)?.booleanOrNull == true || o.long("archivedAt") != null)
        }
        val projectIds = projects.map { it.id }.toSet()
        val read = mutableListOf<BackupTask>()
        tasks.forEachIndexed { index, element ->
            val o = element as? JsonObject
            val task = o?.let { task(it, newId) }
            when {
                o == null -> invalid += "#${index + 1}"
                o["deletedAt"].let { it != null && it !is JsonNull } -> trashed++
                task != null && (task.projectId == null || task.projectId in projectIds) -> read += task
                else -> invalid += o.string("title")?.takeIf { it.isNotBlank() } ?: "#${index + 1}"
            }
        }
        return BackupRead.Plan(read, (plan["settings"] as? JsonObject)?.let(::settings), trashed, invalid, projects)
    }

    private fun task(o: JsonObject, newId: () -> String): BackupTask? {
        val title = TaskRules.title(o.string("title").orEmpty()) ?: return null
        val note = o.string("note")?.takeIf { it.isNotBlank() }
        val resumeNote = o.string("resumeNote")?.trim()?.takeIf { it.isNotEmpty() }
        if ((note?.length ?: 0) > TaskRules.MAX_NOTE || (resumeNote?.length ?: 0) > TaskRules.MAX_RESUME_NOTE) return null
        val dueDate = o.string("dueDate")
        val dueTime = o.string("dueTime")
        if (dueDate != null && !isDate(dueDate)) return null
        if (dueTime != null && (dueDate == null || !TaskRules.isValid(TaskReminder(time = dueTime)))) return null
        val repeat = o["repeat"]?.takeUnless { it is JsonNull }?.let { RepeatRule.parse(it)?.takeIf(TaskRules::isValid) ?: return null }
        val labels = TaskRules.labels(o.strings("labels") ?: return null) ?: return null
        val links = (o["links"] as? JsonArray ?: JsonArray(emptyList())).map { link(it) ?: return null }
        if (links.size > TaskRules.MAX_LINKS) return null
        val checklist = (o["checklist"] as? JsonArray).orEmpty().map { item(it, newId) ?: return null }
        val reminders = when (val r = o["reminders"]) {
            null, is JsonNull -> null
            is JsonArray -> TaskRules.reminders(r.map { TaskReminder.parse(it) ?: return null }) ?: return null
            else -> return null
        }
        return BackupTask(
            id = o.string("id") ?: contentId(o),
            title = title,
            note = note,
            dueDate = dueDate,
            dueTime = dueTime,
            status = TaskStatus.fromWire(o.string("status")),
            resumeNote = resumeNote,
            repeat = repeat,
            labels = labels,
            links = links,
            checklist = TaskRules.checklist(checklist) ?: return null,
            reminders = reminders,
            completedAt = o.long("completedAt"),
            archivedAt = o.long("archivedAt"),
            projectId = o.string("projectId"),
        )
    }

    private fun link(element: JsonElement): TaskLink? {
        val o = element as? JsonObject ?: return null
        return TaskRules.link(o.string("url") ?: return null, o.string("title"))
    }

    private fun item(element: JsonElement, newId: () -> String): ChecklistItem? {
        val o = element as? JsonObject ?: return null
        val done = (o["done"] as? JsonPrimitive)?.booleanOrNull ?: false
        return ChecklistItem(o.string("id") ?: newId(), o.string("title") ?: return null, done)
    }

    /** The settings of a backup; a value that is missing or not valid makes the whole object unusable. */
    private fun settings(o: JsonObject): BackupSettings? {
        val summaryTime = o.string("summaryTime")?.takeIf { TaskRules.isValid(TaskReminder(time = it)) } ?: return null
        val minutes = (o["defaultReminderMinutes"] as? JsonArray)?.map { RepeatRule.wholeNumber(it) ?: return null } ?: return null
        if (minutes.any { it !in 0..TaskRules.MAX_REMINDER_MINUTES }) return null
        return BackupSettings(o.string("timezone") ?: return null, summaryTime, minutes.distinct().sorted())
    }

    /** `import-` and the start of the SHA-256 of the task's JSON: the same task in the same file, the same id. */
    private fun contentId(o: JsonObject): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(o.toString().toByteArray())
        return "import-" + digest.take(ID_BYTES).joinToString("") { "%02x".format(it) }
    }

    private const val ID_BYTES = 12

    private fun isDate(value: String) = try {
        LocalDate.parse(value).toString() == value
    } catch (_: DateTimeException) {
        false
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.strings(key: String): List<String>? = when (val value = this[key]) {
        null, is JsonNull -> emptyList()
        is JsonArray -> value.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: return null }
        else -> null
    }

    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toLong()
}
