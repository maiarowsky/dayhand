package dev.helm.planner.widget

import android.content.Context
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import dev.helm.planner.R
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Store installs on the home screen: a table with a row per app of its all-time iOS, Android and combined installs and its
 * installs on the latest published day. A narrow widget leaves out the iOS and Android columns so the app names keep
 * their room. A tap fetches the file again; before an address is set it opens the setup screen.
 */
class InstallsWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(setOf(NARROW, WIDE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = InstallsStore(context)
        val initial = store.current()
        provideContent {
            val data by store.data.collectAsState(initial)
            GlanceTheme { InstallsContent(data.view()) }
        }
    }
}

class InstallsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = InstallsWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        InstallsScheduler.start(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        InstallsScheduler.stop(context)
    }
}

class RefreshInstalls : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        InstallsScheduler.refreshNow(context)
    }
}

private const val MAX_APPS = 6
private val CELL_WIDTH = 56.dp
private val NARROW = DpSize(250.dp, 200.dp)
private val WIDE = DpSize(312.dp, 200.dp)

@Composable
internal fun InstallsContent(view: WidgetView) {
    val context = LocalContext.current
    val tap = if (view is WidgetView.NotSet) actionStartActivity<InstallsConfigActivity>() else actionRunCallback<RefreshInstalls>()
    Column(
        GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).cornerRadius(16.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp).clickable(tap),
    ) {
        when (view) {
            WidgetView.NotSet -> Message(context.getString(R.string.installs_tap_to_set))
            WidgetView.Loading -> Message(context.getString(R.string.installs_loading))
            is WidgetView.Failed -> Message(failureText(context, view.failure), context.getString(R.string.installs_tap_to_retry))
            is WidgetView.Showing -> Report(view)
        }
    }
}

@Composable
private fun Message(text: String, detail: String? = null) {
    val context = LocalContext.current
    Text(context.getString(R.string.installs_title), style = small(GlanceTheme.colors.onSurfaceVariant))
    Spacer(GlanceModifier.height(4.dp))
    Text(text, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp))
    detail?.let { Text(it, style = small(GlanceTheme.colors.onSurfaceVariant)) }
}

@Composable
private fun Report(view: WidgetView.Showing) {
    val context = LocalContext.current
    val locale = context.resources.configuration.locales[0]
    val numbers = NumberFormat.getIntegerInstance(locale)
    val table = view.table
    val muted = GlanceTheme.colors.onSurfaceVariant
    val strong = GlanceTheme.colors.onSurface
    // Glance keeps at most 10 children per Column and silently drops the rest, so each block is its own Column.
    Column(GlanceModifier.fillMaxWidth()) {
        Text(context.getString(R.string.installs_title), style = TextStyle(color = strong, fontSize = 14.sp, fontWeight = FontWeight.Bold))
        asOf(context, table, locale)?.let { Text(it, style = small(muted)) }
        Spacer(GlanceModifier.height(6.dp))
    }
    val stores = if (LocalSize.current.width >= WIDE.width) Platform.entries else emptyList()
    Column(GlanceModifier.fillMaxWidth()) {
        TableLine(
            context.getString(R.string.installs_column_app),
            stores.map { platformName(context, it) } +
                context.getString(R.string.installs_column_total) + context.getString(R.string.installs_column_last_day),
            small(muted),
            cellLines = 2,
        )
        table.rows.take(MAX_APPS).forEach { row ->
            val cells = stores.map { row.counts[it] } + row.total + row.lastDay
            TableLine(row.name, cells.map { number(it, numbers) }, cell(strong))
        }
    }
    Column(GlanceModifier.fillMaxWidth()) {
        footnote(context, table)?.let {
            Spacer(GlanceModifier.height(4.dp))
            Text(it, style = small(muted))
        }
        view.failure?.let { Text(failureText(context, it), style = small(GlanceTheme.colors.error)) }
    }
}

@Composable
private fun TableLine(name: String, cells: List<String>, style: TextStyle, cellLines: Int = 1) {
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 1.dp)) {
        Text(name, style = style, maxLines = 1, modifier = GlanceModifier.defaultWeight())
        cells.forEach {
            Text(it, style = style.copy(textAlign = TextAlign.End), maxLines = cellLines, modifier = GlanceModifier.width(CELL_WIDTH))
        }
    }
}

private const val DASH = "—"

private fun number(value: Int?, numbers: NumberFormat): String = value?.let(numbers::format) ?: DASH

private fun small(color: ColorProvider) = TextStyle(color = color, fontSize = 12.sp)

private fun cell(color: ColorProvider) = TextStyle(color = color, fontSize = 14.sp)

private fun dayFormatter(locale: Locale): DateTimeFormatter =
    DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "dM"), locale)

/** "as of" the published day of every number shown, or each store's days when the stores published different days. */
private fun asOf(context: Context, table: InstallsTable, locale: Locale): String? {
    if (table.days.isEmpty()) return null
    val formatter = dayFormatter(locale)
    fun text(days: PublishedDays): String = listOf(days.oldest, days.newest).distinct().joinToString("–") { formatter.format(it) }
    val dates = table.days.values.distinct().singleOrNull()?.let(::text)
        ?: table.days.entries.joinToString(" · ") { (platform, days) -> "${platformName(context, platform)} ${text(days)}" }
    return context.getString(R.string.installs_as_of, dates)
}

/** One short line on why a number is missing: the stores without data, or a file that has no totals. */
private fun footnote(context: Context, table: InstallsTable): String? {
    val stores = when (table.storesWithoutData.toSet()) {
        emptySet<Platform>() -> null
        setOf(Platform.IOS) -> R.string.installs_no_data_ios
        setOf(Platform.ANDROID) -> R.string.installs_no_data_android
        else -> R.string.installs_no_data_both
    }
    val parts = listOfNotNull(stores, R.string.installs_no_total.takeIf { table.noTotalInFile })
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ") { context.getString(it) }
}

private fun platformName(context: Context, platform: Platform): String = context.getString(
    when (platform) {
        Platform.IOS -> R.string.installs_ios
        Platform.ANDROID -> R.string.installs_android
    },
)

private fun failureText(context: Context, failure: FetchFailure): String = when (failure) {
    FetchFailure.Network -> context.getString(R.string.installs_failure_network)
    is FetchFailure.Http -> context.getString(R.string.installs_failure_http, failure.status)
    FetchFailure.InvalidFile -> context.getString(R.string.installs_failure_file)
}
