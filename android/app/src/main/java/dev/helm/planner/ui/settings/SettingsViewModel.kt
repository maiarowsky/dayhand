package dev.helm.planner.ui.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.AppContainer
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.export.ExportResult
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.connectionStatus
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Where an export stands; [ExportStatus.Ready] waits for the user to pick a file in the save dialog. */
sealed interface ExportStatus {
    data object Idle : ExportStatus
    data object Working : ExportStatus
    data class Ready(val result: ExportResult.Ready, val dialogOpen: Boolean = false) : ExportStatus
    data class Saved(val fileName: String) : ExportStatus
    data class Failed(val reason: ExportFailure) : ExportStatus
}

enum class ExportFailure { NOT_CONFIGURED, UNREACHABLE, UNAUTHORIZED, WRITE }

/** The part of the Settings screen that comes from the app's data. */
data class SettingsData(
    val settings: AppSettings,
    val connection: ConnectionStatus,
    val pendingChanges: Int,
    val export: ExportStatus,
)

/**
 * Settings changes are local first: the summary time and default reminders are stored on the
 * phone (the alarms follow at once) and queued for the server through the outbox, so they
 * work offline like every other change.
 */
class SettingsViewModel(
    private val container: AppContainer,
    /** Writes the export into the file the user picked (a content URI). */
    private val writeFile: suspend (Uri, String) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val export = MutableStateFlow<ExportStatus>(ExportStatus.Idle)
    val exportStatus: StateFlow<ExportStatus> = export.asStateFlow()

    val state: StateFlow<SettingsData?> = combine(
        container.settings.settings,
        connectionStatus(container.settings.settings, container.network.online, container.liveSync.state),
        container.repository.pendingChanges,
        export,
    ) { settings, connection, pending, exportStatus ->
        SettingsData(settings, connection, pending, exportStatus)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    fun saveBackend(url: String, token: String?) = launch {
        container.settings.saveBackend(url, token)
        container.outboxScheduler.restart()
    }

    fun setOfflineMode(enabled: Boolean) = launch {
        container.settings.setOfflineMode(enabled)
        if (!enabled) container.outboxScheduler.restart()
    }

    fun setSummaryTime(time: String) = launch {
        container.settings.setSummaryTime(time)
        container.repository.queueSettingsChange(buildJsonObject { put("summaryTime", time) })
    }

    fun setReminderMinutes(minutes: List<Int>) = launch {
        val clean = minutes.distinct().sorted()
        container.settings.setReminderMinutes(clean)
        container.repository.queueSettingsChange(
            buildJsonObject { put("defaultReminderMinutes", JsonArray(clean.map { JsonPrimitive(it) })) },
        )
    }

    /** Fetches the plan first, so the save dialog opens only when there is something to save. */
    fun export(format: ExportFormat) = launch {
        val settings = container.settings.current()
        val backend = settings.backend
        if (backend == null) {
            export.value = ExportStatus.Failed(ExportFailure.NOT_CONFIGURED)
            return@launch
        }
        export.value = ExportStatus.Working
        val now = clock()
        export.value = when (val result = container.exporter(backend).export(format, now, HelmDates.localDate(now, settings.timezone))) {
            is ExportResult.Ready -> ExportStatus.Ready(result)
            ExportResult.Unauthorized -> ExportStatus.Failed(ExportFailure.UNAUTHORIZED)
            is ExportResult.Failed -> ExportStatus.Failed(ExportFailure.UNREACHABLE)
        }
    }

    /** The save dialog is open; it is not opened again when the screen is recreated. */
    fun dialogOpened() {
        export.update { (it as? ExportStatus.Ready)?.copy(dialogOpen = true) ?: it }
    }

    /** The user picked a file ([uri]) or cancelled the dialog (null). */
    fun saveExport(uri: Uri?) = launch {
        val ready = export.value as? ExportStatus.Ready ?: return@launch
        if (uri == null) {
            export.value = ExportStatus.Idle
            return@launch
        }
        export.value = try {
            writeFile(uri, ready.result.content)
            ExportStatus.Saved(ready.result.fileName)
        } catch (_: IOException) {
            ExportStatus.Failed(ExportFailure.WRITE)
        } catch (_: SecurityException) {
            ExportStatus.Failed(ExportFailure.WRITE)
        }
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
