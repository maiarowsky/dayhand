package dev.helm.planner.backup

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanBackupTest {
    private val settings = BackupSettings("Europe/Warsaw", "06:30", listOf(0, 15))
    private var ids = 0
    private val newId = { "item${++ids}" }

    private val full = Task(
        localId = "local-1",
        serverId = null,
        clientId = "local-1",
        title = "Write the proposal",
        note = "Two pages",
        dueDate = "2026-10-24",
        dueTime = "09:30",
        status = TaskStatus.DOING,
        isNow = true,
        resumeNote = "Next: the budget",
        createdAt = 100,
        updatedAt = 200,
        repeat = RepeatRule(RepeatEvery.WEEK, weekdays = listOf(1, 3)),
        labels = listOf("Work"),
        links = listOf(TaskLink("https://example.com/doc", "Draft")),
        checklist = listOf(ChecklistItem("c1", "Goal", done = true), ChecklistItem("c2", "Cost")),
        reminders = listOf(TaskReminder.before(15), TaskReminder.at("18:00", daysBefore = 1)),
    )

    private fun parse(text: String) = Json.parseToJsonElement(text).jsonObject

    @Test
    fun aBackupHasTheServerExportsShape() {
        val text = PlanBackup.write(listOf(full), settings, at = 1_000)
        val root = parse(text)
        // docs/schemas/export.schema.json: version, exportedAt, settings, tasks, events.
        assertEquals(1, root.getValue("version").jsonPrimitive.int)
        assertEquals(1_000L, root.getValue("exportedAt").jsonPrimitive.long)
        assertEquals(setOf("timezone", "summaryTime", "defaultReminderMinutes"), root.getValue("settings").jsonObject.keys)
        assertEquals(JsonArray(emptyList()), root.getValue("events"))
        val task = root.getValue("tasks").jsonArray.single().jsonObject
        // task.schema.json requires these.
        for (key in listOf("id", "title", "status", "isNow", "labels", "links", "createdAt", "updatedAt")) assertTrue(key, key in task)
        assertEquals("local-1", task.getValue("id").jsonPrimitive.content)
        assertEquals("doing", task.getValue("status").jsonPrimitive.content)
        assertEquals(1, task.getValue("repeat").jsonObject.getValue("interval").jsonPrimitive.int)
        assertFalse("no task numbers on the phone", "ref" in task)
        assertTrue(text.endsWith("}\n"))
    }

    @Test
    fun aTaskTheServerKnowsKeepsItsServerId() {
        val task = parse(PlanBackup.write(listOf(full.copy(serverId = "jd7abc")), settings, 0))
            .getValue("tasks").jsonArray.single().jsonObject
        assertEquals("jd7abc", task.getValue("id").jsonPrimitive.content)
        assertEquals("local-1", task.getValue("clientId").jsonPrimitive.content)
    }

    @Test
    fun unsetFieldsAreLeftOutAndTheTrashIsKept() {
        val plain = Task(localId = "p", title = "Plain", createdAt = 1, updatedAt = 1, deletedAt = 5)
        val task = parse(PlanBackup.write(listOf(plain), settings, 0)).getValue("tasks").jsonArray.single().jsonObject
        for (key in listOf("note", "dueDate", "dueTime", "repeat", "checklist", "reminders", "completedAt")) assertFalse(key, key in task)
        assertEquals(5L, task.getValue("deletedAt").jsonPrimitive.long)
    }

    @Test
    fun aBackupReadsBackAsTheSameTasks() {
        val done = full.copy(localId = "local-2", clientId = "local-2", status = TaskStatus.DONE, isNow = false, completedAt = 300, archivedAt = 400)
        val read = PlanBackup.read(PlanBackup.write(listOf(full, done), settings, 0), newId) as BackupRead.Plan
        assertEquals(settings, read.settings)
        assertEquals(0, read.trashed)
        assertEquals(emptyList<String>(), read.invalid)
        val (first, second) = read.tasks
        assertEquals(
            BackupTask(
                id = "local-1",
                title = full.title,
                note = full.note,
                dueDate = full.dueDate,
                dueTime = full.dueTime,
                status = TaskStatus.DOING,
                resumeNote = full.resumeNote,
                repeat = full.repeat,
                labels = full.labels,
                links = full.links,
                checklist = full.checklist,
                reminders = full.reminders,
            ),
            first,
        )
        assertEquals(TaskStatus.DONE, second.status)
        assertEquals(300L, second.completedAt)
        assertEquals(400L, second.archivedAt)
    }

    @Test
    fun theServersExportReadsTooWrappedOrNot() {
        // What app:exportPlan returns (numbers as doubles, as Convex sends them) and what dayhand export writes.
        val content = """
            {"version":1.0,"exportedAt":1.7E12,"settings":{"timezone":"Europe/London","summaryTime":"05:00","defaultReminderMinutes":[0.0]},
             "tasks":[{"id":"jd7x","ref":4.0,"title":"From the server","status":"todo","isNow":false,"labels":[],"links":[],
                       "repeat":{"every":"month","interval":1.0,"monthDay":-1.0},"rrule":"FREQ=MONTHLY;BYMONTHDAY=-1",
                       "createdAt":1.0,"updatedAt":2.0}],
             "events":[{"action":"create"}]}
        """.trimIndent()
        for (text in listOf(content, """{"format":"json","content":$content}""")) {
            val read = PlanBackup.read(text, newId) as BackupRead.Plan
            val task = read.tasks.single()
            assertEquals("jd7x", task.id)
            assertEquals(RepeatRule(RepeatEvery.MONTH, monthDay = -1), task.repeat)
            assertNull(task.reminders)
            assertEquals(listOf(0), read.settings?.defaultReminderMinutes)
        }
    }

    @Test
    fun theTrashAndInvalidTasksAreLeftOutAndReported() {
        val text = """
            {"version":1,"tasks":[
              {"id":"a","title":"Kept","labels":[],"links":[]},
              {"id":"b","title":"In the trash","deletedAt":5},
              {"id":"c","title":"","labels":[]},
              {"id":"d","title":"Bad link","links":[{"url":"ftp://x"}]},
              {"id":"e","title":"Time without a day","dueTime":"10:00"},
              {"id":"f","title":"Bad repeat","repeat":{"every":"week","interval":0}},
              {"id":"g","title":"Bad reminder","reminders":[{"minutesBefore":-5}]},
              {"id":"h","title":"Checklist without ids","checklist":[{"title":"One"},{"title":"Two","done":true}]},
              "not a task"
            ]}
        """.trimIndent()
        val read = PlanBackup.read(text, newId) as BackupRead.Plan
        assertEquals(listOf("Kept", "Checklist without ids"), read.tasks.map { it.title })
        assertEquals(listOf(ChecklistItem("item1", "One"), ChecklistItem("item2", "Two", done = true)), read.tasks[1].checklist)
        assertEquals(1, read.trashed)
        assertEquals(listOf("#3", "Bad link", "Time without a day", "Bad repeat", "Bad reminder", "#9"), read.invalid)
        assertNull("no settings in the file", read.settings)
    }

    @Test
    fun otherFilesAreRefused() {
        assertEquals(BackupRead.Unreadable(BackupProblem.NOT_JSON), PlanBackup.read("BEGIN:VCALENDAR", newId))
        assertEquals(BackupRead.Unreadable(BackupProblem.NOT_JSON), PlanBackup.read("[1, 2]", newId))
        assertEquals(BackupRead.Unreadable(BackupProblem.NOT_HELM), PlanBackup.read("""{"version":2,"tasks":[]}""", newId))
        assertEquals(BackupRead.Unreadable(BackupProblem.NOT_HELM), PlanBackup.read("""{"tasks":[]}""", newId))
        val many = (1..PlanBackup.MAX_TASKS + 1).joinToString(",") { """{"title":"t$it"}""" }
        assertEquals(BackupRead.Unreadable(BackupProblem.TOO_MANY), PlanBackup.read("""{"version":1,"tasks":[$many]}""", newId))
    }

    @Test
    fun aTaskWithoutAnIdGetsOneFromItsContent() {
        val text = """{"version":1,"tasks":[{"title":"No id"},{"title":"Another"}]}"""
        val first = (PlanBackup.read(text, newId) as BackupRead.Plan).tasks
        val again = (PlanBackup.read(text, newId) as BackupRead.Plan).tasks
        assertTrue(first.all { it.id.startsWith("import-") })
        assertEquals(first.map { it.id }, again.map { it.id })
        assertEquals(2, first.map { it.id }.distinct().size)
    }

    @Test
    fun aByteOrderMarkIsIgnored() {
        val read = PlanBackup.read("﻿" + """{"version":1,"tasks":[{"title":"BOM"}]}""", newId) as BackupRead.Plan
        assertEquals("BOM", read.tasks.single().title)
    }

    @Test
    fun invalidSettingsAreIgnoredAsAWhole() {
        val read = PlanBackup.read(
            """{"version":1,"tasks":[],"settings":{"timezone":"Europe/Warsaw","summaryTime":"25:00","defaultReminderMinutes":[0]}}""",
            newId,
        ) as BackupRead.Plan
        assertNull(read.settings)
    }

    @Test
    fun projectsAndTaskReferencesSurviveTheBackupFile() {
        val project = dev.helm.planner.data.local.Project("local-project", serverId = "server-project", name = "Home", color = "amber", icon = "🏠",
            note = "Context", position = 1024.0, archivedAt = 10, createdAt = 1, updatedAt = 2)
        val file = PlanBackup.write(listOf(full.copy(projectId = project.localId)), settings, 100, listOf(project))
        val read = PlanBackup.read(file, newId) as BackupRead.Plan
        assertEquals("server-project", read.tasks.single().projectId)
        assertEquals(BackupProject("server-project", "Home", "amber", "🏠", "Context", true), read.projects.single())
        assertTrue(read.invalid.isEmpty())
    }

    @Test
    fun theFileIsNamedAfterToday() {
        assertEquals("dayhand-backup-2026-10-23.json", PlanBackup.fileName("2026-10-23"))
        assertTrue(parse(PlanBackup.write(emptyList(), settings, 0)).getValue("tasks") is JsonArray)
        assertTrue(parse(PlanBackup.write(emptyList(), settings, 0)).getValue("settings") is JsonObject)
    }
}
