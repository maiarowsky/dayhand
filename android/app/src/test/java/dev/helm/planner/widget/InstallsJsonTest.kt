package dev.helm.planner.widget

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class InstallsJsonTest {
    private val sample = """
        {
          "schema": 1,
          "generatedAt": "2026-11-17T06:30:00Z",
          "apps": [
            {"name": "Alpha",
             "ios": {"day": "2026-11-16", "value": 12, "last7": 80, "total": 1520},
             "android": {"day": "2026-11-15", "value": 0, "last7": 31, "total": 0}},
            {"name": "Beta",
             "ios": {"day": null, "value": null, "last7": null, "total": null, "note": "Apple has not published the report yet"},
             "android": {"day": "2026-11-15", "value": 3, "last7": 9}}
          ],
          "futureField": true
        }
    """.trimIndent()

    @Test
    fun readsTotalsDayCountsAndWhyOneIsMissing() {
        val report = InstallsJson.parse(sample)

        assertEquals(listOf("Alpha", "Beta"), report.apps.map { it.name })
        val alpha = report.apps[0]
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 1520), alpha.total(Platform.IOS))
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 12), alpha.dayCount(Platform.IOS))
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 15), 0), alpha.total(Platform.ANDROID))
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 15), 0), alpha.dayCount(Platform.ANDROID))
        val beta = report.apps[1]
        assertEquals(PlatformCount.Missing(MissingReason.NO_DATA), beta.total(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NO_DATA), beta.dayCount(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NO_FIELD), beta.total(Platform.ANDROID))
        assertEquals("a day count without a total", PlatformCount.Known(LocalDate.of(2026, 11, 15), 3), beta.dayCount(Platform.ANDROID))
    }

    @Test
    fun aDayCountDoesNotNeedAValidTotal() {
        listOf("", "\"total\": null, ", "\"total\": \"12\", ", "\"total\": -1, ").forEach { total ->
            val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": {$total"day": "2026-11-16", "value": 12}}"""))

            assertEquals(total, PlatformCount.Known(LocalDate.of(2026, 11, 16), 12), report.apps[0].dayCount(Platform.IOS))
        }
        val noDay = InstallsJson.parse(file("""{"name": "Alpha", "ios": {"value": 12}}"""))
        assertEquals(PlatformCount.Missing(MissingReason.INVALID), noDay.apps[0].dayCount(Platform.IOS))
    }

    @Test
    fun aStoreLeftOutIsMissingNotZero() {
        val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": {"day": "2026-11-16", "total": 3}}"""))

        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 3), report.apps[0].total(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NO_FIELD), report.apps[0].dayCount(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NOT_IN_FILE), report.apps[0].total(Platform.ANDROID))
        assertEquals(PlatformCount.Missing(MissingReason.NOT_IN_FILE), report.apps[0].dayCount(Platform.ANDROID))
    }

    @Test
    fun aBrokenEntryMarksOnlyThatCount() {
        val broken = listOf(
            """{"day": "2026-11-16", "total": -1}""",
            """{"day": "2026-11-16", "total": "12"}""",
            """{"day": "2026-11-16", "total": 1.5}""",
            """{"total": 12}""",
            """{"day": "16.11.2026", "total": 12}""",
            "12",
        )
        broken.forEach { entry ->
            val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": $entry, "android": {"day": "2026-11-15", "total": 4}}"""))
            assertEquals(entry, PlatformCount.Missing(MissingReason.INVALID), report.apps[0].total(Platform.IOS))
            assertEquals(entry, PlatformCount.Known(LocalDate.of(2026, 11, 15), 4), report.apps[0].total(Platform.ANDROID))
        }
    }

    @Test
    fun aBrokenDayValueLeavesTheTotal() {
        val values = listOf(
            "\"broken\"" to MissingReason.INVALID,
            "-3" to MissingReason.INVALID,
            "1.5" to MissingReason.INVALID,
            "null" to MissingReason.NO_DATA,
        )
        values.forEach { (value, reason) ->
            val app = """{"name": "Alpha", "ios": {"day": "2026-11-16", "value": $value, "last7": -3, "total": 7}}"""
            val report = InstallsJson.parse(file(app))

            assertEquals(value, PlatformCount.Known(LocalDate.of(2026, 11, 16), 7), report.apps[0].total(Platform.IOS))
            assertEquals(value, PlatformCount.Missing(reason), report.apps[0].dayCount(Platform.IOS))
        }
    }

    @Test
    fun generatedAtIsOptional() {
        val app = """{"name": "Alpha", "ios": {"day": "2026-11-16", "total": 3}}"""
        listOf("""{"schema": 1, "apps": [$app]}""", """{"schema": 1, "generatedAt": "yesterday", "apps": [$app]}""").forEach { text ->
            assertEquals(text, listOf("Alpha"), InstallsJson.parse(text).apps.map { it.name })
        }
    }

    @Test
    fun aBrokenFileIsRefused() {
        val files = listOf(
            "",
            "not json",
            "{\"schema\": 1, \"generatedAt\": \"2026-11-17T06:30:00Z\", \"apps\": [",
            "[]",
            """{"generatedAt": "2026-11-17T06:30:00Z", "apps": []}""",
            """{"schema": 2, "generatedAt": "2026-11-17T06:30:00Z", "apps": []}""",
            """{"schema": "1", "generatedAt": "2026-11-17T06:30:00Z", "apps": []}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z"}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"ios": {"total": null}}]}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"name": "  "}]}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": ["Alpha"]}""",
        )
        files.forEach { text -> assertThrows(text, InvalidInstallsFile::class.java) { InstallsJson.parse(text) } }
    }

    private fun file(vararg apps: String) =
        """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [${apps.joinToString(",")}]}"""
}
