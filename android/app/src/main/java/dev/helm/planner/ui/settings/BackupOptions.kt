package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.backup.PlanBackup
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.palette
import java.time.Instant

/** Where a backup or a restore stands. */
sealed interface BackupStatus {
    data object Idle : BackupStatus
    data object Working : BackupStatus

    /** The file is ready and waits for the save dialog ([dialogOpen] once it is shown). */
    data class ReadyToSave(val fileName: String, val content: String, val dialogOpen: Boolean = false) : BackupStatus

    /** The file is ready to hand to the share sheet. */
    data class ReadyToShare(val fileName: String, val content: String) : BackupStatus
    data class Saved(val fileName: String) : BackupStatus
    data class Restored(val added: Int, val alreadyHere: Int, val invalid: Int, val settings: Boolean) : BackupStatus
    data class Failed(val reason: BackupFailure) : BackupStatus
}

enum class BackupFailure { WRITE, READ, NOT_HELM, TOO_MANY, PROJECT_LIMIT, CONNECTION, PROJECT }

/**
 * The Backup page: save the plan on this phone to a file, share it, or restore one; when the last backup was made,
 * then the result of the last action, read out when it changes; what a backup holds under them.
 */
@Composable
internal fun BackupOptions(status: BackupStatus, lastBackupAt: Long?, timezone: String, actions: SettingsActions) {
    val busy = status == BackupStatus.Working || status is BackupStatus.ReadyToSave || status is BackupStatus.ReadyToShare
    val rows = buildList<@Composable () -> Unit> {
        add { ListRow(stringResource(R.string.backup_save), SettingsTags.BACKUP_SAVE, icon = LineIcon.Download, enabled = !busy, onClick = actions::saveBackup) }
        add { ListRow(stringResource(R.string.backup_share), SettingsTags.BACKUP_SHARE, icon = LineIcon.Share, enabled = !busy, onClick = actions::shareBackup) }
        add { ListRow(stringResource(R.string.backup_restore), SettingsTags.BACKUP_RESTORE, icon = LineIcon.Refresh, enabled = !busy, onClick = actions::restoreBackup) }
    }
    ListGroup(null, rows)
    val info = buildList<@Composable () -> Unit> {
        add { LastBackupRow(lastBackupAt, timezone) }
        if (status != BackupStatus.Idle && status !is BackupStatus.ReadyToSave && status !is BackupStatus.ReadyToShare) add { BackupResult(status) }
    }
    ListGroup(null, info)
    ListNote(stringResource(R.string.backup_hint))
}

@Composable
private fun LastBackupRow(lastBackupAt: Long?, timezone: String) {
    val text = lastBackupAt?.let { at ->
        val format = dateFormat("yMMMMdHHmm", appLocale()).withZone(HelmDates.zone(timezone))
        stringResource(R.string.backup_last, format.format(Instant.ofEpochMilli(at)))
    } ?: stringResource(R.string.backup_never)
    ListRow(text, tag = SettingsTags.BACKUP_LAST, icon = LineIcon.Clock, titleColor = palette.textMuted)
}

@Composable
private fun BackupResult(status: BackupStatus) {
    val p = palette
    val message = when (status) {
        BackupStatus.Idle, BackupStatus.Working, is BackupStatus.ReadyToSave, is BackupStatus.ReadyToShare -> stringResource(R.string.backup_working)
        is BackupStatus.Saved -> stringResource(R.string.backup_saved, status.fileName)
        is BackupStatus.Restored -> restoredText(status)
        is BackupStatus.Failed -> when (status.reason) {
            BackupFailure.WRITE -> stringResource(R.string.backup_write_failed)
            BackupFailure.READ -> stringResource(R.string.backup_read_failed)
            BackupFailure.NOT_HELM -> stringResource(R.string.backup_not_helm)
            BackupFailure.TOO_MANY -> pluralStringResource(R.plurals.backup_too_many, PlanBackup.MAX_TASKS, PlanBackup.MAX_TASKS)
            BackupFailure.PROJECT_LIMIT -> stringResource(R.string.project_restore_limit)
            BackupFailure.CONNECTION -> stringResource(R.string.project_connection_required)
            BackupFailure.PROJECT -> stringResource(R.string.project_failed)
        }
    }
    ListRow(
        message,
        tag = SettingsTags.BACKUP_STATUS,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        icon = when (status) {
            is BackupStatus.Saved, is BackupStatus.Restored -> LineIcon.Check
            is BackupStatus.Failed -> LineIcon.Warning
            else -> null
        },
        titleColor = if (status == BackupStatus.Working) p.textMuted else p.text,
        trailing = if (status == BackupStatus.Working) {
            { CircularProgressIndicator(color = p.accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp)) }
        } else {
            null
        },
    )
}

/** "Restored 12 tasks. 3 were already on the phone. 1 could not be read. The settings were restored too." */
@Composable
private fun restoredText(status: BackupStatus.Restored): String = buildList {
    add(pluralStringResource(R.plurals.backup_restored, status.added, status.added))
    if (status.alreadyHere > 0) add(pluralStringResource(R.plurals.backup_already_here, status.alreadyHere, status.alreadyHere))
    if (status.invalid > 0) add(pluralStringResource(R.plurals.backup_invalid, status.invalid, status.invalid))
    if (status.settings) add(stringResource(R.string.backup_settings_restored))
}.joinToString(" ")
