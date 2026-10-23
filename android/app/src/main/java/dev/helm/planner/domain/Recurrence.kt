package dev.helm.planner.domain

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/**
 * The dates a repeating task falls on, exactly as `backend/convex/lib/repeat.ts` computes them: [advance] is what
 * completing a task creates on the server, [occurrences] lists a series ahead (a calendar, "next: Fri 31 Oct"). Both
 * walk the same [step], so listing ahead gives the dates that completing each occurrence on its day would create.
 * Pure: plain calendar dates, no time zone.
 */
object Recurrence {
    /** Months searched for an nth weekday a month may lack (a 5th Monday). */
    private const val MAX_MONTH_SEARCH = 120

    /** Safety net for a due date far in the past; one step per occurrence. */
    private const val MAX_STEPS = 100_000

    /** A date of a series and the rule that continues from it. */
    data class Position(val date: LocalDate, val rule: RepeatRule)

    /** The next occurrence after completing a task: its due date and the rule it carries on with. */
    data class Next(val dueDate: String, val repeat: RepeatRule)

    /** Day [monthDay] (-1 = the last) of the month of [month]; a day the month lacks becomes its last day. */
    fun monthDayIn(month: LocalDate, monthDay: Int): LocalDate {
        val last = month.lengthOfMonth()
        return month.withDayOfMonth(if (monthDay == -1) last else minOf(monthDay, last))
    }

    /** The [nth] [weekday] (1 = Monday) of the month of [month], negative from its end, or null when it has none. */
    fun nthWeekdayIn(month: LocalDate, nth: Int, weekday: Int): LocalDate? {
        val first = month.withDayOfMonth(1)
        val last = month.lengthOfMonth()
        return if (nth > 0) {
            val day = 1 + Math.floorMod(weekday - first.dayOfWeek.value, 7) + 7 * (nth - 1)
            if (day <= last) first.withDayOfMonth(day) else null
        } else {
            val lastDay = first.withDayOfMonth(last)
            val day = last - Math.floorMod(lastDay.dayOfWeek.value - weekday, 7) - 7 * (-nth - 1)
            if (day >= 1) first.withDayOfMonth(day) else null
        }
    }

    /**
     * The next date of a series after [date], the series running from [date]. A plain monthly rule that had to move a
     * 29-31 to a shorter month's last day keeps the intended day from then on (`monthDay`), so 31 Jan, 28 Feb, 31 Mar.
     * Null when no later date exists.
     */
    fun step(rule: RepeatRule, date: LocalDate): Position? = when (rule.every) {
        RepeatEvery.DAY -> Position(date.plusDays(rule.interval.toLong()), rule)
        // plusYears/plusMonths keep the day where the month allows it (29 Feb -> 28 Feb), as the backend's addMonths.
        RepeatEvery.YEAR -> Position(date.plusYears(rule.interval.toLong()), rule)
        RepeatEvery.WEEK -> {
            val days = rule.weekdays?.sorted()
            if (days.isNullOrEmpty()) {
                Position(date.plusWeeks(rule.interval.toLong()), rule)
            } else {
                val current = date.dayOfWeek.value
                val later = days.firstOrNull { it > current }
                if (later != null) {
                    Position(date.plusDays((later - current).toLong()), rule)
                } else {
                    val monday = date.minusDays((current - 1).toLong())
                    Position(monday.plusDays(7L * rule.interval + days.first() - 1), rule)
                }
            }
        }
        RepeatEvery.MONTH -> monthStep(rule, date)
    }

    private fun monthStep(rule: RepeatRule, date: LocalDate): Position? {
        rule.monthDay?.let { day ->
            val sameMonth = monthDayIn(date, day)
            return Position(if (sameMonth > date) sameMonth else monthDayIn(date.withDayOfMonth(1).plusMonths(rule.interval.toLong()), day), rule)
        }
        rule.weekdayOfMonth?.let { (nth, weekday) ->
            val start = date.withDayOfMonth(1)
            var k = 0
            while (k <= MAX_MONTH_SEARCH) {
                val found = nthWeekdayIn(start.plusMonths(k.toLong()), nth, weekday)
                if (found != null && found > date) return Position(found, rule)
                k += rule.interval
            }
            return null
        }
        val next = date.plusMonths(rule.interval.toLong())
        return Position(next, if (next.dayOfMonth < date.dayOfMonth) rule.copy(monthDay = date.dayOfMonth) else rule)
    }

    /**
     * The next occurrence when a task of [rule] is completed on [today] (YYYY-MM-DD in the user's zone). Counted from
     * the due date, the first date of the series after today: a late completion skips the dates it missed, and they
     * count against `count`. Counted from completion (or without a due date), the first date after today. Null when
     * the series has ended.
     */
    fun advance(rule: RepeatRule, dueDate: String?, today: String): Next? {
        val day = LocalDate.parse(today)
        var position = Position(if (rule.fromCompletion || dueDate == null) day else LocalDate.parse(dueDate), rule)
        var steps = 0
        do {
            position = step(position.rule, position.date) ?: return null
            if (++steps > MAX_STEPS) return null
        } while (position.date <= day)
        if (rule.until != null && position.date.toString() > rule.until) return null
        val count = rule.count ?: return Next(position.date.toString(), position.rule)
        val left = count - steps
        return if (left < 1) null else Next(position.date.toString(), position.rule.copy(count = left))
    }

    /**
     * Dates of a series whose first occurrence is [start], from [from] to [to] (both included), at most [limit]. A
     * rule counted from completion is shown as if each occurrence were done on its day.
     */
    fun occurrences(rule: RepeatRule, start: String, from: String, to: String, limit: Int = 500): List<String> {
        val first = LocalDate.parse(from)
        val last = LocalDate.parse(to)
        val dates = mutableListOf<String>()
        var position: Position? = Position(LocalDate.parse(start), rule)
        var left = rule.count ?: Int.MAX_VALUE
        while (position != null && position.date <= last && dates.size < limit) {
            if (rule.until != null && position.date.toString() > rule.until) break
            if (position.date >= first) dates += position.date.toString()
            if (--left < 1) break
            position = step(position.rule, position.date)
        }
        return dates
    }

    /** The nth weekday of [date] in its month, from the start (1 to 5): 13 Oct 2026 is the 2nd Tuesday. */
    fun nthOfMonth(date: LocalDate): Int = (date.dayOfMonth - 1) / 7 + 1

    /** True when [date] is in the last seven days of its month, so it is also "the last <weekday>". */
    fun isLastOfMonth(date: LocalDate): Boolean = date.plusWeeks(1).month != date.month

    /** The last day of [date]'s month. */
    fun endOfMonth(date: LocalDate): LocalDate = date.with(TemporalAdjusters.lastDayOfMonth())
}
