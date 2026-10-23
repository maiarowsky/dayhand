package dev.helm.planner.ui.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.AppContainer
import dev.helm.planner.backup.BackupProblem
import dev.helm.planner.backup.BackupRead
import dev.helm.planner.backup.BackupSettings
import dev.helm.planner.backup.PlanBackup
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.export.ExportResult
import dev.helm.planner.settings.AppSettings
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.connectionStatus
import java.io.IOException
import java.util.UUID
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
    val backup: BackupStatus = BackupStatus.Idle,
    /** The sample plan is on the phone; Data offers to remove it. */
    val sample: Boolean = false,
)

/**
 * Settings changes are local first: the summary time and default reminders are stored on the
 * phone (the alarms follow at once) and queued for the server through the outbox, so they
 * work offline and without a server like every other change.
 */
class SettingsViewModel(
    private val container: AppContainer,
    /** Writes the export or backup into the file the user picked (a content URI). */
    private val writeFile: suspend (Uri, String) -> Unit,
    /** Reads the file the user picked to restore. */
    private val readFile: suspend (Uri) -> String = { error("no reader") },
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val export = MutableStateFlow<ExportStatus>(ExportStatus.Idle)
    val exportStatus: StateFlow<ExportStatus> = export.asStateFlow()
    private val backup = MutableStateFlow<BackupStatus>(BackupStatus.Idle)

    val state: StateFlow<SettingsData?> = combine(
        container.settings.settings,
        connectionStatus(container.settings.settings, container.network.online, container.liveSync.state),
        container.repository.pendingChanges,
        combine(export, backup, ::Pair),
        container.repository.hasSample,
    ) { settings, connection, pending, (exportStatus, backupStatus), sample ->
        SettingsData(settings, connection, pending, exportStatus, backupStatus, sample)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    /** Forgets the sign-in on this phone; tasks and waiting changes stay for the next pairing. */
    fun disconnect() = launch {
        container.settings.forgetDevice(revoked = false)
    }

    /** Sets the server's time zone to the phone's, on the phone at once and through the outbox. */
    fun usePhoneTimezone() = launch {
        val zone = container.settings.current().phoneTimezone
        container.settings.setServerTimezone(zone)
        container.repository.queueSettingsChange(buildJsonObject { put("timezone", zone) })
    }

    fun removeSample() = launch { container.repository.removeSample() }

    /** Makes the backup file, then the save dialog opens for it. */
    fun saveBackup() = launch {
        backup.value = BackupStatus.Working
        val (name, content) = backupFile()
        backup.value = BackupStatus.ReadyToSave(name, content)
    }

    /** The save dialog is open; it is not opened again when the screen is recreated. */
    fun backupDialogOpened() {
        backup.update { (it as? BackupStatus.ReadyToSave)?.copy(dialogOpen = true) ?: it }
    }

    /** The user picked where to save the backup ([uri]) or cancelled (null). */
    fun saveBackupTo(uri: Uri?) = launch {
        val ready = backup.value as? BackupStatus.ReadyToSave ?: return@launch
        if (uri == null) {
            backup.value = BackupStatus.Idle
            return@launch
        }
        backup.value = try {
            writeFile(uri, ready.content)
            container.settings.setLastBackup(clock())
            BackupStatus.Saved(ready.fileName)
        } catch (_: IOException) {
            BackupStatus.Failed(BackupFailure.WRITE)
        } catch (_: SecurityException) {
            BackupStatus.Failed(BackupFailure.WRITE)
        }
    }

    /** Makes the backup file for the share sheet. */
    fun shareBackup() = launch {
        backup.value = BackupStatus.Working
        val (name, content) = backupFile()
        backup.value = BackupStatus.ReadyToShare(name, content)
    }

    /** The share sheet got the file ([shared]), or it could not be written into the cache. */
    fun backupShared(shared: Boolean) = launch {
        val ready = backup.value as? BackupStatus.ReadyToShare ?: return@launch
        if (shared) container.settings.setLastBackup(clock())
        backup.value = if (shared) BackupStatus.Saved(ready.fileName) else BackupStatus.Failed(BackupFailure.WRITE)
    }

    /**
     * Restores the tasks of a backup file ([uri], null when the user cancelled) next to those on the phone. Without a
     * server the backup's summary time and default reminders are restored too; with one, the server's stay.
     */
    fun restoreFrom(uri: Uri?) = launch {
        if (uri == null) return@launch
        backup.value = BackupStatus.Working
        val text = try {
            readFile(uri)
        } catch (_: IOException) {
            null
        } catch (_: SecurityException) {
            null
        }
        backup.value = when (val read = text?.let { PlanBackup.read(it, newId = { UUID.randomUUID().toString() }) }) {
            null -> BackupStatus.Failed(BackupFailure.READ)
            is BackupRead.Unreadable -> BackupStatus.Failed(
                if (read.problem == BackupProblem.TOO_MANY) BackupFailure.TOO_MANY else BackupFailure.NOT_HELM,
            )
            is BackupRead.Plan -> {
                val result = container.repository.restore(read.tasks)
                val settings = read.settings?.takeIf { container.settings.current().isLocal }
                settings?.let {
                    setSummaryTime(it.summaryTime)
                    setReminderMinutes(it.defaultReminderMinutes)
                }
                BackupStatus.Restored(result.added, result.alreadyHere, read.invalid.size, settings != null)
            }
        }
    }

    /** The backup of the plan on this phone, named after today. */
    private suspend fun backupFile(): Pair<String, String> {
        val s = container.settings.current()
        val now = clock()
        val content = PlanBackup.write(
            container.repository.backupTasks(),
            BackupSettings(s.timezone, s.summaryTime, s.reminderMinutes),
            now,
        )
        return PlanBackup.fileName(HelmDates.localDate(now, s.timezone)) to content
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
