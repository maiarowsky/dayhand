package dev.helm.planner.domain

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** A day ("2026-10-23"), and a time ("14:00") when the phrase named one. */
data class When(
    val date: String,
    val time: String? = null,
    /** The typed time does not exist that day (clocks go forward) and was moved forward to [time]. */
    val shiftedFrom: String? = null,
)

class WhenException(message: String) : Exception(message)

/**
 * Dates in plain English, the grammar of `dayhand` (`cli/src/when/parse.ts`), case for case: "tomorrow", "fri 2pm",
 * "next mon", "in 3 days", "23 oct", "2026-10-23". A small deterministic grammar (no NLP): the same phrase at the
 * same moment in the same time zone always gives the same day. English only, as in `dayhand`.
 */
object WhenParser {
    private val WEEKDAYS = mapOf(
        "mon" to 1, "monday" to 1, "tue" to 2, "tues" to 2, "tuesday" to 2, "wed" to 3, "weds" to 3, "wednesday" to 3,
        "thu" to 4, "thur" to 4, "thurs" to 4, "thursday" to 4, "fri" to 5, "friday" to 5, "sat" to 6, "saturday" to 6,
        "sun" to 7, "sunday" to 7,
    )
    private val MONTHS = mapOf(
        "jan" to 1, "january" to 1, "feb" to 2, "february" to 2, "mar" to 3, "march" to 3, "apr" to 4, "april" to 4,
        "may" to 5, "jun" to 6, "june" to 6, "jul" to 7, "july" to 7, "aug" to 8, "august" to 8, "sep" to 9,
        "sept" to 9, "september" to 9, "oct" to 10, "october" to 10, "nov" to 11, "november" to 11, "dec" to 12,
        "december" to 12,
    )
    private val NUMBERS = mapOf(
        "a" to 1, "an" to 1, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7,
        "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12,
    )

    private enum class Unit { MINUTE, HOUR, DAY, WEEK, MONTH, YEAR }

    private val UNITS = mapOf(
        "min" to Unit.MINUTE, "mins" to Unit.MINUTE, "minute" to Unit.MINUTE, "minutes" to Unit.MINUTE,
        "h" to Unit.HOUR, "hr" to Unit.HOUR, "hrs" to Unit.HOUR, "hour" to Unit.HOUR, "hours" to Unit.HOUR,
        "d" to Unit.DAY, "day" to Unit.DAY, "days" to Unit.DAY, "w" to Unit.WEEK, "wk" to Unit.WEEK,
        "wks" to Unit.WEEK, "week" to Unit.WEEK, "weeks" to Unit.WEEK, "mo" to Unit.MONTH, "month" to Unit.MONTH,
        "months" to Unit.MONTH, "y" to Unit.YEAR, "yr" to Unit.YEAR, "yrs" to Unit.YEAR, "year" to Unit.YEAR,
        "years" to Unit.YEAR,
    )

    private val SPACES = Regex("[\\s\\p{Z}]+")
    private val SHORT_INSTANT = Regex("^\\+(\\d{1,3})(h|min)$")
    private val SHORT_SHIFT = Regex("^\\+(\\d{1,3})(d|w|mo|y)$")
    private val ISO = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")
    private val COUNT = Regex("^\\d{1,3}$")
    private val DAY = Regex("^(\\d{1,2})(st|nd|rd|th)?$")
    private val YEAR = Regex("^\\d{4}$")
    private val TIME = Regex("^(\\d{1,2})(?::(\\d{2}))?(am|pm)?$")

    private class Ref(val now: Long, val zone: ZoneId, val today: LocalDate, val time: LocalTime)

    private class Match<T>(val value: T, val next: Int)

    /** The day and time [text] means at [now] (Unix ms) in [timezone]; [WhenException] when it is not understood. */
    fun parse(text: String, now: Long, timezone: String): When {
        val tokens = text.lowercase(Locale.ROOT).replace(",", " ").trim().split(SPACES).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) throw notUnderstood()
        val zone = HelmDates.zone(timezone)
        val local = localAt(now, zone)
        val ref = Ref(now, zone, local.toLocalDate(), local.toLocalTime())

        relativeInstant(tokens, ref)?.let { return it }

        val date = datePart(tokens, 0, ref)
        if (date != null) {
            if (date.next == tokens.size) return When(date.value.toString())
            val time = timePart(tokens, date.next)
            if (time != null && time.next == tokens.size) return settle(date.value, time.value, zone)
            throw notUnderstood()
        }
        val time = timePart(tokens, 0) ?: throw notUnderstood()
        if (time.next == tokens.size) {
            // A time alone is the next time the clock shows it: today, or tomorrow once it has passed.
            val day = if (time.value > ref.time) ref.today else ref.today.plusDays(1)
            return settle(day, time.value, zone)
        }
        val start = if (tokens[time.next] == "on") time.next + 1 else time.next
        val after = datePart(tokens, start, ref)
        if (after != null && after.next == tokens.size) return settle(after.value, time.value, zone)
        throw notUnderstood()
    }

    /** The wall clock in [zone] at an instant, seconds dropped. */
    private fun localAt(epochMs: Long, zone: ZoneId): LocalDateTime =
        Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDateTime().truncatedTo(ChronoUnit.MINUTES)

    private fun notUnderstood() =
        WhenException("Not a date Dayhand understands; try e.g. tomorrow, fri 14:00, next mon, in 3 days, 23 oct, 2026-10-23")

    private fun noSuchDay() = WhenException("That day does not exist in the calendar")

    private fun hhmm(time: LocalTime) = "%02d:%02d".format(Locale.ROOT, time.hour, time.minute)

    /**
     * A wall-clock time that does not exist (clocks going forward) moves forward by the gap; one that happens twice
     * (clocks going back) is the earlier one, as `instantOf` in `cli/src/when/calendar.ts`.
     */
    private fun settle(date: LocalDate, time: LocalTime, zone: ZoneId): When {
        val wanted = LocalDateTime.of(date, time)
        val real = ZonedDateTime.of(wanted, zone).toLocalDateTime()
        if (real == wanted) return When(date.toString(), hhmm(time))
        return When(real.toLocalDate().toString(), hhmm(real.toLocalTime()), shiftedFrom = hhmm(time))
    }

    private fun count(word: String?): Int? = when {
        word == null -> null
        COUNT.matches(word) -> word.toInt()
        else -> NUMBERS[word]
    }

    /** "in 2 hours", "in 30 min", "+3h": a moment, so both a day and a time. */
    private fun relativeInstant(tokens: List<String>, ref: Ref): When? {
        var amount: Int? = null
        var unit: Unit? = null
        val short = if (tokens.size == 1) SHORT_INSTANT.find(tokens[0]) else null
        if (short != null) {
            amount = short.groupValues[1].toInt()
            unit = UNITS[short.groupValues[2]]
        } else if (tokens.size == 3 && tokens[0] == "in") {
            amount = count(tokens[1])
            unit = UNITS[tokens[2]]
        }
        if (amount == null || (unit != Unit.HOUR && unit != Unit.MINUTE)) return null
        val at = localAt(ref.now + amount * if (unit == Unit.HOUR) 3_600_000L else 60_000L, ref.zone)
        return When(at.toLocalDate().toString(), hhmm(at.toLocalTime()))
    }

    private fun shift(date: LocalDate, amount: Int, unit: Unit): LocalDate = when (unit) {
        Unit.DAY -> date.plusDays(amount.toLong())
        Unit.WEEK -> date.plusWeeks(amount.toLong())
        Unit.MONTH -> date.plusMonths(amount.toLong())
        else -> date.plusYears(amount.toLong())
    }

    /** First day on or after [from] with this ISO weekday. */
    private fun onOrAfter(from: LocalDate, weekday: Int) = from.plusDays(((weekday - from.dayOfWeek.value + 7) % 7).toLong())

    private fun nextWeekMonday(today: LocalDate) = today.plusDays((8 - today.dayOfWeek.value).toLong())

    /** Saturday on or after today; on a Sunday, today. */
    private fun weekend(today: LocalDate) = if (today.dayOfWeek.value == 7) today else onOrAfter(today, 6)

    private fun endOfMonth(today: LocalDate) = today.with(TemporalAdjusters.lastDayOfMonth())

    private fun endOfYear(today: LocalDate) = LocalDate.of(today.year, 12, 31)

    private fun datePart(tokens: List<String>, start: Int, ref: Ref): Match<LocalDate>? {
        var i = start
        if (tokens.getOrNull(i) == "on") i++
        val word = tokens.getOrNull(i) ?: return null
        fun one(value: LocalDate) = Match(value, i + 1)
        fun two(value: LocalDate) = Match(value, i + 2)

        when (word) {
            "today", "tod" -> return one(ref.today)
            "tomorrow", "tmr", "tmrw" -> return one(ref.today.plusDays(1))
            "yesterday" -> return one(ref.today.minusDays(1))
            "weekend" -> return one(weekend(ref.today))
            "eow" -> return one(onOrAfter(ref.today, 7))
            "eoww" -> return one(onOrAfter(ref.today, 5))
            "eom" -> return one(endOfMonth(ref.today))
            "eoy" -> return one(endOfYear(ref.today))
        }
        WEEKDAYS[word]?.let { weekday ->
            return one(ref.today.plusDays((((weekday - ref.today.dayOfWeek.value + 6) % 7) + 1).toLong()))
        }
        ISO.find(word)?.let { iso ->
            val (y, m, d) = iso.destructured
            return one(realDate(y.toInt(), m.toInt(), d.toInt()))
        }
        SHORT_SHIFT.find(word)?.let { plus ->
            return one(shift(ref.today, plus.groupValues[1].toInt(), UNITS.getValue(plus.groupValues[2])))
        }

        val following = tokens.getOrNull(i + 1)
        val followingDay = following?.let { WEEKDAYS[it] }
        if (word == "this" && following != null) {
            if (followingDay != null) return two(onOrAfter(ref.today, followingDay))
            if (following == "weekend") return two(weekend(ref.today))
        }
        if (word == "next" && following != null) {
            val monday = nextWeekMonday(ref.today)
            if (followingDay != null) return two(monday.plusDays((followingDay - 1).toLong()))
            when (following) {
                "week" -> return two(monday)
                "weekend" -> return two(monday.plusDays(5))
                "month" -> return two(ref.today.plusMonths(1).withDayOfMonth(1))
                "year" -> return two(LocalDate.of(ref.today.year + 1, 1, 1))
            }
        }
        if (word == "in" && following != null) {
            val amount = count(following)
            val unit = tokens.getOrNull(i + 2)?.let { UNITS[it] }
            if (amount != null && unit != null && unit != Unit.HOUR && unit != Unit.MINUTE) {
                return Match(shift(ref.today, amount, unit), i + 3)
            }
        }
        return phraseDate(tokens, i, ref) ?: dayMonth(tokens, i, ref)
    }

    /** "end of week/work week/month/year", "day after tomorrow". */
    private fun phraseDate(tokens: List<String>, i: Int, ref: Ref): Match<LocalDate>? {
        val rest = tokens.drop(i).joinToString(" ")
        val phrases: List<Pair<Regex, () -> LocalDate>> = listOf(
            Regex("^(the )?day after tomorrow\\b") to { ref.today.plusDays(2) },
            Regex("^end of (the )?work week\\b") to { onOrAfter(ref.today, 5) },
            Regex("^end of (the )?week\\b") to { onOrAfter(ref.today, 7) },
            Regex("^end of (the )?month\\b") to { endOfMonth(ref.today) },
            Regex("^end of (the )?year\\b") to { endOfYear(ref.today) },
        )
        for ((pattern, resolve) in phrases) {
            val found = pattern.find(rest) ?: continue
            return Match(resolve(), i + found.value.split(" ").size)
        }
        return null
    }

    /** "23 oct", "23rd of october 2027", "oct 23", "the 15th". */
    private fun dayMonth(tokens: List<String>, start: Int, ref: Ref): Match<LocalDate>? {
        var i = start
        if (tokens.getOrNull(i) == "the") i++
        fun day(word: String?) = word?.let { DAY.find(it) }
        fun year(word: String?) = word?.takeIf { YEAR.matches(it) }?.toInt()

        val first = day(tokens.getOrNull(i))
        if (first != null) {
            var j = i + 1
            if (tokens.getOrNull(j) == "of") j++
            val month = tokens.getOrNull(j)?.let { MONTHS[it] }
            if (month != null) {
                val y = year(tokens.getOrNull(j + 1))
                return Match(dated(first.groupValues[1].toInt(), month, y, ref), if (y == null) j + 1 else j + 2)
            }
            // "the 15th": the next 15th of a month, this month included.
            if (first.groupValues[2].isNotEmpty()) return Match(nextDayOfMonth(first.groupValues[1].toInt(), ref.today), i + 1)
            return null
        }
        val month = tokens.getOrNull(i)?.let { MONTHS[it] }
        val second = day(tokens.getOrNull(i + 1))
        if (month != null && second != null) {
            val y = year(tokens.getOrNull(i + 2))
            return Match(dated(second.groupValues[1].toInt(), month, y, ref), if (y == null) i + 2 else i + 3)
        }
        return null
    }

    private fun realDateOrNull(year: Int, month: Int, day: Int): LocalDate? =
        try {
            LocalDate.of(year, month, day)
        } catch (_: DateTimeException) {
            null
        }

    private fun realDate(year: Int, month: Int, day: Int): LocalDate = realDateOrNull(year, month, day) ?: throw noSuchDay()

    /** With a year, exactly that day; without, its next occurrence (today included). */
    private fun dated(day: Int, month: Int, year: Int?, ref: Ref): LocalDate {
        if (year != null) return realDate(year, month, day)
        for (y in ref.today.year until ref.today.year + 9) {
            val date = realDateOrNull(y, month, day)
            if (date != null && date >= ref.today) return date
        }
        throw noSuchDay()
    }

    private fun nextDayOfMonth(day: Int, today: LocalDate): LocalDate {
        if (day !in 1..31) throw noSuchDay()
        for (m in 0L until 13L) {
            val month = today.withDayOfMonth(1).plusMonths(m)
            if (day <= month.lengthOfMonth()) {
                val candidate = month.withDayOfMonth(day)
                if (candidate >= today) return candidate
            }
        }
        throw noSuchDay()
    }

    /** "14:00", "9:30am", "2pm", "2 pm", "at 9", "noon", "midnight" (24h unless am/pm). */
    private fun timePart(tokens: List<String>, start: Int): Match<LocalTime>? {
        var i = start
        val at = tokens.getOrNull(i) == "at"
        if (at) i++
        val word = tokens.getOrNull(i) ?: return null
        if (word == "noon") return Match(LocalTime.NOON, i + 1)
        if (word == "midnight") return Match(LocalTime.MIDNIGHT, i + 1)

        val found = TIME.find(word) ?: return null
        var meridiem = found.groupValues[3]
        var next = i + 1
        if (meridiem.isEmpty() && (tokens.getOrNull(next) == "am" || tokens.getOrNull(next) == "pm")) meridiem = tokens[next++]
        // A bare number is a time only after "at" ("at 9"); "9" alone is not a date or a time.
        if (meridiem.isEmpty() && found.groupValues[2].isEmpty() && !at) return null

        var hour = found.groupValues[1].toInt()
        val minute = found.groupValues[2].ifEmpty { "0" }.toInt()
        if (minute > 59) throw WhenException("Minutes must be 00 to 59")
        if (meridiem.isNotEmpty()) {
            if (hour !in 1..12) throw WhenException("With am or pm the hour must be 1 to 12")
            hour = hour % 12 + if (meridiem == "pm") 12 else 0
        } else if (hour > 23) {
            throw WhenException("The hour must be 0 to 23")
        }
        return Match(LocalTime.of(hour, minute), next)
    }
}
