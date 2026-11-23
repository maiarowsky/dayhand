package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.text.Normalizer
import java.util.Locale

/**
 * Search from Today, as macOS (⌘K) and `dayhand ui` (`/`) search: the title, the note and the resume note contain
 * what is typed, ignoring case and accents ("zolw" finds "Żółw"). Tasks in the archive or the trash are left out.
 */
object TaskSearch {
    /** Open tasks first by schedule (those without a day last), then done ones, most recently done first. */
    fun find(tasks: List<Task>, query: String): List<Task> {
        val needle = fold(query.trim())
        if (needle.isEmpty()) return emptyList()
        val found = tasks.filter { it.isActive && matches(it, needle) }
        val (done, open) = found.partition { it.status == TaskStatus.DONE }
        val (dated, undated) = open.partition { it.dueDate != null }
        return dated.sortedWith(bySchedule) + undated.sortedBy { it.createdAt } + done.sortedByDescending { it.completedAt ?: 0L }
    }

    private fun matches(task: Task, needle: String): Boolean =
        listOfNotNull(task.title, task.note, task.resumeNote).any { fold(it).contains(needle) }

    private val marks = Regex("\\p{M}+")

    /** Lower case without accents; "ł", which has no accent to drop, as "l". */
    private fun fold(text: String): String =
        Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(marks, "").replace('ł', 'l')
}
