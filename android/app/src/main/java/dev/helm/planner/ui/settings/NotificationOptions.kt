package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import dev.helm.planner.ui.components.ChoiceRow
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.theme.palette
import dev.helm.planner.ui.today.TimePickerDialog
import java.time.DateTimeException
import java.time.LocalTime

/** Offered reminder offsets in minutes; values set elsewhere (e.g. by the agent) are shown too. */
val REMINDER_OPTIONS = listOf(0, 5, 10, 15, 30, 60, 120, 1440)

/**
 * Notifications and alarms, one after the other as on Mussh's pages: the permission as a row with its state, what the
 * state means under the card and, while it is missing, the button that asks Android or opens its settings.
 */
@Composable
internal fun NotificationsOptions(access: NotificationAccess, exactAlarms: Boolean, actions: SettingsActions) {
    val allowed = access == NotificationAccess.ALLOWED
    ListGroup(
        null,
        rows = listOf {
            ListRow(stringResource(R.string.settings_notifications_title), SettingsTags.NOTIFICATIONS_ROW, icon = LineIcon.Bell, value = onOff(allowed))
        },
    )
    ListNote(stringResource(if (allowed) R.string.settings_notifications_on else R.string.settings_notifications_off))
    if (!allowed) {
        FixButton(
            stringResource(if (access == NotificationAccess.ASK) R.string.settings_notifications_allow else R.string.settings_open_system),
            SettingsTags.NOTIFICATIONS,
            actions::allowNotifications,
        )
    }
    ListGroup(
        null,
        modifier = Modifier.padding(top = 12.dp),
        rows = listOf {
            ListRow(stringResource(R.string.settings_exact_title), SettingsTags.EXACT_ROW, icon = LineIcon.Clock, value = onOff(exactAlarms))
        },
    )
    ListNote(stringResource(if (exactAlarms) R.string.settings_exact_on else R.string.settings_exact_off))
    if (!exactAlarms) FixButton(stringResource(R.string.settings_exact_allow), SettingsTags.EXACT, actions::allowExactAlarms)
}

@Composable
private fun onOff(on: Boolean): String = stringResource(if (on) R.string.settings_state_on else R.string.settings_state_off)

/** The action that fixes a missing permission (Mussh "GhostButton"), the full width of the page. */
@Composable
private fun FixButton(text: String, tag: String, onClick: () -> Unit) {
    SecondaryButton(text, onClick = onClick, color = palette.accent, modifier = Modifier.fillMaxWidth().testTag(tag))
}

/** The summary time as a row that opens the clock, and what the summary holds under it. */
@Composable
internal fun SummaryOptions(summaryTime: String, onPick: (String) -> Unit) {
    var picking by rememberSaveable { mutableStateOf(false) }
    ListGroup(
        null,
        rows = listOf {
            ListRow(
                stringResource(R.string.settings_summary_time),
                SettingsTags.SUMMARY_TIME,
                icon = LineIcon.Sun,
                value = summaryTime,
                onClick = { picking = true },
                clickLabel = stringResource(R.string.settings_summary_change),
            )
        },
    )
    ListNote(stringResource(R.string.settings_summary_hint))
    if (picking) {
        val initial = try {
            LocalTime.parse(summaryTime)
        } catch (_: DateTimeException) {
            LocalTime.of(5, 0)
        }
        TimePickerDialog(initial = initial, onDismiss = { picking = false }, onPick = { picking = false; onPick(it) })
    }
}

/** The offered offsets as rows with a check mark, any number of them; which tasks ring under them. */
@Composable
internal fun RemindersOptions(minutes: List<Int>, onChange: (List<Int>) -> Unit) {
    val options = (REMINDER_OPTIONS + minutes).distinct().sorted()
    ListGroup(
        stringResource(R.string.settings_reminders_title),
        rows = options.map { option ->
            {
                val selected = option in minutes
                ChoiceRow(
                    reminderLabel(option),
                    selected = selected,
                    tag = SettingsTags.REMINDER + option,
                    onSelect = { onChange(if (selected) minutes - option else minutes + option) },
                    multiple = true,
                )
            }
        },
    )
    ListNote(stringResource(R.string.settings_reminders_hint))
    if (minutes.isEmpty()) ListNote(stringResource(R.string.settings_reminders_none))
}

/** "At the due time" or "15 min before". */
@Composable
internal fun reminderLabel(minutes: Int): String {
    val resources = LocalResources.current
    return if (minutes == 0) {
        stringResource(R.string.reminder_at_due)
    } else {
        stringResource(R.string.reminder_before, AndroidNotifier.durationLabel(resources, minutes))
    }
}

/** The app language as a choice of rows (Android 13+); older phones follow the phone's language. */
@Composable
internal fun LanguageOptions(language: AppLanguage?, onChange: (AppLanguage) -> Unit) {
    if (language == null) {
        ListNote(stringResource(R.string.settings_language_unsupported))
        return
    }
    ListGroup(
        stringResource(R.string.settings_language_title),
        rows = AppLanguage.entries.map { option ->
            { ChoiceRow(stringResource(languageName(option)), option == language, SettingsTags.LANGUAGE + option.name, { onChange(option) }) }
        },
    )
}
