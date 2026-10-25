package dev.helm.planner.domain

import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ProjectsTest {
    private fun project(id: String, name: String = id, archived: Boolean = false) = Project(id, name = name, position = 0.0,
        archivedAt = if (archived) 1 else null, createdAt = 0, updatedAt = 0)
    private fun task(id: String, due: String? = null) = Task(id, title = id, dueDate = due, createdAt = 0, updatedAt = 0)

    @Test fun namesFollowTheMergedBackendAndIncludeArchivedProjects() {
        assertNull(ProjectRules.name("none"))
        assertNull(ProjectRules.name("a".repeat(51)))
        assertNull(ProjectRules.name("two\nlines"))
        assertEquals("Dom", ProjectRules.name(" Dom "))
        assertFalse(ProjectRules.validName(" café ", listOf(project("1", "Café", true))))
        assertTrue(ProjectRules.validName("CAFÉ", listOf(project("1", "Café", true)), "1"))
        listOf("🥐", "🇵🇱", "👩🏽‍💻", "❤️", "1️⃣").forEach { assertTrue(it, ProjectRules.validIcon(it)) }
        listOf("hello", "abc🥐", "🥐🥐", "🥐 🥐", "🇵", "\u200D").forEach { assertFalse(it, ProjectRules.validIcon(it)) }
    }

    @Test fun countsAndSectionsIgnoreTrashAndArchiveAndLimitDoneToFifty() {
        val tasks = listOf(task("late", "2026-10-22"), task("today", "2026-10-23"), task("later", "2026-10-24"), task("undated"),
            task("trash", "2026-10-20").copy(deletedAt = 1), task("archive", "2026-10-20").copy(archivedAt = 1)) +
            (1..55).map { task("done-$it").copy(status = TaskStatus.DONE, completedAt = it.toLong()) }
        assertEquals(ProjectCounts(4, 1), projectCounts(tasks, "2026-10-23"))
        val sections = projectSections(tasks, "2026-10-23")
        assertEquals(listOf("late"), sections.overdue.map { it.localId })
        assertEquals(listOf("today"), sections.today.map { it.localId })
        assertEquals(listOf("later"), sections.later.map { it.localId })
        assertEquals(listOf("undated"), sections.undated.map { it.localId })
        assertEquals(50, sections.done.size)
        assertEquals("done-55", sections.done.first().localId)
    }

    @Test fun sharedProjectQuickAddCases() {
        val cases = listOf(File("../../linux/tests/cases/quickadd-project.json"), File("../linux/tests/cases/quickadd-project.json"))
            .first { it.exists() }
        val root = Json.parseToJsonElement(cases.readText()).jsonObject
        val now = Instant.parse(root.getValue("now").jsonPrimitive.content).toEpochMilli()
        val timezone = root.getValue("timezone").jsonPrimitive.content
        val projects = root.getValue("projects").jsonArray.map { entry ->
            val p = entry.jsonObject
            project(p.getValue("id").jsonPrimitive.content, p.getValue("name").jsonPrimitive.content, p.getValue("archived").jsonPrimitive.boolean)
        }
        root.getValue("cases").jsonArray.forEach { entry ->
            val c = entry.jsonObject
            val line = c.getValue("line").jsonPrimitive.content
            val parsed = QuickAdd.parse(line, now, timezone, projects)
            assertEquals(line, c.getValue("title").jsonPrimitive.content, parsed.title)
            assertEquals(line, c["projectId"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content, parsed.projectLocalId)
            assertEquals(line, c["dueDate"]?.jsonPrimitive?.content, parsed.`when`?.date)
            assertEquals(line, c["dueTime"]?.jsonPrimitive?.content, parsed.`when`?.time)
        }
    }
}
