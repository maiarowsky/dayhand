package dev.helm.planner.domain

/** What quick add makes of one line: the title, and the day and time from a date phrase at its end. */
data class QuickAddInput(
    val title: String,
    val `when`: When?,
    /** The words read as the date ("fri 2pm"), so the sheet can show what was understood. */
    val phrase: String?,
)

/**
 * Quick add reads a date phrase at the end of the line, with the same grammar as `dayhand add --due` ([WhenParser]):
 * "Call the accountant fri 2pm" is "Call the accountant" on Friday at 14:00. The longest ending that is a whole
 * phrase wins and at least one word stays as the title, so "Plan next week" is "Plan" next Monday but a line that is
 * only a date ("tomorrow") stays a title. Without a phrase the line is the title and the day is the caller's default.
 * The same rules as macOS (`QuickAdd.swift`) and Linux (`QuickAdd.cpp`), but Android reads phrases up to nine words
 * long rather than their seven-word cap.
 */
object QuickAdd {
    /** Nine words cover "on the 23rd of october 2027 at 9 am", in either date/time order. */
    private const val MAX_PHRASE_WORDS = 9
    private val WORD = Regex("[^\\s\\p{Z}]+")

    fun parse(line: String, now: Long, timezone: String): QuickAddInput {
        val trimmed = line.trim()
        val words = WORD.findAll(trimmed).map { it.range.first }.toList()
        for (length in minOf(MAX_PHRASE_WORDS, words.size - 1) downTo 1) {
            val start = words[words.size - length]
            val phrase = trimmed.substring(start)
            val parsed = try {
                WhenParser.parse(phrase, now, timezone)
            } catch (_: WhenException) {
                continue
            }
            return QuickAddInput(trimmed.substring(0, start).trim(), parsed, phrase)
        }
        return QuickAddInput(trimmed, null, null)
    }
}
