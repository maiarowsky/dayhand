package dev.helm.planner.widget

import android.app.Application
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
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

/** Every line of a full widget reaches the home screen: Glance drops a container's children past its limit. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en")
class InstallsWidgetLayoutTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val url = "https://example.test/installs.json"

    private val sixApps = (1..6).joinToString(prefix = """{"schema": 1, "apps": [""", postfix = "]}") { n ->
        val android = if (n == 6) """{"day": null, "total": null, "note": "HTTP 403"}""" else """{"day": "2026-11-15", "total": ${n * 100}}"""
        """{"name": "App$n", "ios": {"day": "2026-11-16", "total": ${n * 1000}}, "android": $android}"""
    }

    @Test
    fun aFailedRefreshOfSixAppsShowsTheWholeTableTheReasonAndTheFailure() = runTest {
        val view = WidgetData(url).after(FetchResult.Body(sixApps), now = 1_000)
            .after(FetchResult.Failed(FetchFailure.Network), now = 2_000).view()

        val texts = render(view)

        listOf("Installs", "as of 11/15", "App", "iOS", "Android").forEach { assertTrue("$it in $texts", it in texts) }
        (1..6).forEach { assertTrue("App$it in $texts", "App$it" in texts) }
        listOf("1,000", "100", "1,100", "6,000").forEach { assertTrue("$it in $texts", it in texts) }
        assertEquals("Total header only, no row of sums in $texts", 1, texts.count { it == "Total" })
        assertFalse("no sum over the apps in $texts", "21,000" in texts)
        assertEquals("App6 Android and its row sum in $texts", 2, texts.count { it == "—" })
        assertTrue("reason in $texts", "Android: no data from Google Play" in texts)
        assertTrue("failure in $texts", "No connection" in texts)
        assertFalse("no generator note in $texts", texts.any { "403" in it })
    }

    @Test
    fun anOldFileWithoutTotalsSaysSo() = runTest {
        val old = """{"schema": 1, "apps": [{"name": "Alpha", "ios": {"day": "2026-11-16", "value": 12, "last7": 80}, "android": {"day": null, "value": null, "note": "HTTP 403"}}]}"""

        val texts = render(WidgetData(url).after(FetchResult.Body(old), now = 1_000).view())

        assertTrue("note in $texts", "no total in the file" in texts)
        assertFalse("no date in $texts", texts.any { it.startsWith("as of") })
        assertFalse("no daily number in $texts", texts.any { it == "12" || it == "80" })
    }

    private suspend fun render(view: WidgetView): List<String> {
        val widget = object : GlanceAppWidget() {
            override suspend fun provideGlance(context: Context, id: GlanceId) {
                provideContent { GlanceTheme { InstallsContent(view) } }
            }
        }
        val root = widget.compose(context).apply(context, FrameLayout(context))
        return texts(root)
    }

    private fun texts(view: View): List<String> = when (view) {
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }
}
