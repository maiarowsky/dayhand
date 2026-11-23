package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskSearchTest {
    private var created = 0L
    private fun task(id: String, title: String, block: Task.() -> Task = { this }) =
        Task(localId = id, title = title, createdAt = ++created, updatedAt = 0).block()

    private fun ids(tasks: List<Task>, query: String) = TaskSearch.find(tasks, query).map { it.localId }

    @Test
    fun `title, note and resume note match without case or accents`() {
        val tasks = listOf(
            task("t", "Zadzwonić do Łucji"),
            task("n", "Faktury") { copy(note = "Wysłać do KSIĘGOWEJ") },
            task("r", "Raport") { copy(resumeNote = "skończyłem na żółwiu") },
            task("x", "Inne"),
        )
        assertEquals(listOf("t"), ids(tasks, "lucji"))
        assertEquals(listOf("t"), ids(tasks, "  ZADZWONIC "))
        assertEquals(listOf("n"), ids(tasks, "ksiegowej"))
        assertEquals(listOf("r"), ids(tasks, "zolw"))
        assertEquals(emptyList<String>(), ids(tasks, "   "))
        assertEquals(emptyList<String>(), ids(tasks, "nic takiego"))
    }

    @Test
    fun `archived and trashed tasks stay out`() {
        val tasks = listOf(
            task("a", "Plan") { copy(archivedAt = 1) },
            task("d", "Plan") { copy(deletedAt = 1) },
            task("o", "Plan"),
        )
        assertEquals(listOf("o"), ids(tasks, "plan"))
    }

    @Test
    fun `open tasks by schedule, then without a day, then done ones most recent first`() {
        val tasks = listOf(
            task("done-old", "Plan") { copy(status = TaskStatus.DONE, completedAt = 10) },
            task("no-day", "Plan"),
            task("later", "Plan") { copy(dueDate = "2026-10-25") },
            task("done-new", "Plan") { copy(status = TaskStatus.DONE, completedAt = 20) },
            task("soon-timed", "Plan") { copy(dueDate = "2026-10-22", dueTime = "09:00") },
            task("soon", "Plan") { copy(dueDate = "2026-10-22") },
        )
        assertEquals(listOf("soon-timed", "soon", "later", "no-day", "done-new", "done-old"), ids(tasks, "plan"))
    }
}
