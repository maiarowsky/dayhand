package dev.helm.planner.domain

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import java.net.URI
import java.net.URISyntaxException
import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalTime

/**
 * The backend's input checks (`backend/convex/lib/core.ts`, `repeat.ts`), applied on the phone
 * before a change enters the outbox: a change the server would refuse is never queued, so the
 * user sees the problem at once instead of the change silently disappearing later.
 */
object TaskRules {
    const val MAX_TITLE = 500
    const val MAX_NOTE = 20_000
    const val MAX_RESUME_NOTE = 2_000
    const val MAX_LINKS = 20
    const val MAX_URL = 2_048
    const val MAX_REPEAT_INTERVAL = 366
    const val MAX_REPEAT_COUNT = 1000
    const val MAX_CHECKLIST = 100
    const val MAX_REMINDERS = 5
    const val MAX_REMINDER_MINUTES = 7 * 24 * 60
    const val MAX_REMINDER_DAYS = 30

    /** A trimmed, non-empty title within the limit, or null. */
    fun title(input: String): String? = input.trim().takeIf { it.isNotEmpty() && it.length <= MAX_TITLE }

    /** True for an absolute http(s) address the backend accepts. */
    fun isLinkUrl(url: String): Boolean {
        if (url.isBlank() || url.length > MAX_URL || url != url.trim()) return false
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return false
        }
        return (uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrEmpty()
    }

    /** The link as the backend stores it (blank title dropped), or null when the address is not accepted. */
    fun link(url: String, title: String?): TaskLink? {
        val cleanUrl = url.trim()
        if (!isLinkUrl(cleanUrl)) return null
        return TaskLink(cleanUrl, title?.trim()?.takeIf { it.isNotEmpty() })
    }

    /** The backend's `validateRepeat`. */
    fun isValid(rule: RepeatRule): Boolean {
        if (rule.interval !in 1..MAX_REPEAT_INTERVAL) return false
        rule.weekdays?.let { days ->
            if (rule.every != RepeatEvery.WEEK || days.isEmpty() || days.distinct().size != days.size || days.any { it !in 1..7 }) return false
        }
        rule.monthDay?.let { if (rule.every != RepeatEvery.MONTH || (it != -1 && it !in 1..31)) return false }
        rule.weekdayOfMonth?.let { (nth, weekday) ->
            if (rule.every != RepeatEvery.MONTH || rule.monthDay != null || nth == 0 || nth !in -5..5 || weekday !in 1..7) return false
        }
        if (rule.until != null && (rule.count != null || !isDate(rule.until))) return false
        return rule.count == null || rule.count in 1..MAX_REPEAT_COUNT
    }

    /**
     * The checklist as the backend stores it: trimmed titles, blank items dropped; null when over a limit. Items keep
     * their ids (the phone gives new items one, so the outbox can name them before the server has seen them).
     */
    fun checklist(items: List<ChecklistItem>): List<ChecklistItem>? {
        val cleaned = items.map { it.copy(title = it.title.trim()) }.filter { it.title.isNotEmpty() }
        if (cleaned.size > MAX_CHECKLIST || cleaned.any { it.title.length > MAX_TITLE }) return null
        if (cleaned.map { it.id }.distinct().size != cleaned.size) return null
        return cleaned
    }

    /** Reminders as the backend keeps them (checked, without duplicates); null when one is invalid or there are too many. */
    fun reminders(input: List<TaskReminder>): List<TaskReminder>? {
        val cleaned = input.distinct()
        if (cleaned.size > MAX_REMINDERS) return null
        return cleaned.takeIf { it.all(::isValid) }
    }

    fun isValid(reminder: TaskReminder): Boolean {
        val minutes = reminder.minutesBefore
        if (minutes != null) return reminder.time == null && reminder.daysBefore == null && minutes in 0..MAX_REMINDER_MINUTES
        val time = reminder.time ?: return false
        if (reminder.daysBefore != null && reminder.daysBefore !in 1..MAX_REMINDER_DAYS) return false
        return TIME.matches(time) && try {
            LocalTime.parse(time)
            true
        } catch (_: DateTimeException) {
            false
        }
    }

    private val TIME = Regex("^\\d{2}:\\d{2}$")

    private fun isDate(value: String) = try {
        LocalDate.parse(value).toString() == value
    } catch (_: DateTimeException) {
        false
    }
}
