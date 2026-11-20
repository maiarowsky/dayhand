package dev.helm.planner.widget

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InstallsStateTest {
    private val url = "https://mac.tail0000.ts.net/installs.json"
    private val good = """
        {"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [
          {"name": "Alpha", "ios": {"day": "2026-11-16", "value": 9, "total": 1200}, "android": {"day": "2026-11-15", "value": 4, "total": 340}},
          {"name": "Beta", "ios": {"day": "2026-11-16", "value": 0, "total": 0}, "android": {"day": "2026-11-14", "value": 2, "total": 25}}
        ]}
    """.trimIndent()

    @Test
    fun aFailedRefreshKeepsTheLastFile() {
        val loaded = WidgetData(url).after(FetchResult.Body(good), now = 1_000)

        val offline = loaded.after(FetchResult.Failed(FetchFailure.Network), now = 2_000)
        val broken = loaded.after(FetchResult.Body("{oops"), now = 3_000)

        listOf(offline to FetchFailure.Network, broken to FetchFailure.InvalidFile).forEach { (data, failure) ->
            assertEquals(1_000L, data.fetchedAt)
            val view = data.view() as WidgetView.Showing
            assertEquals(failure, view.failure)
            assertEquals(1540, view.table.rows.first().total)
        }
    }

    @Test
    fun aGoodRefreshClearsTheFailure() {
        val data = WidgetData(url, failure = FetchFailure.Http(404)).after(FetchResult.Body(good), now = 5_000)

        val view = data.view() as WidgetView.Showing
        assertNull(view.failure)
        assertEquals(5_000L, data.fetchedAt)
    }

    @Test
    fun withoutAFileTheWidgetSaysWhy() {
        assertEquals(WidgetView.NotSet, WidgetData().view())
        assertEquals(WidgetView.Loading, WidgetData(url).view())
        assertEquals(WidgetView.Failed(FetchFailure.Http(500)), WidgetData(url).after(FetchResult.Failed(FetchFailure.Http(500)), 1).view())
    }

    @Test
    fun everyCountKnownAddsUpEachRow() {
        val table = InstallsTable.of(InstallsJson.parse(good))

        assertEquals(
            listOf(
                TableRow("Alpha", 1540, 13),
                TableRow("Beta", 25, 2),
            ),
            table.rows,
        )
        assertEquals(
            mapOf(
                Platform.IOS to PublishedDays(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 16)),
                Platform.ANDROID to PublishedDays(LocalDate.of(2026, 11, 14), LocalDate.of(2026, 11, 15)),
            ),
            table.days,
        )
        assertEquals(emptyList<Platform>(), table.storesWithoutData)
        assertFalse(table.noTotalInFile)
        assertFalse(table.noDayCountInFile)
    }

    @Test
    fun aMissingCountBlanksItsRowSumNeverAPartialSum() {
        val table = table(
            """{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 5, "total": 1200}, "android": {"day": "2026-11-15", "value": null, "total": null, "note": "HTTP 403"}}""",
            """{"name": "Beta", "ios": {"day": "2026-11-16", "value": 1, "total": 7}, "android": {"day": "2026-11-15", "value": 3, "total": 25}}""",
            """{"name": "Gamma", "ios": {"day": "2026-11-16", "total": 70}, "android": {"day": "2026-11-15", "value": 3, "total": 25}}""",
        )

        assertEquals(TableRow("Alpha", null, null), table.rows[0])
        assertEquals(TableRow("Beta", 32, 4), table.rows[1])
        assertEquals("a store without the day's value", TableRow("Gamma", 95, null), table.rows[2])
        assertEquals(listOf(Platform.ANDROID), table.storesWithoutData)
        assertFalse(table.noTotalInFile)
        assertTrue("Gamma's iOS entry has no value", table.noDayCountInFile)
    }

    @Test
    fun anOldFileWithoutTotalsShowsTheLastDayAndSaysTheTotalIsMissing() {
        val table = table("""{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 12, "last7": 80}, "android": {"day": "2026-11-15", "value": 3}}""")

        assertEquals(TableRow("Alpha", null, 15), table.rows.single())
        assertEquals(
            mapOf(
                Platform.IOS to PublishedDays(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 16)),
                Platform.ANDROID to PublishedDays(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 11, 15)),
            ),
            table.days,
        )
        assertEquals(emptyList<Platform>(), table.storesWithoutData)
        assertTrue(table.noTotalInFile)
        assertFalse(table.noDayCountInFile)
    }

    @Test
    fun totalsWithoutValuesShowTheTotalAndSayTheDayCountIsMissing() {
        val table = table("""{"name": "Alpha", "ios": {"day": "2026-11-16", "total": 40}, "android": {"day": "2026-11-15", "total": 9}}""")

        assertEquals(TableRow("Alpha", 49, null), table.rows.single())
        assertEquals(emptyList<Platform>(), table.storesWithoutData)
        assertFalse(table.noTotalInFile)
        assertTrue(table.noDayCountInFile)
    }

    @Test
    fun theDaysComeOnlyFromNumbersTheTableShows() {
        val table = table(
            """{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 4, "total": 40}, "android": {"day": "2026-11-15", "value": 1, "total": 9}}""",
            """{"name": "Beta", "android": {"day": "2026-11-12", "value": 1, "total": 50}}""",
        )

        assertEquals(TableRow("Beta", null, null), table.rows[1])
        assertEquals(
            mapOf(
                Platform.IOS to PublishedDays(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 16)),
                Platform.ANDROID to PublishedDays(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 11, 15)),
            ),
            table.days,
        )
    }

    @Test
    fun nothingKnownIsNoSumNotZero() {
        val table = table("""{"name": "Alpha", "ios": {"total": null}}""")

        assertNull(table.rows.single().total)
        assertNull(table.rows.single().lastDay)
        assertEquals(emptyMap<Platform, PublishedDays>(), table.days)
        assertEquals(listOf(Platform.IOS, Platform.ANDROID), table.storesWithoutData)
    }

    private fun table(vararg apps: String) =
        InstallsTable.of(InstallsJson.parse("""{"schema": 1, "apps": [${apps.joinToString(",")}]}"""))

    @Test
    fun addressesNeedHttpsOrAnOpenedHost() {
        val emulatorHostOnly: (String) -> Boolean = { it == "10.0.2.2" }

        assertEquals(UrlCheck.Valid(url), checkInstallsUrl("  $url ", emulatorHostOnly))
        assertEquals(UrlCheck.Valid("http://10.0.2.2:8765/i.json"), checkInstallsUrl("http://10.0.2.2:8765/i.json", emulatorHostOnly))
        assertEquals(UrlCheck.CleartextRefused, checkInstallsUrl("http://100.101.102.103:8080/i.json", emulatorHostOnly))
        listOf("", "example.org/i.json", "ftp://example.org/i.json", "https://", "http://exa mple.org").forEach {
            assertEquals(it, UrlCheck.NotHttp, checkInstallsUrl(it, emulatorHostOnly))
        }
    }
}
