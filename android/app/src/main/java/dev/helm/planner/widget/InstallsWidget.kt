package dev.helm.planner.widget

import android.content.Context
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
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
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

/**
 * Store installs on the home screen: the latest published day's total over both stores, the 7-day total, and a row
 * per app with its iOS and Android counts (day · 7 days). A tap fetches the file again; before an address is set
 * it opens the setup screen.
 */
class InstallsWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Single

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
private const val MAX_REASONS = 2
private val CELL_WIDTH = 64.dp

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
    val days = dayFormatter(locale)
    val summary = view.summary
    val muted = GlanceTheme.colors.onSurfaceVariant
    // Glance keeps at most 10 children per Column and silently drops the rest, so each block is its own Column.
    Column(GlanceModifier.fillMaxWidth()) {
        Text(context.getString(R.string.installs_title), style = small(muted))
        Text(dateLabel(context, summary, days), style = small(muted))
        Text(
            totalText(summary.dayTotal, numbers),
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 24.sp, fontWeight = FontWeight.Bold),
        )
        val week = context.getString(R.string.installs_week_total, totalText(summary.weekTotal, numbers))
        val partial = listOfNotNull(summary.dayTotal, summary.weekTotal).any { it.partial }
        Text(if (partial) "$week · ${context.getString(R.string.installs_partial)}" else week, style = small(muted))
        view.failure?.let { Text(failureText(context, it), style = tiny(GlanceTheme.colors.error)) }
        Text(context.getString(R.string.installs_fetched, fetchedLabel(context, view.fetchedAt, days)), style = tiny(muted))
    }
    Column(GlanceModifier.fillMaxWidth()) {
        Row(GlanceModifier.fillMaxWidth()) {
            Text(context.getString(R.string.installs_legend), style = tiny(muted), modifier = GlanceModifier.defaultWeight())
            Platform.entries.forEach { Text(platformName(context, it), style = tiny(muted, TextAlign.End), modifier = GlanceModifier.width(CELL_WIDTH)) }
        }
        view.report.apps.take(MAX_APPS).forEach { app ->
            Row(GlanceModifier.fillMaxWidth()) {
                Text(app.name, style = row(GlanceTheme.colors.onSurface), modifier = GlanceModifier.defaultWeight())
                Platform.entries.forEach { platform ->
                    Text(cell(app.count(platform), numbers), style = row(GlanceTheme.colors.onSurface, TextAlign.End), modifier = GlanceModifier.width(CELL_WIDTH))
                }
            }
        }
    }
    Column(GlanceModifier.fillMaxWidth()) {
        summary.missing.take(MAX_REASONS).forEach { (app, platform, reason) ->
            Text("$DASH $app ${platformName(context, platform)}: ${reasonText(context, reason)}", style = tiny(muted))
        }
    }
}

private const val DASH = "—"
private const val PARTIAL = "+"

private fun totalText(total: Total?, numbers: NumberFormat): String =
    total?.let { numbers.format(it.value) + if (it.partial) PARTIAL else "" } ?: DASH

private fun small(color: ColorProvider) = TextStyle(color = color, fontSize = 12.sp)

private fun tiny(color: ColorProvider, align: TextAlign = TextAlign.Start) = TextStyle(color = color, fontSize = 10.sp, textAlign = align)

private fun row(color: ColorProvider, align: TextAlign = TextAlign.Start) = TextStyle(color = color, fontSize = 12.sp, textAlign = align)

private fun cell(count: PlatformCount, numbers: NumberFormat): String = when (count) {
    is PlatformCount.Known -> count.last7?.let { "${numbers.format(count.value)} · ${numbers.format(it)}" } ?: numbers.format(count.value)
    is PlatformCount.Missing -> DASH
}

private fun dayFormatter(locale: Locale): DateTimeFormatter =
    DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "dM"), locale)

/** One date when every count is from the same day, else each store's day (or range of days). */
private fun dateLabel(context: Context, summary: InstallsSummary, days: DateTimeFormatter): String {
    summary.commonDay?.let { return days.format(it) }
    return summary.days.entries.sortedBy { it.key }.joinToString(" · ") { (platform, range) ->
        val text = if (range.first == range.last) days.format(range.first) else "${days.format(range.first)}–${days.format(range.last)}"
        "${platformName(context, platform)} $text"
    }
}

private fun fetchedLabel(context: Context, at: Long, days: DateTimeFormatter): String {
    val zone = ZoneId.systemDefault()
    val day = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val time = DateFormat.getTimeFormat(context).format(Date(at))
    return if (day == LocalDate.now(zone)) time else "${days.format(day)} $time"
}

private fun platformName(context: Context, platform: Platform): String = context.getString(
    when (platform) {
        Platform.IOS -> R.string.installs_ios
        Platform.ANDROID -> R.string.installs_android
    },
)

private fun reasonText(context: Context, reason: MissingReason): String = when (reason) {
    is MissingReason.Stated -> reason.note
    MissingReason.NotGiven -> context.getString(R.string.installs_reason_none)
    MissingReason.NotInFile -> context.getString(R.string.installs_reason_not_in_file)
    MissingReason.Invalid -> context.getString(R.string.installs_reason_invalid)
}

private fun failureText(context: Context, failure: FetchFailure): String = when (failure) {
    FetchFailure.Network -> context.getString(R.string.installs_failure_network)
    is FetchFailure.Http -> context.getString(R.string.installs_failure_http, failure.status)
    FetchFailure.InvalidFile -> context.getString(R.string.installs_failure_file)
}
