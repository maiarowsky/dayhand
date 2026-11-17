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

/** A sum of known counts; [partial] when it leaves a count out or adds counts from different days. */
data class Total(val value: Int, val partial: Boolean)

/** One app's store with no count, and why. */
data class MissingCount(val app: String, val platform: Platform, val reason: MissingReason)

/**
 * The header and footer of the widget: the day's total and the 7-day total over the known counts (null when none is
 * known; partial when a count is missing, a known count has no 7-day value, or the counts are from different days), the
 * published days per store, and each count that is missing with its reason.
 */
data class InstallsSummary(
    val dayTotal: Total?,
    val weekTotal: Total?,
    val days: Map<Platform, DayRange>,
    val missing: List<MissingCount>,
) {
    /** The single day every known count is from, or null when the stores (or apps) are on different days. */
    val commonDay: LocalDate?
        get() = days.values.flatMap { listOf(it.first, it.last) }.distinct().singleOrNull()

    companion object {
        fun of(report: InstallsReport): InstallsSummary {
            val counts = report.apps.flatMap { app -> Platform.entries.map { Triple(app.name, it, app.count(it)) } }
            val known = counts.mapNotNull { (_, platform, count) -> (count as? PlatformCount.Known)?.let { platform to it } }
            val missing = counts.mapNotNull { (app, platform, count) ->
                (count as? PlatformCount.Missing)?.let { MissingCount(app, platform, it.reason) }
            }
            val partial = missing.isNotEmpty() || known.map { it.second.day }.distinct().size > 1
            val weeks = known.map { it.second.last7 }
            return InstallsSummary(
                dayTotal = total(known.map { it.second.value }, partial),
                weekTotal = total(weeks.filterNotNull(), partial || null in weeks),
                days = known.groupBy({ it.first }, { it.second.day }).mapValues { (_, d) -> DayRange(d.min(), d.max()) },
                missing = missing,
            )
        }

        private fun total(values: List<Int>, partial: Boolean): Total? = values.takeIf { it.isNotEmpty() }?.let { Total(it.sum(), partial) }
    }
}
