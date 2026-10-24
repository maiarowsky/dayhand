package dev.helm.planner.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.calendar.CalendarFeed
import dev.helm.planner.calendar.CalendarFeedApi
import dev.helm.planner.calendar.FeedLoad
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.export.ExportResult
import dev.helm.planner.export.PlanExporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The feed as the page shows it. */
sealed interface FeedView {
    data object Loading : FeedView
    data object NotConnected : FeedView
    data object Off : FeedView
    data class On(val feed: CalendarFeed) : FeedView
    data class Failed(val unauthorized: Boolean) : FeedView
}

/** The one-time .ics file: [Ready] is handed to the share sheet once, then [CalendarFeedViewModel.exportHandled]. */
sealed interface IcsExport {
    data object Idle : IcsExport
    data object Working : IcsExport
    data class Ready(val fileName: String, val content: String) : IcsExport
    data object Failed : IcsExport
}

data class CalendarFeedUiState(
    val feed: FeedView = FeedView.Loading,
    val busy: Boolean = false,
    /** A new address replaced the old one just now (said once on the page). */
    val rotated: Boolean = false,
    val copied: Boolean = false,
    /** The last change did not reach the server; the page still shows what was there. */
    val changeFailed: Boolean = false,
    val export: IcsExport = IcsExport.Idle,
)

/**
 * Settings → Calendar. Nothing is cached: the address is read when the page opens and after every change, so a
 * new address made with `dayhand calendar rotate` shows here too. [api] and [exporter] are null while the phone is not
 * paired (or in the offline test mode).
 */
class CalendarFeedViewModel(
    private val api: suspend () -> CalendarFeedApi?,
    private val exporter: suspend () -> PlanExporter?,
    private val today: suspend () -> String,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val state = MutableStateFlow(CalendarFeedUiState())
    val ui: StateFlow<CalendarFeedUiState> = state.asStateFlow()

    init {
        reload()
    }

    fun reload() = launch {
        val remote = api() ?: return@launch state.update { it.copy(feed = FeedView.NotConnected) }
        state.update { it.copy(feed = remote.get().toView(it.feed)) }
    }

    fun turnOn() = change { it.create(replace = false) }

    fun rotate() = change(rotated = true) { it.create(replace = true) }

    fun turnOff() = launch {
        val remote = api() ?: return@launch
        if (state.value.busy) return@launch
        state.update { it.copy(busy = true, rotated = false, copied = false, changeFailed = false) }
        val revoked = remote.revoke()
        state.update { it.copy(busy = false, feed = remote.get().toView(it.feed), changeFailed = !revoked) }
    }

    fun copied() = state.update { it.copy(copied = true) }

    fun export() = launch {
        if (state.value.export == IcsExport.Working) return@launch
        val source = exporter() ?: return@launch state.update { it.copy(export = IcsExport.Failed) }
        state.update { it.copy(export = IcsExport.Working) }
        val result = when (val exported = source.export(ExportFormat.ICS, now(), today())) {
            is ExportResult.Ready -> IcsExport.Ready(exported.fileName, exported.content)
            else -> IcsExport.Failed
        }
        state.update { it.copy(export = result) }
    }

    fun exportHandled() = state.update { it.copy(export = IcsExport.Idle) }

    private fun change(rotated: Boolean = false, call: suspend (CalendarFeedApi) -> FeedLoad) = launch {
        val remote = api() ?: return@launch
        if (state.value.busy) return@launch
        state.update { it.copy(busy = true, rotated = false, copied = false, changeFailed = false) }
        val load = call(remote)
        val ok = load is FeedLoad.Loaded
        state.update { it.copy(busy = false, feed = load.toView(it.feed), rotated = rotated && ok, changeFailed = !ok) }
    }

    private fun FeedLoad.toView(current: FeedView): FeedView = when (this) {
        is FeedLoad.Loaded -> feed?.let { FeedView.On(it) } ?: FeedView.Off
        FeedLoad.Unauthorized -> FeedView.Failed(unauthorized = true)
        // A failed change keeps showing what was there; a failed first read says so.
        is FeedLoad.Failed -> if (current is FeedView.On || current is FeedView.Off) current else FeedView.Failed(unauthorized = false)
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }
}
