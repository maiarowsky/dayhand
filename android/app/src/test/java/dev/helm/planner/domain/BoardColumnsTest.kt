package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BoardColumnsTest {
    private val now = ZonedDateTime.parse("2026-10-22T10:00:00+01:00[Europe/London]").toInstant().toEpochMilli()

    private fun task(id: String, status: TaskStatus = TaskStatus.TODO, block: Task.() -> Task = { this }) =
        Task(localId = id, title = id, status = status, createdAt = id.hashCode().toLong(), updatedAt = 0).block()

    @Test
    fun `tasks go to their status column, archived and trashed ones nowhere`() {
        val columns = boardColumns(
            listOf(
                task("a"),
                task("b", TaskStatus.DOING),
                task("c", TaskStatus.DONE) { copy(completedAt = 5) },
                task("archived") { copy(archivedAt = 1) },
                task("trashed", TaskStatus.DOING) { copy(deletedAt = 1) },
            ),
            now,
            "Europe/London",
        )
        assertEquals("2026-10-22", columns.date)
        assertEquals(listOf("a"), columns.todo.map { it.localId })
        assertEquals(listOf("b"), columns.doing.map { it.localId })
        assertEquals(listOf("c"), columns.done.map { it.localId })
        assertNull(columns.now)
    }

    @Test
    fun `to do is ordered by day, timed tasks first, undated last`() {
        val columns = boardColumns(
            listOf(
                task("undated") { copy(createdAt = 1) },
                task("tomorrow") { copy(dueDate = "2026-10-23") },
                task("today-untimed") { copy(dueDate = "2026-10-22", createdAt = 2) },
                task("today-9") { copy(dueDate = "2026-10-22", dueTime = "09:00") },
            ),
            now,
            "Europe/London",
        )
        assertEquals(listOf("undated", "today-9", "today-untimed", "tomorrow"), columns.todo.map { it.localId })
    }

    @Test
    fun `the now task leads the in-progress column`() {
        val columns = boardColumns(
            listOf(
                task("early", TaskStatus.DOING) { copy(dueDate = "2026-10-20") },
                task("now", TaskStatus.DOING) { copy(isNow = true, dueDate = "2026-10-25") },
            ),
            now,
            null,
        )
        assertEquals(listOf("now", "early"), columns.doing.map { it.localId })
        assertEquals("now", columns.now?.localId)
    }

    @Test
    fun `done keeps the most recently completed, up to the limit`() {
        val done = (1..5).map { i -> task("d$i", TaskStatus.DONE) { copy(completedAt = i.toLong()) } }
        val columns = boardColumns(done, now, null, doneLimit = 3)
        assertEquals(listOf("d5", "d4", "d3"), columns.done.map { it.localId })
    }
}
