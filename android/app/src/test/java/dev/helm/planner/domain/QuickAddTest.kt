package dev.helm.planner.domain

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same cases as macOS `QuickAddTests` and Linux `tst_dates`: Thursday 22 October 2026, 10:00 in London. */
class QuickAddTest {
    private val thu = Instant.parse("2026-10-22T09:00:00Z").toEpochMilli()

    private fun parse(line: String, timezone: String = "Europe/London", now: Long = thu) = QuickAdd.parse(line, now, timezone)

    @Test
    fun `a phrase at the end is the day and time`() {
        assertEquals(QuickAddInput("Call the accountant", When("2026-10-23", "14:00"), "fri 2pm"), parse("Call the accountant fri 2pm"))
    }

    @Test
    fun `the longest whole phrase wins`() {
        assertEquals(When("2026-10-23", "09:00"), parse("Buy milk tomorrow at 9am").`when`)
        assertEquals("Buy milk", parse("Buy milk tomorrow at 9am").title)
        assertEquals("Plan", parse("Plan next week").title)
        assertEquals("2026-10-26", parse("Plan next week").`when`?.date)
        assertEquals("Release v2", parse("Release v2 on oct 23").title)
        assertEquals("2026-11-01", parse("Pay rent the 1st").`when`?.date)
        assertEquals(QuickAddInput("Report", When("2027-10-23", "09:00"), "the 23rd of october 2027 9am"), parse("Report the 23rd of october 2027 9am"))
    }

    @Test
    fun `a long time-first phrase is read in full`() {
        for (phrase in listOf("9 am on the 23rd of october 2027", "at 9 am on the 23rd of october 2027")) {
            assertEquals(QuickAddInput("Call", When("2027-10-23", "09:00"), phrase), parse("Call $phrase"))
        }
        val phrase = "at 9 am on end of the work week"
        assertEquals(QuickAddInput("Call", When("2026-10-23", "09:00"), phrase), parse("Call $phrase"))
    }

    @Test
    fun `a long date-first phrase is read in full`() {
        for (phrase in listOf("the 23rd of october 2027 at 9 am", "on the 23rd of october 2027 at 9 am")) {
            assertEquals(QuickAddInput("Call", When("2027-10-23", "09:00"), phrase), parse("Call $phrase"))
        }
        val phrase = "on end of the work week at 9 am"
        assertEquals(QuickAddInput("Call", When("2026-10-23", "09:00"), phrase), parse("Call $phrase"))
    }

    @Test
    fun `a time alone moves to tomorrow when read after that time`() {
        val before = Instant.parse("2026-10-22T12:59:00Z").toEpochMilli()
        val after = Instant.parse("2026-10-22T13:01:00Z").toEpochMilli()
        assertEquals(QuickAddInput("Call", When("2026-10-22", "14:00"), "2pm"), parse("Call 2pm", now = before))
        assertEquals(QuickAddInput("Call", When("2026-10-23", "14:00"), "2pm"), parse("Call 2pm", now = after))
    }

    @Test
    fun `relative phrases use the moment they are read at`() {
        val later = thu + 60_000L
        assertEquals(QuickAddInput("Call", When("2026-10-22", "11:00"), "in an hour"), parse("Call in an hour"))
        assertEquals(QuickAddInput("Call", When("2026-10-22", "11:01"), "in an hour"), parse("Call in an hour", now = later))
        val midnight = Instant.parse("2026-10-22T23:00:00Z").toEpochMilli()
        assertEquals(QuickAddInput("Call", When("2026-10-23"), "tomorrow"), parse("Call tomorrow"))
        assertEquals(QuickAddInput("Call", When("2026-10-24"), "tomorrow"), parse("Call tomorrow", now = midnight))
    }

    @Test
    fun `without a phrase the line is the title`() {
        assertEquals(QuickAddInput("Buy 2 apples", null, null), parse("Buy 2 apples"))
        assertNull(parse("Read chapter 9").`when`)
        assertEquals("Water the plants", parse("  Water the plants  ").title)
        assertEquals(QuickAddInput("", null, null), parse("   "))
    }

    @Test
    fun `a line that is only a date stays a title`() {
        assertEquals(QuickAddInput("tomorrow", null, null), parse("tomorrow"))
    }

    @Test
    fun `a day the calendar lacks is not read`() {
        assertEquals(QuickAddInput("Pay 31 feb", null, null), parse("Pay 31 feb"))
    }

    @Test
    fun `the phrase keeps the words as typed and the title keeps its case`() {
        assertEquals(QuickAddInput("Send the BIG report", When("2026-10-23"), "Friday"), parse("Send the BIG report Friday"))
    }

    @Test
    fun `the day is read in the given zone`() {
        // 09:00 UTC is 18:00 in Tokyo: "5pm" has passed there, so it is tomorrow; in London it is still today.
        assertEquals(When("2026-10-23", "17:00"), parse("Call 5pm", "Asia/Tokyo").`when`)
        assertEquals(When("2026-10-22", "17:00"), parse("Call 5pm").`when`)
    }
}
