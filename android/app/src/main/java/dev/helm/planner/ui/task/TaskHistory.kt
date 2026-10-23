package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.Actor
import dev.helm.planner.domain.FieldChange
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.domain.HistoryField
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dayLabel
import dev.helm.planner.ui.common.reminderLabel
import dev.helm.planner.ui.common.repeatLabel
import dev.helm.planner.ui.common.statusLabel
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.Pill
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Who changed what and when, newest first; changes still in the outbox are counted, not listed. */
@Composable
fun HistorySection(state: TaskDetailUiState.Ready) {
    val today = LocalDate.parse(state.today)
    CardSection(stringResource(R.string.detail_history), Modifier.testTag(TaskDetailTags.HISTORY)) {
        if (state.pendingChanges > 0) Placeholder(pluralStringResource(R.plurals.history_pending, state.pendingChanges, state.pendingChanges))
        when (state.historyState) {
            HistoryState.NOT_ON_SERVER_YET -> Placeholder(stringResource(R.string.history_not_on_server))
            HistoryState.CACHED -> Placeholder(stringResource(R.string.history_cached))
            HistoryState.LOADING, HistoryState.FRESH -> Unit
        }
        if (state.history.isEmpty() && state.historyState != HistoryState.NOT_ON_SERVER_YET) {
            if (state.historyState != HistoryState.LOADING) Placeholder(stringResource(R.string.history_empty))
        }
        state.history.forEach { HistoryRow(it, state.timezone, today) }
    }
}

@Composable
private fun HistoryRow(entry: HistoryEntry, timezone: String, today: LocalDate) {
    val at = Instant.ofEpochMilli(entry.at).atZone(HelmDates.zone(timezone))
    val time = stringResource(R.string.day_and_time, dayLabel(at.toLocalDate(), today), at.format(DateTimeFormatter.ofPattern("HH:mm", appLocale())))
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActorBadge(entry.actor)
            Text(time, style = helmType.small, color = palette.textMuted)
        }
        Text(actionLabel(entry.action), style = helmType.bodyStrong, color = palette.text)
        entry.changes.forEach { change ->
            Text(changeLabel(change, today), style = helmType.small, color = palette.textMuted)
        }
    }
}

/** "You (app)", "You (CLI)" or "Agent"; the agent in the palette's attention colour, the person in its secondary. */
@Composable
private fun ActorBadge(actor: Actor) {
    val agent = actor == Actor.AGENT
    val label = when (actor) {
        Actor.APP -> R.string.actor_app
        Actor.CLI -> R.string.actor_cli
        Actor.AGENT -> R.string.actor_agent
    }
    Pill(stringResource(label), color = if (agent) palette.attention else palette.secondary)
}

@Composable
private fun actionLabel(action: String): String = when (action) {
    "create" -> stringResource(R.string.action_create)
    "update" -> stringResource(R.string.action_update)
    "setStatus" -> stringResource(R.string.action_status)
    "setNow" -> stringResource(R.string.action_now)
    "complete" -> stringResource(R.string.action_complete)
    "archive" -> stringResource(R.string.action_archive)
    "delete" -> stringResource(R.string.action_delete)
    "restore" -> stringResource(R.string.action_restore)
    "repeat" -> stringResource(R.string.action_repeat)
    else -> action
}

@Composable
private fun changeLabel(change: FieldChange, today: LocalDate): String {
    val name = stringResource(
        when (change.field) {
            HistoryField.TITLE -> R.string.field_title
            HistoryField.STATUS -> R.string.detail_status
            HistoryField.NOW -> R.string.section_now
            HistoryField.DUE_DATE -> R.string.field_day
            HistoryField.DUE_TIME -> R.string.quick_add_time
            HistoryField.REPEAT -> R.string.detail_repeat
            HistoryField.LABELS -> R.string.detail_labels
            HistoryField.LINKS -> R.string.detail_links
            HistoryField.CHECKLIST -> R.string.detail_checklist
            HistoryField.REMINDERS -> R.string.detail_reminders
            HistoryField.NOTE -> R.string.quick_add_note
            HistoryField.RESUME_NOTE -> R.string.resume_label
        },
    )
    return stringResource(R.string.history_change, name, valueLabel(change.field, change.before, today), valueLabel(change.field, change.after, today))
}

/** A field's value as text; long notes are cut, unknown shapes shown as they came. */
@Composable
private fun valueLabel(field: HistoryField, value: JsonElement, today: LocalDate): String {
    // No own reminders means the defaults from Settings, unlike an empty list.
    if (field == HistoryField.REMINDERS && value is JsonNull) return stringResource(R.string.reminders_mode_default)
    if (value is JsonNull || (value is JsonArray && value.isEmpty())) return stringResource(R.string.history_none)
    val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
    return when (field) {
        HistoryField.STATUS -> text?.let { statusLabel(TaskStatus.fromWire(it)) }
        HistoryField.NOW -> (value as? JsonPrimitive)?.booleanOrNull?.let { stringResource(if (it) R.string.yes else R.string.no) }
        HistoryField.DUE_DATE -> text?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.let { dayLabel(it, today) }
        HistoryField.REPEAT -> RepeatRule.parse(value)?.let { repeatLabel(it) }
        HistoryField.LABELS -> (value as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }?.joinToString(", ")
        HistoryField.LINKS -> decode(value, ListSerializer(TaskLink.serializer()))?.joinToString(", ") { it.title ?: it.url }
        HistoryField.CHECKLIST -> decode(value, ListSerializer(ChecklistItem.serializer()))
            ?.joinToString(", ") { if (it.done) "✓ ${it.title}" else it.title }?.let(::shorten)
        HistoryField.REMINDERS -> (value as? JsonArray)?.mapNotNull(TaskReminder::parse)?.map { reminderLabel(it) }?.joinToString(", ")
        HistoryField.TITLE, HistoryField.DUE_TIME, HistoryField.NOTE, HistoryField.RESUME_NOTE -> text?.let(::shorten)
    } ?: value.toString()
}

private fun shorten(text: String) = if (text.length <= MAX_SHOWN) text else text.take(MAX_SHOWN).trimEnd() + "…"

private fun <T> decode(value: JsonElement, serializer: kotlinx.serialization.KSerializer<T>): T? = try {
    json.decodeFromJsonElement(serializer, value)
} catch (_: SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
}

private val json = Json { ignoreUnknownKeys = true }
private const val MAX_SHOWN = 80
