package dev.helm.planner.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.ui.components.IconTone
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.palette

/**
 * Export: one row per format, both off while an export runs, and the result as the last row (a spinner while it is
 * prepared, then saved or why it failed), read out when it changes.
 */
@Composable
internal fun ExportSection(status: ExportStatus, onExport: (ExportFormat) -> Unit) {
    val busy = status == ExportStatus.Working || status is ExportStatus.Ready
    val rows = buildList<@Composable () -> Unit> {
        add { ExportRow(R.string.export_markdown, SettingsIcons.Description, SettingsTags.EXPORT_MARKDOWN, !busy) { onExport(ExportFormat.MARKDOWN) } }
        add { ExportRow(R.string.export_json, SettingsIcons.DataObject, SettingsTags.EXPORT_JSON, !busy) { onExport(ExportFormat.JSON) } }
        if (status != ExportStatus.Idle && status !is ExportStatus.Ready) add { ExportResult(status) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ListGroup(stringResource(R.string.settings_export), rows)
        ListNote(stringResource(R.string.settings_export_hint))
    }
}

@Composable
private fun ExportRow(@StringRes title: Int, icon: ImageVector, tag: String, enabled: Boolean, onClick: () -> Unit) {
    ListRow(
        stringResource(title),
        tag = tag,
        icon = icon,
        enabled = enabled,
        onClick = onClick,
        chevron = false,
        trailing = {
            Icon(SettingsIcons.Download, contentDescription = null, tint = if (enabled) palette.accent else palette.textFaint, modifier = Modifier.size(22.dp))
        },
    )
}

@Composable
private fun ExportResult(status: ExportStatus) {
    val p = palette
    val failed = status is ExportStatus.Failed
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
            is ExportStatus.Saved -> Icons.Filled.CheckCircle
            is ExportStatus.Failed -> Icons.Filled.Warning
            else -> null
        },
        tone = if (failed) IconTone.Danger else IconTone.Success,
        titleColor = when (status) {
            is ExportStatus.Saved -> p.success
            is ExportStatus.Failed -> p.danger
            else -> p.textMuted
        },
        trailing = if (status == ExportStatus.Working) {
            { CircularProgressIndicator(color = p.accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp)) }
        } else {
            null
        },
    )
}

/** About: the version with what Helm is, then the license and the open source licenses. */
@Composable
internal fun AboutSection(versionName: String, actions: SettingsActions) {
    ListGroup(
        stringResource(R.string.settings_about),
        rows = listOf(
            {
                ListRow(
                    stringResource(R.string.settings_version, versionName),
                    tag = SettingsTags.VERSION,
                    icon = Icons.Filled.Info,
                    subtitle = stringResource(R.string.about_text),
                )
            },
            {
                ListRow(
                    stringResource(R.string.about_license),
                    tag = SettingsTags.LICENSE,
                    icon = SettingsIcons.Description,
                    tone = IconTone.Neutral,
                    onClick = actions::openLicense,
                    chevron = false,
                    trailing = { Icon(SettingsIcons.OpenInNew, contentDescription = null, tint = palette.textFaint, modifier = Modifier.size(20.dp)) },
                )
            },
            {
                ListRow(
                    stringResource(R.string.licenses_title),
                    tag = SettingsTags.LICENSES,
                    icon = Icons.AutoMirrored.Filled.List,
                    tone = IconTone.Neutral,
                    onClick = actions::openLicenses,
                )
            },
        ),
    )
}
