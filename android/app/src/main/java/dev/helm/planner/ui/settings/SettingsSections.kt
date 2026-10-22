package dev.helm.planner.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.notify.AndroidNotifier
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.SegmentOption
import dev.helm.planner.ui.components.Segmented
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.DateTimeException
import java.time.LocalTime

/** Offered reminder offsets in minutes; values set elsewhere (e.g. by the agent) are shown too. */
val REMINDER_OPTIONS = listOf(0, 5, 10, 15, 30, 60, 120, 1440)

/** A settings section: an upper-case label and a card holding its rows. */
@Composable
internal fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = modifier)
}

@Composable
internal fun NotificationsSection(access: NotificationAccess, exactAlarms: Boolean, actions: SettingsActions) {
    val p = palette
    CardSection(stringResource(R.string.settings_notifications)) {
        if (access == NotificationAccess.ALLOWED) {
            Text(stringResource(R.string.settings_notifications_on), style = helmType.body, color = p.text)
        } else {
            Text(stringResource(R.string.settings_notifications_off), style = helmType.bodyStrong, color = p.danger)
            SecondaryButton(
                stringResource(
                    if (access == NotificationAccess.ASK) R.string.settings_notifications_allow else R.string.settings_open_system,
                ),
                onClick = actions::allowNotifications,
                color = p.accent,
                modifier = Modifier.testTag(SettingsTags.NOTIFICATIONS),
            )
        }
        if (exactAlarms) {
            Hint(stringResource(R.string.settings_exact_on))
        } else {
            Hint(stringResource(R.string.settings_exact_off))
            SecondaryButton(
                stringResource(R.string.settings_exact_allow),
                onClick = actions::allowExactAlarms,
                color = p.accent,
                modifier = Modifier.testTag(SettingsTags.EXACT),
            )
        }
    }
}

@Composable
internal fun SummarySection(summaryTime: String, onPick: (String) -> Unit) {
    val p = palette
    var picking by rememberSaveable { mutableStateOf(false) }
    val changeLabel = stringResource(R.string.settings_summary_change)
    CardSection(stringResource(R.string.settings_summary)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = HelmDimens.touchTarget)
                .clickable(onClickLabel = changeLabel, role = Role.Button) { picking = true }
                .testTag(SettingsTags.SUMMARY_TIME),
        ) {
            Hint(stringResource(R.string.settings_summary_hint), Modifier.weight(1f).padding(end = 16.dp))
            Text(summaryTime, style = helmType.headline, color = p.accent)
        }
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
    CardSection(stringResource(R.string.settings_reminders)) {
        Hint(stringResource(R.string.settings_reminders_hint))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            for (option in (REMINDER_OPTIONS + minutes).distinct().sorted()) {
                val selected = option in minutes
                val label = if (option == 0) {
                    stringResource(R.string.reminder_at_due)
                } else {
                    stringResource(R.string.reminder_before, AndroidNotifier.durationLabel(resources, option))
                }
                HelmChip(
                    label,
                    selected = selected,
                    onClick = { onChange(if (selected) minutes - option else minutes + option) },
                    multiple = true,
                    modifier = Modifier.testTag(SettingsTags.REMINDER + option),
                )
            }
        }
        if (minutes.isEmpty()) Hint(stringResource(R.string.settings_reminders_none))
    }
}

@Composable
internal fun LanguageSection(language: AppLanguage?, onChange: (AppLanguage) -> Unit) {
    CardSection(stringResource(R.string.settings_language)) {
        if (language == null) {
            Hint(stringResource(R.string.settings_language_unsupported))
            return@CardSection
        }
        Segmented(
            options = AppLanguage.entries.map { option ->
                SegmentOption(
                    option.name,
                    stringResource(
                        when (option) {
                            AppLanguage.SYSTEM -> R.string.language_system
                            AppLanguage.POLISH -> R.string.language_polish
                            AppLanguage.ENGLISH -> R.string.language_english
                        },
                    ),
                )
            },
            selected = language.name,
            onSelect = { onChange(AppLanguage.valueOf(it)) },
            tagFor = { SettingsTags.LANGUAGE + it },
        )
    }
}

@Composable
internal fun ExportSection(status: ExportStatus, onExport: (ExportFormat) -> Unit) {
    val p = palette
    CardSection(stringResource(R.string.settings_export)) {
        Hint(stringResource(R.string.settings_export_hint))
        val busy = status == ExportStatus.Working || status is ExportStatus.Ready
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton(
                stringResource(R.string.export_markdown),
                onClick = { onExport(ExportFormat.MARKDOWN) },
                enabled = !busy,
                modifier = Modifier.testTag(SettingsTags.EXPORT_MARKDOWN),
            )
            SecondaryButton(
                stringResource(R.string.export_json),
                onClick = { onExport(ExportFormat.JSON) },
                enabled = !busy,
                modifier = Modifier.testTag(SettingsTags.EXPORT_JSON),
            )
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
                style = helmType.small,
                color = if (status is ExportStatus.Failed) p.danger else p.success,
                modifier = Modifier
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .testTag(SettingsTags.EXPORT_STATUS),
            )
        }
    }
}

@Composable
internal fun AboutSection(versionName: String, actions: SettingsActions) {
    CardSection(stringResource(R.string.settings_about)) {
        Text(stringResource(R.string.settings_version, versionName), style = helmType.bodyStrong, color = palette.text)
        Hint(stringResource(R.string.about_text))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextAction(stringResource(R.string.about_license), actions::openLicense, Modifier.testTag(SettingsTags.LICENSE))
            TextAction(stringResource(R.string.licenses_title), actions::openLicenses, Modifier.testTag(SettingsTags.LICENSES))
        }
    }
}
