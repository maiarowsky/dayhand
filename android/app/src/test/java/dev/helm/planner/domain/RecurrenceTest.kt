package dev.helm.planner.domain

import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatFrom
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.WeekdayOfMonth
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The same cases as `backend/tests/repeat.test.ts`: the app and the server must agree on every date a series falls
 * on. Month ends, leap years, nth weekdays, counting from completion, until/count and London's clock changes.
 */
class RecurrenceTest {
    private val year = "2026-01-01" to "2031-12-31"

    private fun monthly(
        monthDay: Int? = null,
        nth: WeekdayOfMonth? = null,
        interval: Int = 1,
        from: RepeatFrom? = null,
        until: String? = null,
    ) = RepeatRule(RepeatEvery.MONTH, interval, monthDay = monthDay, weekdayOfMonth = nth, from = from, until = until)

    private fun daily(interval: Int = 1, count: Int? = null, until: String? = null, from: RepeatFrom? = null) =
        RepeatRule(RepeatEvery.DAY, interval, from = from, until = until, count = count)

    private fun list(rule: RepeatRule, start: String, limit: Int = 500, range: Pair<String, String> = year) =
        Recurrence.occurrences(rule, start, range.first, range.second, limit)

    /** Completes each occurrence on its own day, [n] times, and returns the due dates. */
    private fun completeOnTime(rule: RepeatRule, start: String, n: Int): List<String> {
        val dates = mutableListOf(start)
        var current = Recurrence.Next(start, rule)
        while (dates.size < n) {
            current = Recurrence.advance(current.repeat, current.dueDate, current.dueDate) ?: break
            dates += current.dueDate
        }
        return dates
    }

    private fun day(date: String) = LocalDate.parse(date)

    @Test
    fun `the last day of the month`() {
        assertEquals(listOf("2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"), list(monthly(monthDay = -1), "2026-01-31", 4))
        val feb = Recurrence.advance(monthly(monthDay = -1), "2026-01-31", "2026-01-31")!!
        assertEquals("2026-02-28", feb.dueDate)
        assertEquals("2026-03-31", Recurrence.advance(feb.repeat, feb.dueDate, feb.dueDate)!!.dueDate)
    }

    @Test
    fun `day 31 falls on a shorter month's last day and comes back`() {
        assertEquals(listOf("2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"), list(monthly(monthDay = 31), "2026-01-31", 4))
    }

    @Test
    fun `a plain monthly rule keeps a 29 to 31 after a shorter month, and leaves the 15th alone`() {
        val feb = Recurrence.advance(monthly(), "2026-01-31", "2026-01-31")!!
        assertEquals(Recurrence.Next("2026-02-28", monthly(monthDay = 31)), feb)
        assertEquals("2026-03-31", Recurrence.advance(feb.repeat, feb.dueDate, feb.dueDate)!!.dueDate)
        assertEquals(listOf("2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30"), completeOnTime(monthly(), "2026-01-30", 4))
        assertEquals(Recurrence.Next("2026-02-15", monthly()), Recurrence.advance(monthly(), "2026-01-15", "2026-01-15"))
    }

    @Test
    fun `a month day later in the same month comes first`() {
        assertEquals("2026-01-31", Recurrence.advance(monthly(monthDay = -1), "2026-01-10", "2026-01-10")!!.dueDate)
    }

    @Test
    fun `monthDayIn and nthWeekdayIn`() {
        assertEquals(day("2026-02-28"), Recurrence.monthDayIn(day("2026-02-01"), 30))
        assertEquals(day("2026-04-30"), Recurrence.monthDayIn(day("2026-04-01"), -1))
        assertEquals(day("2026-10-13"), Recurrence.nthWeekdayIn(day("2026-10-01"), 2, 2))
        assertEquals(day("2026-10-30"), Recurrence.nthWeekdayIn(day("2026-10-01"), -1, 5))
        assertNull(Recurrence.nthWeekdayIn(day("2026-02-01"), 5, 1))
        assertEquals(day("2026-03-30"), Recurrence.nthWeekdayIn(day("2026-03-01"), 5, 1))
    }

    @Test
    fun `leap years`() {
        assertEquals(listOf("2028-01-29", "2028-02-29", "2028-03-29"), list(monthly(monthDay = 29), "2028-01-29", 3))
        assertEquals(listOf("2027-01-29", "2027-02-28", "2027-03-29"), list(monthly(monthDay = 29), "2027-01-29", 3))
        assertEquals(listOf("2028-01-31", "2028-02-29"), list(monthly(monthDay = -1), "2028-01-31", 2))
        assertEquals(listOf("2029-01-31", "2029-02-28"), list(monthly(monthDay = -1), "2029-01-31", 2))
        assertEquals("2029-02-28", Recurrence.advance(RepeatRule(RepeatEvery.YEAR), "2028-02-29", "2028-02-29")!!.dueDate)
        assertEquals("2032-02-29", Recurrence.advance(RepeatRule(RepeatEvery.YEAR, 4), "2028-02-29", "2028-02-29")!!.dueDate)
        assertEquals(listOf("2028-02-28", "2028-02-29", "2028-03-01"), list(daily(), "2028-02-28", 3))
    }

    @Test
    fun `nth weekday of the month`() {
        val secondTuesday = monthly(nth = WeekdayOfMonth(2, 2))
        assertEquals(listOf("2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12"), list(secondTuesday, "2026-10-13", 4))
        val lastFriday = monthly(nth = WeekdayOfMonth(-1, 5), interval = 2)
        assertEquals(listOf("2026-10-30", "2026-12-25", "2027-02-26", "2027-04-30"), list(lastFriday, "2026-10-30", 4))
        val fifthMonday = monthly(nth = WeekdayOfMonth(5, 1))
        assertEquals("2026-03-30", Recurrence.advance(fifthMonday, "2026-01-01", "2026-01-01")!!.dueDate)
        assertEquals("2026-06-29", Recurrence.advance(fifthMonday, "2026-03-30", "2026-03-30")!!.dueDate)
        assertEquals("2026-10-13", Recurrence.advance(secondTuesday, "2026-10-01", "2026-10-01")!!.dueDate)
    }

    @Test
    fun `counting from completion`() {
        val every3 = daily(3, from = RepeatFrom.COMPLETION)
        assertEquals("2026-10-25", Recurrence.advance(every3, "2026-10-02", "2026-10-22")!!.dueDate)
        assertEquals("2026-10-23", Recurrence.advance(every3.copy(from = RepeatFrom.DUE), "2026-10-02", "2026-10-22")!!.dueDate)
        assertEquals("2026-10-25", Recurrence.advance(every3, "2026-10-30", "2026-10-22")!!.dueDate)
        val mondays = RepeatRule(RepeatEvery.WEEK, 1, listOf(1), from = RepeatFrom.COMPLETION)
        assertEquals("2026-10-26", Recurrence.advance(mondays, "2026-10-12", "2026-10-21")!!.dueDate)
        assertEquals(
            "2026-03-31",
            Recurrence.advance(monthly(monthDay = -1, from = RepeatFrom.COMPLETION), "2026-02-28", "2026-03-05")!!.dueDate,
        )
    }

    @Test
    fun `count is the occurrences left, and dates skipped by a late completion use it up`() {
        assertEquals(Recurrence.Next("2026-10-21", daily(count = 2)), Recurrence.advance(daily(count = 3), "2026-10-20", "2026-10-20"))
        assertNull(Recurrence.advance(daily(count = 1), "2026-10-20", "2026-10-20"))
        assertNull(Recurrence.advance(daily(count = 3), "2026-10-20", "2026-10-22"))
        assertEquals(Recurrence.Next("2026-10-23", daily(count = 2)), Recurrence.advance(daily(count = 5), "2026-10-20", "2026-10-22"))
    }

    @Test
    fun `until is the last date the series may fall on`() {
        assertEquals("2026-10-21", Recurrence.advance(daily(until = "2026-10-21"), "2026-10-20", "2026-10-20")!!.dueDate)
        assertNull(Recurrence.advance(daily(until = "2026-10-21"), "2026-10-21", "2026-10-21"))
    }

    @Test
    fun `occurrences respect count, until, the range and the limit`() {
        assertEquals(
            listOf("2026-10-22", "2026-10-25", "2026-10-28", "2026-10-31", "2026-11-03"),
            list(daily(3, count = 5), "2026-10-22"),
        )
        val fridays = RepeatRule(RepeatEvery.WEEK, 1, listOf(5), until = "2026-11-13")
        assertEquals(listOf("2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"), list(fridays, "2026-10-23"))
        assertEquals(
            listOf("2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"),
            list(daily(), "2026-10-01", range = "2026-10-30" to "2026-11-02"),
        )
        assertEquals(listOf("2026-10-01", "2026-10-02"), list(daily(), "2026-10-01", 2))
    }

    @Test
    fun `completing at night across London's clock changes counts from the London day`() {
        val london = "Europe/London"
        val rule = daily(from = RepeatFrom.COMPLETION)
        fun doneAt(iso: String) = Recurrence.advance(rule, null, HelmDates.localDate(Instant.parse("$iso:00Z").toEpochMilli(), london))!!.dueDate
        // Autumn: 23:30 UTC on 24 Oct is already 25 Oct in London (BST), on 25 Oct it is still 25 Oct (GMT).
        assertEquals("2026-10-26", doneAt("2026-10-24T23:30"))
        assertEquals("2026-10-26", doneAt("2026-10-25T23:30"))
        // Spring: 23:30 UTC on 28 Mar is 28 Mar (GMT), on 29 Mar it is 30 Mar (BST).
        assertEquals("2026-03-29", doneAt("2026-03-28T23:30"))
        assertEquals("2026-03-31", doneAt("2026-03-29T23:30"))
        // Plain dates do not move across the change.
        val weekly = RepeatRule(RepeatEvery.WEEK)
        assertEquals(listOf("2026-10-18", "2026-10-25", "2026-11-01"), list(weekly, "2026-10-18", 3))
        assertEquals(listOf("2026-03-22", "2026-03-29", "2026-04-05"), list(weekly, "2026-03-22", 3))
    }

    @Test
    fun `listing ahead gives the dates completing on time would create`() {
        val rules = listOf(
            daily() to "2026-01-31",
            daily(3, count = 7) to "2026-01-31",
            RepeatRule(RepeatEvery.WEEK, 2, listOf(1, 4)) to "2026-10-19",
            monthly() to "2026-01-31",
            monthly(monthDay = -1) to "2026-01-31",
            monthly(nth = WeekdayOfMonth(2, 2), until = "2027-06-30") to "2026-10-13",
            RepeatRule(RepeatEvery.YEAR) to "2028-02-29",
        )
        rules.forEach { (rule, start) ->
            assertEquals(rule.toString(), list(rule, start, 30, "2026-01-01" to "2099-12-31"), completeOnTime(rule, start, 30))
        }
    }

    /** Expected dates from python-dateutil 2.9's rrule, the same as in the backend's tests. */
    @Test
    fun `same dates as an RFC 5545 implementation`() {
        val cases = listOf(
            Triple(monthly(nth = WeekdayOfMonth(2, 2)), "2026-10-13", "2026-10-13 2026-11-10 2026-12-08 2027-01-12 2027-02-09 2027-03-09 2027-04-13 2027-05-11"),
            Triple(monthly(nth = WeekdayOfMonth(-1, 5)), "2026-10-30", "2026-10-30 2026-11-27 2026-12-25 2027-01-29 2027-02-26 2027-03-26 2027-04-30 2027-05-28"),
            Triple(monthly(monthDay = -1), "2026-01-31", "2026-01-31 2026-02-28 2026-03-31 2026-04-30 2026-05-31 2026-06-30 2026-07-31 2026-08-31"),
            // BYMONTHDAY=28,29;BYSETPOS=-1: the 29th, or the last day of a shorter February.
            Triple(monthly(monthDay = 29), "2027-12-29", "2027-12-29 2028-01-29 2028-02-29 2028-03-29 2028-04-29 2028-05-29 2028-06-29 2028-07-29"),
            Triple(RepeatRule(RepeatEvery.WEEK, 2, listOf(1, 4)), "2026-10-19", "2026-10-19 2026-10-22 2026-11-02 2026-11-05 2026-11-16 2026-11-19 2026-11-30 2026-12-03"),
            Triple(daily(3, count = 5), "2026-10-22", "2026-10-22 2026-10-25 2026-10-28 2026-10-31 2026-11-03"),
            Triple(RepeatRule(RepeatEvery.WEEK, 1, listOf(5), until = "2026-12-04"), "2026-10-23", "2026-10-23 2026-10-30 2026-11-06 2026-11-13 2026-11-20 2026-11-27 2026-12-04"),
            Triple(monthly(nth = WeekdayOfMonth(-1, 5), interval = 2), "2026-10-30", "2026-10-30 2026-12-25 2027-02-26 2027-04-30 2027-06-25 2027-08-27 2027-10-29 2027-12-31"),
        )
        cases.forEach { (rule, start, dates) ->
            val expected = dates.split(" ")
            assertEquals(rule.toString(), expected, list(rule, start, expected.size, start to "2030-12-31"))
        }
    }
}
