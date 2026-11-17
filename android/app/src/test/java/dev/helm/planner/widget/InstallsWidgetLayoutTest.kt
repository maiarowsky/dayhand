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
        val android = if (n == 6) """{"value": null, "note": "no report for six"}""" else """{"day": "2026-11-16", "value": $n, "last7": ${n * 7}}"""
        """{"name": "App$n", "ios": {"day": "2026-11-16", "value": $n, "last7": ${n * 7}}, "android": $android}"""
    }

    @Test
    fun aFailedRefreshOfSixAppsShowsEveryAppTheReasonAndTheFailure() = runTest {
        val view = WidgetData(url).after(FetchResult.Body(sixApps), now = 1_000)
            .after(FetchResult.Failed(FetchFailure.Network), now = 2_000).view()

        val texts = render(view)

        (1..6).forEach { assertTrue("App$it in $texts", "App$it" in texts) }
        assertTrue("reason in $texts", texts.any { it.contains("App6 Android: no report for six") })
        assertTrue("failure in $texts", "No connection" in texts)
        assertTrue("fetched in $texts", texts.any { it.startsWith("Fetched") || it.startsWith("fetched") })
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
