package dev.helm.planner.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.notify.AndroidNotifier
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.DateTimeException
import java.time.LocalTime

/** Offered reminder offsets in minutes; values set elsewhere (e.g. by the agent) are shown too. */
val REMINDER_OPTIONS = listOf(0, 5, 10, 15, 30, 60, 120, 1440)

@Composable
internal fun SectionHeader(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
}

@Composable
internal fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

@Composable
internal fun NotificationsSection(access: NotificationAccess, exactAlarms: Boolean, actions: SettingsActions) {
    SectionHeader(stringResource(R.string.settings_notifications))
    if (access == NotificationAccess.ALLOWED) {
        Text(stringResource(R.string.settings_notifications_on), style = MaterialTheme.typography.bodyLarge)
    } else {
        Text(
            stringResource(R.string.settings_notifications_off),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error,
        )
        OutlinedButton(
            onClick = actions::allowNotifications,
            modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.NOTIFICATIONS),
        ) {
            Text(
                stringResource(
                    if (access == NotificationAccess.ASK) R.string.settings_notifications_allow else R.string.settings_open_system,
                ),
            )
        }
    }
    if (exactAlarms) {
        Hint(stringResource(R.string.settings_exact_on))
    } else {
        Hint(stringResource(R.string.settings_exact_off))
        OutlinedButton(
            onClick = actions::allowExactAlarms,
            modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.EXACT),
        ) { Text(stringResource(R.string.settings_exact_allow)) }
    }
}

@Composable
internal fun SummarySection(summaryTime: String, onPick: (String) -> Unit) {
    var picking by rememberSaveable { mutableStateOf(false) }
    val changeLabel = stringResource(R.string.settings_summary_change)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(onClickLabel = changeLabel, role = Role.Button) { picking = true }
            .testTag(SettingsTags.SUMMARY_TIME),
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            SectionHeader(stringResource(R.string.settings_summary))
            Hint(stringResource(R.string.settings_summary_hint))
        }
        Text(summaryTime, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary)
    }
    if (picking) {
        val initial = try {
            LocalTime.parse(summaryTime)
        } catch (_: DateTimeException) {
            LocalTime.of(5, 0)
        }
        TimePickerDialog(initial = initial, onDismiss = { picking = false }, onPick = { picking = false; onPick(it) })
    }
}

@Composable
internal fun RemindersSection(minutes: List<Int>, onChange: (List<Int>) -> Unit) {
    val resources = LocalResources.current
    SectionHeader(stringResource(R.string.settings_reminders))
    Hint(stringResource(R.string.settings_reminders_hint))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        for (option in (REMINDER_OPTIONS + minutes).distinct().sorted()) {
            val selected = option in minutes
            val label = if (option == 0) {
                stringResource(R.string.reminder_at_due)
            } else {
                stringResource(R.string.reminder_before, AndroidNotifier.durationLabel(resources, option))
            }
            FilterChip(
                selected = selected,
                onClick = { onChange(if (selected) minutes - option else minutes + option) },
                label = { Text(label) },
                // Selected is shown by a tick too, not by colour alone.
                leadingIcon = if (selected) {
                    { Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) }
                } else {
                    null
                },
                modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.REMINDER + option),
            )
        }
    }
    if (minutes.isEmpty()) Hint(stringResource(R.string.settings_reminders_none))
}

@Composable
internal fun LanguageSection(language: AppLanguage?, onChange: (AppLanguage) -> Unit) {
    SectionHeader(stringResource(R.string.settings_language))
    if (language == null) {
        Hint(stringResource(R.string.settings_language_unsupported))
        return
    }
    Column(Modifier.selectableGroup()) {
        for (option in AppLanguage.entries) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .selectable(selected = option == language, role = Role.RadioButton) { onChange(option) }
                    .testTag(SettingsTags.LANGUAGE + option.name),
            ) {
                RadioButton(selected = option == language, onClick = null)
                Text(
                    stringResource(
                        when (option) {
                            AppLanguage.SYSTEM -> R.string.language_system
                            AppLanguage.POLISH -> R.string.language_polish
                            AppLanguage.ENGLISH -> R.string.language_english
                        },
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(start = 16.dp),
                )
            }
        }
    }
}

@Composable
internal fun ExportSection(status: ExportStatus, onExport: (ExportFormat) -> Unit) {
    SectionHeader(stringResource(R.string.settings_export))
    Hint(stringResource(R.string.settings_export_hint))
    val busy = status == ExportStatus.Working || status is ExportStatus.Ready
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = { onExport(ExportFormat.MARKDOWN) },
            enabled = !busy,
            modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.EXPORT_MARKDOWN),
        ) { Text(stringResource(R.string.export_markdown)) }
        OutlinedButton(
            onClick = { onExport(ExportFormat.JSON) },
            enabled = !busy,
            modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.EXPORT_JSON),
        ) { Text(stringResource(R.string.export_json)) }
    }
    val message = when (status) {
        ExportStatus.Idle, is ExportStatus.Ready -> null
        ExportStatus.Working -> stringResource(R.string.export_working)
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
    if (message != null) {
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = if (status is ExportStatus.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .semantics { liveRegion = LiveRegionMode.Polite }
                .testTag(SettingsTags.EXPORT_STATUS),
        )
    }
}

@Composable
internal fun AboutSection(versionName: String, onLicense: () -> Unit) {
    SectionHeader(stringResource(R.string.settings_about))
    Text(stringResource(R.string.settings_version, versionName), style = MaterialTheme.typography.bodyLarge)
    Hint(stringResource(R.string.about_text))
    TextButton(onClick = onLicense, modifier = Modifier.heightIn(min = 48.dp).testTag(SettingsTags.LICENSE)) {
        Text(stringResource(R.string.about_license))
    }
}
