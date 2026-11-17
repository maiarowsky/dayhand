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
            report != null && fetchedAt != null -> WidgetView.Showing(report, InstallsSummary.of(report), fetchedAt, failure)
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
    data class Showing(
        val report: InstallsReport,
        val summary: InstallsSummary,
        val fetchedAt: Long,
        val failure: FetchFailure?,
    ) : WidgetView
}

data class DayRange(val first: LocalDate, val last: LocalDate)

/**
 * The header and footer of the widget: the day's total over every known count (null when none is known), the 7-day
 * total (null unless every known count has one), the published days per store, and each distinct reason a count is
 * missing.
 */
data class InstallsSummary(
    val dayTotal: Int?,
    val weekTotal: Int?,
    val days: Map<Platform, DayRange>,
    val missing: List<Pair<Platform, MissingReason>>,
) {
    /** The single day every known count is from, or null when the stores (or apps) are on different days. */
    val commonDay: LocalDate?
        get() = days.values.flatMap { listOf(it.first, it.last) }.distinct().singleOrNull()

    companion object {
        fun of(report: InstallsReport): InstallsSummary {
            val counts = report.apps.flatMap { app -> Platform.entries.map { it to app.count(it) } }
            val known = counts.mapNotNull { (platform, count) -> (count as? PlatformCount.Known)?.let { platform to it } }
            val weeks = known.map { it.second.last7 }
            return InstallsSummary(
                dayTotal = known.takeIf { it.isNotEmpty() }?.sumOf { it.second.value },
                weekTotal = weeks.takeIf { it.isNotEmpty() && null !in it }?.sumOf { it ?: 0 },
                days = known.groupBy({ it.first }, { it.second.day }).mapValues { (_, d) -> DayRange(d.min(), d.max()) },
                missing = counts.mapNotNull { (platform, count) -> (count as? PlatformCount.Missing)?.let { platform to it.reason } }.distinct(),
            )
        }
    }
}
