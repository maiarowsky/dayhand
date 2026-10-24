package dev.helm.planner.domain

import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Every case of `linux/tests/cases/when.json`, the phrases shared with `dayhand` (`cli/tests/when.unit.test.ts`),
 * macOS (`WhenTests.swift`) and Linux (`tst_dates.cpp`), so all of them read a phrase the same way.
 */
class WhenParserTest {
    private val cases: JsonObject = listOf(File("../../linux/tests/cases/when.json"), File("../linux/tests/cases/when.json"))
        .first { it.isFile }
        .let { Json.parseToJsonElement(it.readText()).jsonObject }
    private val timezone = cases.getValue("timezone").jsonPrimitive.content

    private fun utc(isoMinute: String) = Instant.parse("$isoMinute:00Z").toEpochMilli()

    private fun expected(value: String): When {
        val parts = value.split(" ")
        return When(parts[0], parts.getOrNull(1), parts.getOrNull(2))
    }

    @Test
    fun `every shared phrase means the same day and time`() {
        var checked = 0
        for (group in cases.getValue("groups").jsonArray.map { it.jsonObject }) {
            val name = group.getValue("name").jsonPrimitive.content
            val now = utc(group.getValue("now").jsonPrimitive.content)
            for (case in group.getValue("cases").jsonArray.map { it.jsonArray }) {
                val phrase = case[0].jsonPrimitive.content
                val actual = try {
                    WhenParser.parse(phrase, now, timezone)
                } catch (e: WhenException) {
                    fail("$name: \"$phrase\" was not understood: ${e.message}")
                    return
                }
                assertEquals("$name: \"$phrase\"", expected(case[1].jsonPrimitive.content), actual)
                checked++
            }
        }
        assertTrue("the shared file has cases", checked > 100)
    }

    @Test
    fun `phrases outside the grammar are not understood`() {
        val rejected = cases.getValue("rejected").jsonObject
        val now = utc(rejected.getValue("now").jsonPrimitive.content)
        val phrases = rejected.getValue("phrases").jsonArray.map { it.jsonPrimitive.content }
        assertTrue(phrases.isNotEmpty())
        for (phrase in phrases) {
            try {
                val read = WhenParser.parse(phrase, now, timezone)
                fail("\"$phrase\" should not be a date, got $read")
            } catch (_: WhenException) {
                // expected
            }
        }
    }

    @Test
    fun `the day follows the zone it is read in`() {
        // 23:30 UTC on Thursday 22 October is already Friday in Warsaw, still Thursday in New York.
        val now = utc("2026-10-22T23:30")
        assertEquals(When("2026-10-24"), WhenParser.parse("tomorrow", now, "Europe/Warsaw"))
        assertEquals(When("2026-10-23"), WhenParser.parse("tomorrow", now, "America/New_York"))
    }

    @Test
    fun `an unknown zone falls back to the backend default`() {
        val now = utc("2026-10-22T23:30")
        assertEquals(WhenParser.parse("tomorrow 9am", now, HelmDates.DEFAULT_TIMEZONE), WhenParser.parse("tomorrow 9am", now, "Mars/Base"))
    }
}
