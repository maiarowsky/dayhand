package dev.helm.planner.domain

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskLink
import java.net.URI
import java.net.URISyntaxException

/**
 * The backend's input checks (`backend/convex/lib/core.ts`, `repeat.ts`), applied on the phone
 * before a change enters the outbox: a change the server would refuse is never queued, so the
 * user sees the problem at once instead of the change silently disappearing later.
 */
object TaskRules {
    const val MAX_TITLE = 500
    const val MAX_NOTE = 20_000
    const val MAX_RESUME_NOTE = 2_000
    const val MAX_LABEL = 50
    const val MAX_LABELS = 20
    const val MAX_LINKS = 20
    const val MAX_URL = 2_048
    const val MAX_REPEAT_INTERVAL = 366

    /** A trimmed, non-empty title within the limit, or null. */
    fun title(input: String): String? = input.trim().takeIf { it.isNotEmpty() && it.length <= MAX_TITLE }

    /** Trimmed, without blanks and duplicates, as the backend stores them; null when over a limit. */
    fun labels(input: List<String>): List<String>? {
        val cleaned = input.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (cleaned.size > MAX_LABELS || cleaned.any { it.length > MAX_LABEL }) return null
        return cleaned
    }

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

    fun isValid(rule: RepeatRule): Boolean {
        if (rule.interval !in 1..MAX_REPEAT_INTERVAL) return false
        val days = rule.weekdays ?: return true
        return rule.every == RepeatEvery.WEEK && days.isNotEmpty() && days.distinct().size == days.size && days.all { it in 1..7 }
    }
}
