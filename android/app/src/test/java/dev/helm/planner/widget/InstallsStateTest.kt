package dev.helm.planner.widget

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InstallsStateTest {
    private val url = "https://mac.tail0000.ts.net/installs.json"
    private val good = """
        {"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [
          {"name": "Alpha", "ios": {"day": "2026-11-16", "value": 12, "last7": 80}, "android": {"day": "2026-11-15", "value": 5, "last7": 31}},
          {"name": "Beta", "ios": {"day": "2026-11-16", "value": 0, "last7": 4}, "android": {"value": null, "note": "no Play report"}},
          {"name": "Gamma", "ios": {"value": null, "note": "no Play report"}, "android": {"value": null, "note": "no Play report"}}
        ]}
    """.trimIndent()

    @Test
    fun aFailedRefreshKeepsTheLastFileAndItsTime() {
        val loaded = WidgetData(url).after(FetchResult.Body(good), now = 1_000)

        val offline = loaded.after(FetchResult.Failed(FetchFailure.Network), now = 2_000)
        val broken = loaded.after(FetchResult.Body("{oops"), now = 3_000)

        listOf(offline to FetchFailure.Network, broken to FetchFailure.InvalidFile).forEach { (data, failure) ->
            val view = data.view() as WidgetView.Showing
            assertEquals(1_000L, view.fetchedAt)
            assertEquals(failure, view.failure)
            assertEquals(17, view.summary.dayTotal)
        }
    }

    @Test
    fun aGoodRefreshClearsTheFailure() {
        val data = WidgetData(url, failure = FetchFailure.Http(404)).after(FetchResult.Body(good), now = 5_000)

        val view = data.view() as WidgetView.Showing
        assertNull(view.failure)
        assertEquals(5_000L, view.fetchedAt)
    }

    @Test
    fun withoutAFileTheWidgetSaysWhy() {
        assertEquals(WidgetView.NotSet, WidgetData().view())
        assertEquals(WidgetView.Loading, WidgetData(url).view())
        assertEquals(WidgetView.Failed(FetchFailure.Http(500)), WidgetData(url).after(FetchResult.Failed(FetchFailure.Http(500)), 1).view())
    }

    @Test
    fun totalsCountOnlyKnownNumbers() {
        val summary = InstallsSummary.of(InstallsJson.parse(good))

        assertEquals(17, summary.dayTotal)
        assertEquals(115, summary.weekTotal)
        assertEquals(
            mapOf(
                Platform.IOS to DayRange(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 16)),
                Platform.ANDROID to DayRange(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 11, 15)),
            ),
            summary.days,
        )
        assertNull(summary.commonDay)
        assertEquals(
            listOf(Platform.ANDROID to MissingReason.Stated("no Play report"), Platform.IOS to MissingReason.Stated("no Play report")),
            summary.missing,
        )
    }

    @Test
    fun nothingKnownIsNoTotalNotZero() {
        val report = InstallsJson.parse(
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"name": "Alpha", "ios": {"value": null}, "android": {"value": null}}]}""",
        )

        val summary = InstallsSummary.of(report)
        assertNull(summary.dayTotal)
        assertNull(summary.weekTotal)
        assertTrue(summary.days.isEmpty())
    }

    @Test
    fun aMissingWeekLeavesTheWeekTotalOpen() {
        val report = InstallsJson.parse(
            """{"schema": 1, "generatedAt": "2026-11-17T06:30:00Z", "apps": [{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 2, "last7": 9}, "android": {"day": "2026-11-16", "value": 1}}]}""",
        )

        val summary = InstallsSummary.of(report)
        assertEquals(3, summary.dayTotal)
        assertNull(summary.weekTotal)
        assertEquals(LocalDate.of(2026, 11, 16), summary.commonDay)
    }

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
