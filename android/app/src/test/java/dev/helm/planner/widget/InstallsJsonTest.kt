package dev.helm.planner.widget

import java.time.Instant
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
             "ios": {"day": "2026-11-16", "value": 12, "last7": 80},
             "android": {"day": "2026-11-15", "value": 0, "last7": 31}},
            {"name": "Beta",
             "ios": {"day": null, "value": null, "last7": null, "note": "Apple has not published the report yet"},
             "android": {"value": null}}
          ],
          "futureField": true
        }
    """.trimIndent()

    @Test
    fun readsCountsAndReasons() {
        val report = InstallsJson.parse(sample)

        assertEquals(Instant.parse("2026-11-17T06:30:00Z"), report.generatedAt)
        assertEquals(listOf("Alpha", "Beta"), report.apps.map { it.name })
        val alpha = report.apps[0]
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 12, 80), alpha.count(Platform.IOS))
        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 15), 0, 31), alpha.count(Platform.ANDROID))
        val beta = report.apps[1]
        assertEquals(PlatformCount.Missing(MissingReason.Stated("Apple has not published the report yet")), beta.count(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NotGiven), beta.count(Platform.ANDROID))
    }

    @Test
    fun aStoreLeftOutIsMissingNotZero() {
        val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 3}}"""))

        assertEquals(PlatformCount.Known(LocalDate.of(2026, 11, 16), 3, null), report.apps[0].count(Platform.IOS))
        assertEquals(PlatformCount.Missing(MissingReason.NotInFile), report.apps[0].count(Platform.ANDROID))
    }

    @Test
    fun aBrokenEntryMarksOnlyThatCount() {
        val broken = listOf(
            """{"day": "2026-11-16", "value": -1}""",
            """{"day": "2026-11-16", "value": "12"}""",
            """{"day": "2026-11-16", "value": 1.5}""",
            """{"value": 12}""",
            """{"day": "16.11.2026", "value": 12}""",
            """{"day": "2026-11-16", "value": 12, "last7": -3}""",
            "12",
        )
        broken.forEach { entry ->
            val report = InstallsJson.parse(file("""{"name": "Alpha", "ios": $entry, "android": {"day": "2026-11-15", "value": 4}}"""))
            assertEquals(entry, PlatformCount.Missing(MissingReason.Invalid), report.apps[0].count(Platform.IOS))
            assertEquals(entry, PlatformCount.Known(LocalDate.of(2026, 11, 15), 4, null), report.apps[0].count(Platform.ANDROID))
        }
    }

    @Test
    fun offsetsInGeneratedAtAreRead() {
        val report = InstallsJson.parse("""{"schema": 1, "generatedAt": "2026-11-17T07:30:00.250+01:00", "apps": []}""")

        assertEquals(Instant.parse("2026-11-17T06:30:00.250Z"), report.generatedAt)
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
            """{"schema": 1, "apps": []}""",
            """{"schema": 1, "generatedAt": "yesterday", "apps": []}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z"}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"ios": {"value": null}}]}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"name": "  "}]}""",
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": ["Alpha"]}""",
        )
        files.forEach { text -> assertThrows(text, InvalidInstallsFile::class.java) { InstallsJson.parse(text) } }
    }

    private fun file(vararg apps: String) =
        """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [${apps.joinToString(",")}]}"""
}
