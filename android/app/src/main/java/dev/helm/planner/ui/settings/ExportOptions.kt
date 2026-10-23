package dev.helm.planner.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.palette

/**
 * The Export page: one row per format, both off while an export runs, and the result as the last row (a spinner while
 * it is prepared, then saved or why it failed), read out when it changes; what each format holds under them.
 */
@Composable
internal fun ExportOptions(status: ExportStatus, onExport: (ExportFormat) -> Unit) {
    val busy = status == ExportStatus.Working || status is ExportStatus.Ready
    val rows = buildList<@Composable () -> Unit> {
        add { ExportRow(R.string.export_markdown, LineIcon.Document, SettingsTags.EXPORT_MARKDOWN, !busy) { onExport(ExportFormat.MARKDOWN) } }
        add { ExportRow(R.string.export_json, LineIcon.Code, SettingsTags.EXPORT_JSON, !busy) { onExport(ExportFormat.JSON) } }
        if (status != ExportStatus.Idle && status !is ExportStatus.Ready) add { ExportResult(status) }
    }
    ListGroup(null, rows)
    ListNote(stringResource(R.string.settings_export_hint))
}

@Composable
private fun ExportRow(@StringRes title: Int, icon: LineIcon, tag: String, enabled: Boolean, onClick: () -> Unit) {
    ListRow(stringResource(title), tag = tag, icon = icon, enabled = enabled, onClick = onClick)
}

@Composable
private fun ExportResult(status: ExportStatus) {
    val p = palette
    val message = when (status) {
        ExportStatus.Idle, is ExportStatus.Ready, ExportStatus.Working -> stringResource(R.string.export_working)
        is ExportStatus.Saved -> stringResource(R.string.export_saved, status.fileName)
        is ExportStatus.Failed -> stringResource(
            when (status.reason) {
                ExportFailure.NOT_CONFIGURED -> R.string.export_not_configured
                ExportFailure.UNREACHABLE -> R.string.export_failed
                ExportFailure.UNAUTHORIZED -> R.string.export_unauthorized
                ExportFailure.WRITE -> R.string.export_write_failed
            },
        )
    }
    ListRow(
        message,
        tag = SettingsTags.EXPORT_STATUS,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        icon = when (status) {
            is ExportStatus.Saved -> LineIcon.Check
            is ExportStatus.Failed -> LineIcon.Warning
            else -> null
        },
        titleColor = if (status == ExportStatus.Working) p.textMuted else p.text,
        trailing = if (status == ExportStatus.Working) {
            { CircularProgressIndicator(color = p.accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp)) }
        } else {
            null
        },
    )
}
