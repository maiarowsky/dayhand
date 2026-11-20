package dev.helm.planner.widget

import android.app.Application
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.compose
import androidx.glance.appwidget.provideContent
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Every line of a full widget reaches the home screen (Glance drops a container's children past its limit). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en")
class InstallsWidgetLayoutTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val url = "https://example.test/installs.json"

    private val sixApps = (1..6).joinToString(prefix = """{"schema": 1, "apps": [""", postfix = "]}") { n ->
        val android = if (n == 6) {
            """{"day": null, "value": null, "total": null, "note": "HTTP 403"}"""
        } else {
            """{"day": "2026-11-15", "value": $n, "total": ${n * 100}}"""
        }
        """{"name": "App$n", "ios": {"day": "2026-11-16", "value": ${n * 10}, "total": ${n * 1000}}, "android": $android}"""
    }

    @Test
    fun aFailedRefreshOfSixAppsShowsTheWholeTableTheReasonAndTheFailure() = runTest {
        val view = WidgetData(url).after(FetchResult.Body(sixApps), now = 1_000)
            .after(FetchResult.Failed(FetchFailure.Network), now = 2_000).view()

        val texts = render(view)

        listOf("Installs", "as of iOS 11/16 · Android 11/15").forEach { assertTrue("$it in $texts", it in texts) }
        assertEquals(listOf("App", "Total", "Last day"), texts.subList(texts.indexOf("App"), texts.indexOf("App") + 3))
        listOf(
            listOf("App1", "1,100", "11"),
            listOf("App2", "2,200", "22"),
            listOf("App5", "5,500", "55"),
        ).forEach { row -> assertEquals(row, texts.subList(texts.indexOf(row[0]), texts.indexOf(row[0]) + 3)) }
        (1..6).forEach { assertTrue("App$it in $texts", "App$it" in texts) }
        assertEquals(listOf("App6", "—", "—"), texts.subList(texts.indexOf("App6"), texts.indexOf("App6") + 3))
        assertEquals("Total header only, no row of sums in $texts", 1, texts.count { it == "Total" })
        assertFalse("no sum over the apps in $texts", "16,500" in texts)
        assertFalse("no store columns in $texts", "iOS" in texts || "Android" in texts || "1,000" in texts || "100" in texts)
        assertTrue("reason in $texts", "Android: no data from Google Play" in texts)
        assertTrue("failure in $texts", "No connection" in texts)
        assertFalse("no generator note in $texts", texts.any { "403" in it })
    }

    @Test
    fun storesWithTheSameDayShowOneDate() = runTest {
        val sameDay = """{"schema": 1, "apps": [{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 4, "total": 40}, "android": {"day": "2026-11-16", "value": 1, "total": 9}}]}"""

        val texts = render(WidgetData(url).after(FetchResult.Body(sameDay), now = 1_000).view())

        assertTrue("one date in $texts", "as of 11/16" in texts)
        assertEquals(listOf("Alpha", "49", "5"), texts.subList(texts.indexOf("Alpha"), texts.indexOf("Alpha") + 3))
    }

    @Test
    fun anOldFileWithoutTotalsShowsTheLastDayAndSaysSo() = runTest {
        val old = """{"schema": 1, "apps": [{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 12, "last7": 80}, "android": {"day": "2026-11-15", "value": 3}}]}"""

        val texts = render(WidgetData(url).after(FetchResult.Body(old), now = 1_000).view())

        assertEquals(listOf("Alpha", "—", "15"), texts.subList(texts.indexOf("Alpha"), texts.indexOf("Alpha") + 3))
        assertTrue("note in $texts", "no total in the file" in texts)
        assertTrue("both days in $texts", "as of iOS 11/16 · Android 11/15" in texts)
        assertFalse("no weekly number in $texts", "80" in texts)
    }

    @Test
    fun aFileMissingTotalsAndDayCountsSaysBoth() = runTest {
        val mixed = """{"schema": 1, "apps": [
            {"name": "Alpha", "ios": {"day": "2026-11-16", "value": 12}, "android": {"day": "2026-11-16", "value": 3}},
            {"name": "Beta", "ios": {"day": "2026-11-16", "total": 40}, "android": {"day": "2026-11-16", "total": 9}}
        ]}"""

        val texts = render(WidgetData(url).after(FetchResult.Body(mixed), now = 1_000).view())

        assertEquals(listOf("Beta", "49", "—"), texts.subList(texts.indexOf("Beta"), texts.indexOf("Beta") + 3))
        assertTrue("both notes in $texts", "no total in the file · no day count in the file" in texts)
    }

    private suspend fun render(view: WidgetView): List<String> {
        val widget = object : GlanceAppWidget() {
            override suspend fun provideGlance(context: Context, id: GlanceId) {
                provideContent { GlanceTheme { InstallsContent(view) } }
            }
        }
        val root = widget.compose(context, size = DpSize(360.dp, 220.dp)).apply(context, FrameLayout(context))
        return texts(root)
    }

    private fun texts(view: View): List<String> = when (view) {
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }
}
