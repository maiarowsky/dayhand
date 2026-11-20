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
    fun readsTotalsAndWhyOneIsMissing() {
        val report = InstallsJson.parse(sample)

        assertEquals(listOf("Alpha", "Beta"), report.apps.map { it.name })
        val alpha = report.apps[0]
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 1520, 12), alpha.count(Platform.IOS))
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 15), 0, 0), alpha.count(Platform.ANDROID))
        val beta = report.apps[1]
        assertEquals(PlatformCount.Missing(MissingReason.NO_DATA), beta.count(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NO_TOTAL), beta.count(Platform.ANDROID))
    }

    @Test
    fun aStoreLeftOutIsMissingNotZero() {
        val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": {"day": "2026-11-16", "total": 3}}"""))

        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 3, null), report.apps[0].count(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NOT_IN_FILE), report.apps[0].count(Platform.ANDROID))
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
            assertEquals(entry, PlatformCount.Missing(MissingReason.INVALID), report.apps[0].count(Platform.IOS))
            assertEquals(entry, PlatformCount.Known(LocalDate.of(2026, 11, 15), 4, null), report.apps[0].count(Platform.ANDROID))
        }
    }

    @Test
    fun aBrokenDayValueLeavesTheTotal() {
        listOf("\"broken\"", "-3", "1.5", "null").forEach { value ->
            val app = """{"name": "Alpha", "ios": {"day": "2026-11-16", "value": $value, "last7": -3, "total": 7}}"""
            val report = InstallsJson.parse(file(app))

            assertEquals(value, PlatformCount.Known(LocalDate.of(2026, 11, 16), 7, null), report.apps[0].count(Platform.IOS))
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
