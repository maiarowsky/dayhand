package dev.helm.planner.widget

import java.time.LocalDate

sealed interface FetchFailure {
    data object Network : FetchFailure

    data class Http(val status: Int) : FetchFailure

    data object InvalidFile : FetchFailure
}

sealed interface FetchResult {
    data class Body(val text: String) : FetchResult

    data class Failed(val failure: FetchFailure) : FetchResult
}

/**
 * What the widget keeps: the file's address, the last file that parsed ([body], fetched at [fetchedAt]) and what went
 * wrong on the latest try, if anything. A failed fetch never replaces the last good file.
 */
data class WidgetData(
    val url: String? = null,
    val body: String? = null,
    val fetchedAt: Long? = null,
    val failure: FetchFailure? = null,
) {
    fun after(result: FetchResult, now: Long): WidgetData = when (result) {
        is FetchResult.Body -> try {
            InstallsJson.parse(result.text)
            copy(body = result.text, fetchedAt = now, failure = null)
        } catch (_: InvalidInstallsFile) {
            copy(failure = FetchFailure.InvalidFile)
        }
        is FetchResult.Failed -> copy(failure = result.failure)
    }

    fun view(): WidgetView {
        if (url == null) return WidgetView.NotSet
        val report = body?.let { runCatching { InstallsJson.parse(it) }.getOrNull() }
        return when {
            report != null -> WidgetView.Showing(InstallsTable.of(report), failure)
            failure != null -> WidgetView.Failed(failure)
            else -> WidgetView.Loading
        }
    }
}

sealed interface WidgetView {
    data object NotSet : WidgetView

    data object Loading : WidgetView

    data class Failed(val failure: FetchFailure) : WidgetView

    /** The last good file; [failure] says the latest refresh did not replace it. */
    data class Showing(val table: InstallsTable, val failure: FetchFailure?) : WidgetView
}

/**
 * One app's all-time installs over both stores, and its installs on each store's latest published day added up
 * ([lastDay]); a number is null when it would leave a count out.
 */
data class TableRow(val name: String, val total: Int?, val lastDay: Int?)

/** The published days of one store's known counts; one day when every app's count is from the same day. */
data class PublishedDays(val oldest: LocalDate, val newest: LocalDate)

/**
 * The widget's table: a row per app, the published days per store among the known counts, the stores with a count
 * missing for lack of data, and whether a count is missing because the file has no `total` field.
 */
data class InstallsTable(
    val rows: List<TableRow>,
    val days: Map<Platform, PublishedDays>,
    val storesWithoutData: List<Platform>,
    val noTotalInFile: Boolean,
) {
    companion object {
        fun of(report: InstallsReport): InstallsTable {
            val rows = report.apps.map { app ->
                val known = Platform.entries.map { app.count(it) as? PlatformCount.Known }
                TableRow(app.name, sum(known.map { it?.total }), sum(known.map { it?.dayInstalls }))
            }
            val counts = report.apps.flatMap { app -> Platform.entries.map { it to app.count(it) } }
            val reasons = counts.mapNotNull { (platform, count) -> (count as? PlatformCount.Missing)?.let { platform to it.reason } }
            return InstallsTable(
                rows = rows,
                days = Platform.entries.mapNotNull { platform ->
                    val days = report.apps.mapNotNull { (it.count(platform) as? PlatformCount.Known)?.day }
                    days.minOrNull()?.let { platform to PublishedDays(it, days.max()) }
                }.toMap(),
                storesWithoutData = reasons.filter { it.second != MissingReason.NO_TOTAL }.map { it.first }.distinct().sorted(),
                noTotalInFile = reasons.any { it.second == MissingReason.NO_TOTAL },
            )
        }

        private fun sum(values: Collection<Int?>): Int? = values.takeIf { it.isNotEmpty() && null !in it }?.filterNotNull()?.sum()
    }
}
