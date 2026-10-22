package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Calendar dates are plain YYYY-MM-DD strings in the user's time zone, exactly as in
 * `backend/convex/lib/dates.ts`. Everything in the app that decides "today" or "overdue"
 * goes through this object.
 */
object HelmDates {
    /** The backend's default when the user has not set a zone (`DEFAULT_SETTINGS.timezone`). */
    const val DEFAULT_TIMEZONE = "Europe/London"

    fun zone(timezone: String?): ZoneId =
        try {
            ZoneId.of(timezone ?: DEFAULT_TIMEZONE)
        } catch (_: DateTimeException) {
            ZoneId.of(DEFAULT_TIMEZONE)
        }

    /** The calendar date at instant [epochMs] in [timezone] (backend `localDate`). */
    fun localDate(epochMs: Long, timezone: String?): String =
        Instant.ofEpochMilli(epochMs).atZone(zone(timezone)).toLocalDate().toString()

    fun addDays(date: String, days: Long): String = LocalDate.parse(date).plusDays(days).toString()

    /** Overdue = not done, still active, and due before today in the user's zone (backend `isOverdue`). */
    fun isOverdue(task: Task, today: String): Boolean =
        task.status != TaskStatus.DONE &&
            task.archivedAt == null &&
            task.dueDate != null &&
            task.dueDate < today

    /** Unix ms of the next local midnight after [epochMs], when "today" changes. */
    fun nextMidnight(epochMs: Long, timezone: String?): Long {
        val zone = zone(timezone)
        val tomorrow = Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate().plusDays(1)
        return tomorrow.atStartOfDay(zone).toInstant().toEpochMilli()
    }
}
