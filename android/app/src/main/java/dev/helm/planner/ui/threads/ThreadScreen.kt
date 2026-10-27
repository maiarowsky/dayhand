package dev.helm.planner.ui.threads

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.Threads
import dev.helm.planner.domain.Threads.Field
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.PrimaryButton
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.components.TextAction
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** The summary first, it is what a finished thread asks the owner to read; then the four lines in the assistant's order. */
private val fieldOrder = listOf(Field.SUMMARY, Field.STATE, Field.DONE, Field.ASK, Field.CHECK)

/**
 * One thread: its note in sections (or as it is when it does not follow the format), links that open, and
 * "Got it, close the thread", which asks once more before it completes the task. [task] is null once the task is gone.
 */
@Composable
fun ThreadScreen(task: Task?, now: Long, onClose: (String) -> Unit, onOpenTask: (String) -> Unit, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(palette.background)) {
        ScreenHeader(stringResource(R.string.threads_title), onBack = onBack)
        if (task == null) {
            Text(stringResource(R.string.detail_missing), style = helmType.body, color = palette.textMuted, modifier = Modifier.padding(HelmDimens.screenMargin))
            return@Column
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .padding(start = HelmDimens.screenMargin, end = HelmDimens.screenMargin, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap)) {
            ThreadBody(Threads.thread(task), now, onClose, onOpenTask)
        }
    }
}

@Composable
private fun ThreadBody(thread: Threads.Thread, now: Long, onClose: (String) -> Unit, onOpenTask: (String) -> Unit) {
    val task = thread.task
    val groupName = stringResource(when (thread.group) {
        Threads.Group.TO_CONFIRM -> R.string.thread_group_confirm
        Threads.Group.WAITING -> R.string.thread_group_waiting
        Threads.Group.IN_PROGRESS -> R.string.thread_group_progress
    })
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(thread.topic, style = helmType.screenTitle, color = palette.text, modifier = Modifier.semantics { heading() })
        Text("$groupName · ${stringResource(R.string.thread_last_change, ageLabel(Threads.age(task.updatedAt, now)))}",
            style = helmType.small, color = palette.textMuted)
    }
    val note = thread.note
    if (note == null) {
        CardSection(stringResource(R.string.thread_note)) {
            task.note?.takeIf { it.isNotBlank() }?.let { LinkedText(it) }
                ?: Text(stringResource(R.string.thread_no_note), style = helmType.body, color = palette.textMuted)
        }
    } else {
        note.intro?.let { HelmCard { LinkedText(it) } }
        fieldOrder.forEach { field ->
            val value = note[field] ?: return@forEach
            CardSection(stringResource(fieldTitle(field)), Modifier.testTag(ThreadTags.field(field))) {
                if (value.isBlank()) Text(stringResource(R.string.thread_field_empty), style = helmType.body, color = palette.textMuted)
                else LinkedText(value)
            }
        }
    }
    TextAction(stringResource(R.string.thread_open_task), { onOpenTask(task.localId) }, Modifier.testTag(ThreadTags.OPEN_TASK))
    if (task.status == TaskStatus.DONE) {
        Text(stringResource(R.string.thread_closed), style = helmType.body, color = palette.textMuted)
    } else CloseThread(thread, onClose)
}

@Composable
private fun CloseThread(thread: Threads.Thread, onClose: (String) -> Unit) {
    var asking by rememberSaveable { mutableStateOf(false) }
    val label = stringResource(R.string.thread_close)
    val modifier = Modifier.padding(top = 12.dp).testTag(ThreadTags.CLOSE)
    // Prominent once the assistant has finished; otherwise a quieter button, as closing early is the exception.
    if (thread.group == Threads.Group.TO_CONFIRM) PrimaryButton(label, { asking = true }, modifier)
    else SecondaryButton(label, { asking = true }, modifier.fillMaxWidth())
    if (asking) HelmDialog(
        title = stringResource(R.string.thread_close_title),
        onDismiss = { asking = false },
        confirm = stringResource(R.string.thread_close_confirm),
        onConfirm = { asking = false; onClose(thread.task.localId) },
        dismiss = stringResource(R.string.cancel),
        confirmTag = ThreadTags.CLOSE_CONFIRM,
    ) { Text(stringResource(R.string.thread_close_body, thread.topic), style = helmType.body) }
}

private fun fieldTitle(field: Field): Int = when (field) {
    Field.STATE -> R.string.thread_field_state
    Field.DONE -> R.string.thread_field_done
    Field.ASK -> R.string.thread_field_ask
    Field.CHECK -> R.string.thread_field_check
    Field.SUMMARY -> R.string.thread_field_summary
}

/** [text] as written, with its http(s) links underlined in the link colour; a tap opens them in the browser. */
@Composable
private fun LinkedText(text: String, style: TextStyle = helmType.body, color: Color = palette.text) {
    val linkStyle = TextLinkStyles(SpanStyle(color = palette.link, textDecoration = TextDecoration.Underline))
    val annotated = buildAnnotatedString {
        var at = 0
        Threads.links(text).forEach { range ->
            append(text.substring(at, range.first))
            val url = text.substring(range)
            withLink(LinkAnnotation.Url(url, linkStyle)) { append(url) }
            at = range.last + 1
        }
        append(text.substring(at))
    }
    Text(annotated, style = style, color = color, modifier = Modifier.fillMaxWidth())
}
