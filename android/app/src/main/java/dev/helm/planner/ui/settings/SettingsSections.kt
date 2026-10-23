package dev.helm.planner.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.notify.AndroidNotifier
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.ui.components.HelmChip
import dev.helm.planner.ui.components.IconTone
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.Pill
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.SegmentOption
import dev.helm.planner.ui.components.Segmented
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.DateTimeException
import java.time.LocalTime

/** Offered reminder offsets in minutes; values set elsewhere (e.g. by the agent) are shown too. */
val REMINDER_OPTIONS = listOf(0, 5, 10, 15, 30, 60, 120, 1440)

/** A muted line in a section, under its rows. */
@Composable
internal fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = helmType.small, color = palette.textMuted, modifier = modifier)
}

/** "On" or "Off" as a small pill in the state colour, so a permission reads at a glance, not from a sentence. */
@Composable
internal fun StatePill(on: Boolean, offTone: IconTone = IconTone.Danger) {
    val p = palette
    val color = when {
        on -> p.success
        offTone == IconTone.Warning -> p.warning
        else -> p.danger
    }
    Pill(stringResource(if (on) R.string.settings_state_on else R.string.settings_state_off), color)
}

/**
 * Notifications and exact alarms, one row each: the state as an icon and a pill, what it means under the name and,
 * while something is missing, the one button that fixes it (both buttons the same width).
 */
@Composable
internal fun NotificationsSection(access: NotificationAccess, exactAlarms: Boolean, actions: SettingsActions) {
    val p = palette
    val allowed = access == NotificationAccess.ALLOWED
    ListGroup(
        stringResource(R.string.settings_notifications),
        rows = listOf(
            {
                ListRow(
                    stringResource(R.string.settings_notifications_title),
                    tag = SettingsTags.NOTIFICATIONS_ROW,
                    icon = if (allowed) Icons.Filled.Notifications else SettingsIcons.NotificationsOff,
                    tone = if (allowed) IconTone.Success else IconTone.Danger,
                    subtitle = stringResource(if (allowed) R.string.settings_notifications_on else R.string.settings_notifications_off),
                    badge = { StatePill(allowed) },
                    below = if (allowed) {
                        null
                    } else {
                        {
                            SecondaryButton(
                                stringResource(
                                    if (access == NotificationAccess.ASK) R.string.settings_notifications_allow else R.string.settings_open_system,
                                ),
                                onClick = actions::allowNotifications,
                                color = p.accent,
                                modifier = Modifier.fillMaxWidth().testTag(SettingsTags.NOTIFICATIONS),
                            )
                        }
                    },
                )
            },
            {
                ListRow(
                    stringResource(R.string.settings_exact_title),
                    tag = SettingsTags.EXACT_ROW,
                    icon = SettingsIcons.Alarm,
                    tone = if (exactAlarms) IconTone.Success else IconTone.Warning,
                    subtitle = stringResource(if (exactAlarms) R.string.settings_exact_on else R.string.settings_exact_off),
                    badge = { StatePill(exactAlarms, offTone = IconTone.Warning) },
                    below = if (exactAlarms) {
                        null
                    } else {
                        {
                            SecondaryButton(
                                stringResource(R.string.settings_exact_allow),
                                onClick = actions::allowExactAlarms,
                                color = p.accent,
                                modifier = Modifier.fillMaxWidth().testTag(SettingsTags.EXACT),
                            )
                        }
                    },
                )
            },
        ),
    )
}

/** The summary time as a value chip at the end of its row; the whole row opens the clock. */
@Composable
internal fun SummarySection(summaryTime: String, onPick: (String) -> Unit) {
    val p = palette
    var picking by rememberSaveable { mutableStateOf(false) }
    ListGroup(
        stringResource(R.string.settings_summary),
        rows = listOf {
            ListRow(
                stringResource(R.string.settings_summary_time),
                tag = SettingsTags.SUMMARY_TIME,
                icon = SettingsIcons.Sunny,
                subtitle = stringResource(R.string.settings_summary_hint),
                onClick = { picking = true },
                clickLabel = stringResource(R.string.settings_summary_change),
                chevron = false,
                trailing = {
                    Text(
                        summaryTime,
                        style = helmType.title,
                        color = p.accent,
                        modifier = Modifier.background(p.accentSoft, HelmShapes.pill).padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                },
            )
        },
    )
    if (picking) {
        val initial = try {
            LocalTime.parse(summaryTime)
        } catch (_: DateTimeException) {
            LocalTime.of(5, 0)
        }
        TimePickerDialog(initial = initial, onDismiss = { picking = false }, onPick = { picking = false; onPick(it) })
    }
}

/** The offered offsets as chips under a row that says which tasks ring. */
@Composable
internal fun RemindersSection(minutes: List<Int>, onChange: (List<Int>) -> Unit) {
    val resources = LocalResources.current
    ListGroup(
        stringResource(R.string.settings_reminders),
        rows = listOf {
            Column {
                ListRow(
                    stringResource(R.string.settings_reminders_title),
                    tag = SettingsTags.REMINDERS_ROW,
                    icon = SettingsIcons.Schedule,
                    subtitle = stringResource(R.string.settings_reminders_hint),
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().padding(start = HelmDimens.rowPadding, end = HelmDimens.rowPadding, bottom = 16.dp),
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
                if (minutes.isEmpty()) {
                    Hint(
                        stringResource(R.string.settings_reminders_none),
                        Modifier.padding(start = HelmDimens.rowPadding, end = HelmDimens.rowPadding, bottom = 16.dp),
                    )
                }
            }
        },
    )
}

@Composable
internal fun LanguageSection(language: AppLanguage?, onChange: (AppLanguage) -> Unit) {
    ListGroup(
        stringResource(R.string.settings_language),
        rows = listOf {
            Column {
                ListRow(
                    stringResource(R.string.settings_language_title),
                    tag = SettingsTags.LANGUAGE_ROW,
                    icon = SettingsIcons.Language,
                    subtitle = if (language == null) stringResource(R.string.settings_language_unsupported) else null,
                )
                if (language != null) {
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
                        modifier = Modifier.padding(start = HelmDimens.rowPadding, end = HelmDimens.rowPadding, bottom = 16.dp),
                    )
                }
            }
        },
    )
}
