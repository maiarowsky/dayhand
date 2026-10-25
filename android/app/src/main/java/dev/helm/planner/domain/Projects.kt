package dev.helm.planner.domain

import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.text.Normalizer
import java.util.Locale

/** Mirrors the merged backend's project rules (50 characters, not the research draft's 60). */
object ProjectRules {
    const val MAX_NAME = 50
    const val MAX_NOTE = 2000
    const val MAX_PROJECTS = 200
    const val POSITION_STEP = 1024.0
    const val MAX_POSITION = 1e15
    val colors = listOf("red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "purple", "pink", "brown", "gray")

    fun nameKey(name: String): String = Normalizer.normalize(name.trim(), Normalizer.Form.NFC).lowercase(Locale.ROOT)

    fun name(input: String): String? = Normalizer.normalize(input.trim(), Normalizer.Form.NFC).takeIf {
        it.isNotEmpty() && it.length <= MAX_NAME && nameKey(it) != "none" && it.none { c -> Character.isISOControl(c) }
    }

    fun validName(input: String, projects: List<Project>, except: String? = null): Boolean =
        name(input) != null && projects.none { it.localId != except && nameKey(it.name) == nameKey(input) }

    /** One emoji sequence, including flags, skin tones, keycaps and ZWJ sequences. */
    fun validIcon(input: String): Boolean {
        val icon = input.trim()
        if (icon.isEmpty()) return true
        if (icon.length > 16) return false
        val points = icon.codePoints().toArray().toList()
        if (points.size == 2 && points.all { it in 0x1F1E6..0x1F1FF }) return true
        if (Regex("[0-9#*]\\uFE0F?\\u20E3").matches(icon)) return true
        if (points.firstOrNull() == 0x1F3F4 && points.lastOrNull() == 0xE007F &&
            points.drop(1).dropLast(1).isNotEmpty() && points.drop(1).dropLast(1).all { it in 0xE0061..0xE007A }) return true
        val parts = icon.split('\u200D')
        return parts.all { part ->
            val cps = part.codePoints().toArray().toList()
            val base = cps.firstOrNull() ?: return@all false
            val suffix = cps.drop(1)
            (EmojiProperties.pictographic(base) && (suffix.isEmpty() || suffix == listOf(0xFE0F))) ||
                (EmojiProperties.modifierBase(base) && suffix.size in 1..2 && suffix.last() in 0x1F3FB..0x1F3FF && suffix.dropLast(1).all { it == 0xFE0F })
        }
    }
}

data class ProjectCounts(val open: Int, val overdue: Int)

fun projectCounts(tasks: List<Task>, today: String): ProjectCounts {
    val open = tasks.filter { it.isActive && it.status != TaskStatus.DONE }
    return ProjectCounts(open.size, open.count { it.dueDate != null && it.dueDate < today })
}

/** The same grouping for projects, no-project and labels; only the fifty latest completions. */
data class ProjectSections(val overdue: List<Task>, val today: List<Task>, val later: List<Task>, val undated: List<Task>, val done: List<Task>)

fun projectSections(tasks: List<Task>, today: String): ProjectSections {
    val active = tasks.filter { it.isActive }
    val open = active.filter { it.status != TaskStatus.DONE }.sortedWith(compareBy({ it.dueDate ?: "9999" }, { it.dueTime ?: "99" }, { it.createdAt }))
    return ProjectSections(
        open.filter { it.dueDate != null && it.dueDate < today },
        open.filter { it.dueDate == today },
        open.filter { it.dueDate != null && it.dueDate > today },
        open.filter { it.dueDate == null },
        active.filter { it.status == TaskStatus.DONE }.sortedByDescending { it.completedAt }.take(50),
    )
}
