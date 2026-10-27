package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.text.Normalizer
import java.util.Locale

/**
 * Threads: ordinary tasks an assistant keeps for the owner, one per topic, in a fixed Polish format. The label
 * `wątek`, the title "Wątek: <topic>" (and "DO POTWIERDZENIA: <topic>" once the work is done) and a note in lines
 * "Stan teraz: …", "Co zrobiono: …", "Co od Ciebie: …", "Jak sprawdzić: …", plus "Podsumowanie: …" at the end. The
 * keys are data written by the assistant, so they are matched in Polish whatever the app's language. Nothing here
 * changes a task: a thread is closed by completing it like any other task.
 */
object Threads {
    const val LABEL = "wątek"
    const val TITLE_PREFIX = "Wątek:"
    const val CONFIRM_PREFIX = "DO POTWIERDZENIA:"

    /** The note's sections, by the key that starts their line. */
    enum class Field(val key: String) {
        STATE("Stan teraz"),
        DONE("Co zrobiono"),
        ASK("Co od Ciebie"),
        CHECK("Jak sprawdzić"),
        SUMMARY("Podsumowanie"),
    }

    /** The groups of the Threads view, in the order shown. */
    enum class Group { TO_CONFIRM, WAITING, IN_PROGRESS }

    /**
     * A note in the thread format: [intro] is any text before the first key, [fields] the sections in the order of
     * their first line (a key written twice adds to its section). Values keep their inner line breaks.
     */
    data class Note(val intro: String?, val fields: Map<Field, String>) {
        operator fun get(field: Field): String? = fields[field]
    }

    data class Thread(val task: Task, val topic: String, val group: Group, val note: Note?) {
        /** The line under the title: the first sentence of the summary (to confirm) or of the current state. */
        val headline: String? get() {
            val source = if (group == Group.TO_CONFIRM) note?.get(Field.SUMMARY)?.takeIf { it.isNotBlank() } ?: note?.get(Field.STATE)
            else note?.get(Field.STATE)
            return (source ?: task.note.takeIf { note == null })?.let(::firstSentence)
        }
    }

    data class Groups(val toConfirm: List<Thread>, val waiting: List<Thread>, val inProgress: List<Thread>) {
        /** What the owner is asked for: threads to confirm and threads waiting on them. */
        val attention: Int get() = toConfirm.size + waiting.size
        val all: List<Thread> get() = toConfirm + waiting + inProgress
        fun isEmpty(): Boolean = all.isEmpty()
    }

    private val labelKey = key(LABEL)

    // A key at the start of a line, optionally after a list marker and in **bold**: "- **Stan teraz:** …", "**Stan teraz**: …".
    private val fieldLine = Regex(
        """^\s*(?:[-*•]\s+)?(?:\*\*)?(${Field.entries.joinToString("|") { Regex.escape(it.key) }})(?:\*\*)?\s*:\s*(?:\*\*)?\s?(.*)$""",
        RegexOption.IGNORE_CASE,
    )

    private val url = Regex("""https?://[^\s<>"]+""", RegexOption.IGNORE_CASE)

    fun isThread(task: Task): Boolean = task.labels.any { key(it) == labelKey }

    /** Waiting to be read and closed by the owner. */
    fun toConfirm(title: String): Boolean = hasPrefix(title, CONFIRM_PREFIX)

    /** The title without "Wątek:" and "DO POTWIERDZENIA:", in either order; the whole title if nothing is left. */
    fun topic(title: String): String {
        var rest = Normalizer.normalize(title, Normalizer.Form.NFC).trim()
        while (true) {
            val prefix = listOf(CONFIRM_PREFIX, TITLE_PREFIX).firstOrNull { hasPrefix(rest, it) } ?: break
            rest = rest.trimStart().substring(prefix.length).trim()
        }
        return rest.ifEmpty { title.trim() }
    }

    /** The note's sections, or null when no line starts with one of the keys (the note is then shown as it is). */
    fun parseNote(note: String?): Note? {
        if (note.isNullOrBlank()) return null
        val lines = Normalizer.normalize(note, Normalizer.Form.NFC).replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val intro = mutableListOf<String>()
        val fields = LinkedHashMap<Field, MutableList<String>>()
        var current: MutableList<String>? = null
        for (line in lines) {
            val match = fieldLine.find(line)
            if (match != null) {
                val field = Field.entries.first { key(it.key) == key(match.groupValues[1]) }
                current = fields.getOrPut(field) { mutableListOf() }
                current += match.groupValues[2]
            } else (current ?: intro) += line
        }
        if (fields.isEmpty()) return null
        return Note(intro.joinToString("\n").trim().ifEmpty { null }, fields.mapValues { (_, value) -> value.joinToString("\n").trim() })
    }

    /** "Co od Ciebie" asks for something unless it is empty, only dashes, or starts with "nic" (nothing). */
    fun asksOwner(note: Note?): Boolean {
        val ask = note?.get(Field.ASK)?.trim() ?: return false
        if (ask.none { it.isLetterOrDigit() }) return false
        return !key(ask).startsWith("nic")
    }

    fun group(task: Task, note: Note? = parseNote(task.note)): Group = when {
        toConfirm(task.title) -> Group.TO_CONFIRM
        asksOwner(note) -> Group.WAITING
        else -> Group.IN_PROGRESS
    }

    fun thread(task: Task): Thread {
        val note = parseNote(task.note)
        return Thread(task, topic(task.title), group(task, note), note)
    }

    /** Open threads (not done, archived or in the trash), each group with the latest change first. */
    fun groups(tasks: List<Task>): Groups {
        val open = tasks.filter { it.isActive && it.status != TaskStatus.DONE && isThread(it) }
            .sortedByDescending { it.updatedAt }.map(::thread)
        return Groups(open.filter { it.group == Group.TO_CONFIRM }, open.filter { it.group == Group.WAITING },
            open.filter { it.group == Group.IN_PROGRESS })
    }

    /** Up to the first ".", "!", "?" or "…" followed by a space, or the first line; dots inside links do not end it. */
    fun firstSentence(text: String): String? {
        val line = text.trim().lineSequence().firstOrNull { it.isNotBlank() }?.trim() ?: return null
        val end = Regex("""[.!?…](?=\s|$)""").find(line)?.range?.last ?: return line
        return line.substring(0, end + 1)
    }

    /** Where the http(s) links in [text] are, without a closing bracket or punctuation that ends the sentence. */
    fun links(text: String): List<IntRange> = url.findAll(text).map { match ->
        var last = match.range.last
        while (last > match.range.first && text[last] in ".,;:!?)]}'\"”’") {
            // A ")" that closes a "(" inside the link stays: https://en.wikipedia.org/wiki/Foo_(bar).
            if (text[last] == ')' && text.substring(match.range.first, last).count { it == '(' } >
                text.substring(match.range.first, last).count { it == ')' }) break
            last--
        }
        match.range.first..last
    }.toList()

    /** How long ago [then] was, rounded down: under a minute, minutes, hours, then days. */
    sealed interface Age {
        data object Now : Age
        data class Minutes(val value: Long) : Age
        data class Hours(val value: Long) : Age
        data class Days(val value: Long) : Age
    }

    fun age(then: Long, now: Long): Age {
        val minutes = ((now - then).coerceAtLeast(0)) / 60_000
        return when {
            minutes < 1 -> Age.Now
            minutes < 60 -> Age.Minutes(minutes)
            minutes < 24 * 60 -> Age.Hours(minutes / 60)
            else -> Age.Days(minutes / (24 * 60))
        }
    }

    private fun hasPrefix(title: String, prefix: String): Boolean =
        key(title.trimStart()).startsWith(key(prefix))

    private fun key(text: String): String = Normalizer.normalize(text.trim(), Normalizer.Form.NFC).lowercase(Locale.ROOT)
}
