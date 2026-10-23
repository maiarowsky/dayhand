package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object CalendarFeedTags {
    const val PAGE = "calendar_feed_page"
    const val TURN_ON = "calendar_feed_turn_on"
    const val ADDRESS = "calendar_feed_address"
    const val COPY = "calendar_feed_copy"
    const val GOOGLE = "calendar_feed_google"
    const val APPLE = "calendar_feed_apple"
    const val ROTATE = "calendar_feed_rotate"
    const val TURN_OFF = "calendar_feed_turn_off"
    const val CONFIRM = "calendar_feed_confirm"
    const val EXPORT = "calendar_feed_export"
    const val STATUS = "calendar_feed_status"
}

/** What the page can do; the route turns them into the clipboard, the browser and the share sheet. */
interface CalendarFeedActions {
    fun turnOn() {}
    fun copy() {}
    fun openGoogle() {}
    fun shareApple() {}
    fun rotate() {}
    fun turnOff() {}
    fun export() {}
    fun retry() {}
}

private enum class Confirm { ROTATE, OFF }

/**
 * Settings → Calendar, laid out like the other pages: the address with what to do with it, then managing it (a new
 * address, off, each confirmed first) and a one-time .ics file. The address is shown in full because it is the
 * thing to copy; the page says that it is secret.
 */
@Composable
fun CalendarFeedPage(ui: CalendarFeedUiState, actions: CalendarFeedActions, onBack: () -> Unit) {
    var confirm by rememberSaveable { mutableStateOf<Confirm?>(null) }
    SettingsPage(stringResource(R.string.calendar_feed_title), onBack, CalendarFeedTags.PAGE) {
        ListNote(stringResource(R.string.calendar_feed_intro))
        when (val feed = ui.feed) {
            FeedView.Loading -> ListGroup(null, listOf { BusyRow(stringResource(R.string.calendar_feed_loading)) })
            FeedView.NotConnected -> ListGroup(null, listOf { StatusRow(stringResource(R.string.calendar_feed_not_connected)) })
            is FeedView.Failed -> ListGroup(
                null,
                listOf(
                    { StatusRow(stringResource(if (feed.unauthorized) R.string.calendar_feed_unauthorized else R.string.calendar_feed_failed)) },
                    { ListRow(stringResource(R.string.calendar_feed_retry), "calendar_feed_retry", icon = LineIcon.Refresh, onClick = actions::retry) },
                ),
            )
            FeedView.Off -> ListGroup(
                null,
                listOf {
                    ListRow(
                        stringResource(R.string.calendar_feed_turn_on),
                        CalendarFeedTags.TURN_ON,
                        icon = LineIcon.Calendar,
                        enabled = !ui.busy,
                        onClick = actions::turnOn,
                    )
                },
            )
            is FeedView.On -> FeedRows(ui, feed, actions) { confirm = it }
        }
        if (ui.changeFailed) ListGroup(null, listOf { StatusRow(stringResource(R.string.calendar_feed_failed)) })
        if (ui.feed !is FeedView.NotConnected) ExportRows(ui.export, actions)
    }
    when (confirm) {
        Confirm.ROTATE -> HelmDialog(
            stringResource(R.string.calendar_feed_rotate_confirm_title),
            onDismiss = { confirm = null },
            confirm = stringResource(R.string.calendar_feed_rotate),
            onConfirm = {
                confirm = null
                actions.rotate()
            },
            dismiss = stringResource(R.string.cancel),
            destructive = true,
            confirmTag = CalendarFeedTags.CONFIRM,
        ) { Text(stringResource(R.string.calendar_feed_rotate_confirm), style = helmType.body) }
        Confirm.OFF -> HelmDialog(
            stringResource(R.string.calendar_feed_off_confirm_title),
            onDismiss = { confirm = null },
            confirm = stringResource(R.string.calendar_feed_turn_off),
            onConfirm = {
                confirm = null
                actions.turnOff()
            },
            dismiss = stringResource(R.string.cancel),
            destructive = true,
            confirmTag = CalendarFeedTags.CONFIRM,
        ) { Text(stringResource(R.string.calendar_feed_off_confirm), style = helmType.body) }
        null -> Unit
    }
}

@Composable
private fun FeedRows(ui: CalendarFeedUiState, feed: FeedView.On, actions: CalendarFeedActions, ask: (Confirm) -> Unit) {
    val p = palette
    ListGroup(
        stringResource(R.string.calendar_feed_address),
        listOf(
            {
                // The whole address, selectable, in a monospace face so look-alike characters differ.
                SelectionContainer {
                    Text(
                        feed.feed.url,
                        style = helmType.small.copy(fontFamily = FontFamily.Monospace),
                        color = p.text,
                        modifier = Modifier.padding(horizontal = HelmDimens.rowPadding, vertical = 14.dp).testTag(CalendarFeedTags.ADDRESS),
                    )
                }
            },
            {
                ListRow(
                    stringResource(if (ui.copied) R.string.calendar_feed_copied else R.string.calendar_feed_copy),
                    CalendarFeedTags.COPY,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    icon = if (ui.copied) LineIcon.Check else LineIcon.Copy,
                    chevron = false,
                    onClick = actions::copy,
                )
            },
            { ListRow(stringResource(R.string.calendar_feed_google), CalendarFeedTags.GOOGLE, icon = LineIcon.Globe, onClick = actions::openGoogle) },
            { ListRow(stringResource(R.string.calendar_feed_apple), CalendarFeedTags.APPLE, icon = LineIcon.Share, onClick = actions::shareApple) },
        ),
    )
    ListNote(stringResource(R.string.calendar_feed_secret))
    ListNote(stringResource(R.string.calendar_feed_google_note))
    ListNote(stringResource(R.string.calendar_feed_apple_note))
    ListGroup(
        stringResource(R.string.calendar_feed_manage),
        listOfNotNull(
            if (ui.rotated) ({ StatusRow(stringResource(R.string.calendar_feed_rotate_done), LineIcon.Check) }) else null,
            {
                ListRow(
                    stringResource(R.string.calendar_feed_rotate),
                    CalendarFeedTags.ROTATE,
                    icon = LineIcon.Refresh,
                    enabled = !ui.busy,
                    chevron = false,
                    onClick = { ask(Confirm.ROTATE) },
                )
            },
            {
                ListRow(
                    stringResource(R.string.calendar_feed_turn_off),
                    CalendarFeedTags.TURN_OFF,
                    icon = LineIcon.CloudOff,
                    titleColor = p.danger,
                    enabled = !ui.busy,
                    chevron = false,
                    onClick = { ask(Confirm.OFF) },
                )
            },
        ),
    )
}

@Composable
private fun ExportRows(export: IcsExport, actions: CalendarFeedActions) {
    val rows = buildList<@Composable () -> Unit> {
        add {
            ListRow(
                stringResource(R.string.calendar_feed_export),
                CalendarFeedTags.EXPORT,
                icon = LineIcon.Download,
                enabled = export != IcsExport.Working,
                chevron = false,
                onClick = actions::export,
            )
        }
        when (export) {
            IcsExport.Working -> add { BusyRow(stringResource(R.string.calendar_feed_exporting)) }
            IcsExport.Failed -> add { StatusRow(stringResource(R.string.calendar_feed_export_failed)) }
            else -> Unit
        }
    }
    ListGroup(stringResource(R.string.calendar_feed_export_group), rows)
    ListNote(stringResource(R.string.calendar_feed_export_note))
}

/** A state in words, read out when it appears. */
@Composable
private fun StatusRow(text: String, icon: LineIcon = LineIcon.Warning) {
    ListRow(text, CalendarFeedTags.STATUS, modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }, icon = icon)
}

@Composable
private fun BusyRow(text: String) {
    val p = palette
    ListRow(
        text,
        CalendarFeedTags.STATUS,
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        titleColor = p.textMuted,
        trailing = { CircularProgressIndicator(color = p.accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp)) },
    )
}
