package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.Actor
import dev.helm.planner.domain.FieldChange
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.domain.HistoryField
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.task.EditorTags
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.theme.HelmTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TaskDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private val task = Task(
        localId = "a", serverId = "s1", title = "Call the accountant", note = "Ask about VAT",
        dueDate = "2026-10-23", dueTime = "09:30", status = TaskStatus.TODO,
        repeat = RepeatRule(RepeatEvery.DAY), labels = listOf("Helm"),
        links = listOf(TaskLink("https://example.com", "Spec")), createdAt = 0, updatedAt = 0,
    )

    private val history = listOf(
        HistoryEntry(2_000, Actor.AGENT, "update", listOf(FieldChange(HistoryField.TITLE, JsonPrimitive("Call"), JsonPrimitive("Call the accountant")))),
        HistoryEntry(1_000, Actor.APP, "create", emptyList()),
    )

    private class Recorder : TaskDetailActions {
        val calls = mutableListOf<String>()
        override fun rename(localId: String, title: String) { calls += "rename:$title" }
        override fun setRepeat(localId: String, rule: RepeatRule?) { calls += "repeat:$rule" }
        override fun setLabels(localId: String, labels: List<String>) { calls += "labels:$labels" }
        override fun setLinks(localId: String, links: List<TaskLink>) { calls += "links:${links.map { it.url }}" }
        override fun setDue(localId: String, date: String?, time: String?) { calls += "due:$date:$time" }
        override fun move(localId: String, status: TaskStatus) { calls += "move:${status.wire}" }
        override fun moveToTrash(localId: String) { calls += "trash" }
        override fun restore(localId: String) { calls += "restore" }
    }

    private fun show(task: Task = this.task, actions: TaskDetailActions = Recorder(), state: HistoryState = HistoryState.FRESH, pending: Int = 0) {
        val ui = TaskDetailUiState.Ready(task, "2026-10-22", "Europe/Warsaw", history, state, pending, listOf("Helm", "home"))
        compose.setContent { HelmTheme { TaskDetailScreen(ui, actions) } }
    }

    @Test
    fun showsEveryFieldOfTheTask() {
        show()
        compose.onNodeWithTag(TaskDetailTags.TITLE).assertTextContains("Call the accountant").assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(TaskDetailTags.DUE).assertTextContains(text(R.string.day_and_time, text(R.string.day_tomorrow), "09:30"))
        compose.onNodeWithTag(TaskDetailTags.REPEAT).assertTextContains(context.resources.getQuantityString(R.plurals.repeat_days, 1, 1), substring = true)
        compose.onNodeWithContentDescription(text(R.string.remove_label, "Helm")).assertIsDisplayed()
        compose.onNodeWithText("Spec").assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().assertTextContains("Ask about VAT", substring = true)
    }

    @Test
    fun renameGoesThroughADialogAndRefusesAnEmptyTitle() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.TITLE).performClick()
        // The dialog window gets focus a frame or two after it opens.
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag(EditorTags.FIELD).assertIsFocused() }.isSuccess }
        compose.onNodeWithTag(EditorTags.FIELD).performTextInput("!")
        compose.onNodeWithTag(EditorTags.FIELD).assertTextContains("Call the accountant!")
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("   ")
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("Call the tax office")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        assertEquals(listOf("rename:Call the tax office"), actions.calls)
    }

    @Test
    fun repeatLabelsLinksAndStatusAreEditable() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.status(TaskStatus.DOING)).assertHeightIsAtLeast(48.dp).performClick()

        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.every(RepeatEvery.WEEK)).performClick()
        compose.onNodeWithTag(EditorTags.weekday(1)).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(EditorTags.weekday(4)).performClick()
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithText(text(R.string.add_label)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText("home").performClick()

        compose.onNodeWithText(text(R.string.add_link)).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.URL).performTextInput("example.org")
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.URL).performTextReplacement("https://example.org/plan")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithText(text(R.string.remove_due)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()

        assertEquals(
            listOf(
                "move:doing",
                "repeat:${RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 4))}",
                "labels:[Helm, home]",
                "links:[https://example.com, https://example.org/plan]",
                "due:null:null",
            ),
            actions.calls,
        )
    }

    @Test
    fun historySaysWhoChangedWhat() {
        show(pending = 1)
        compose.onNodeWithTag(TaskDetailTags.HISTORY).performScrollTo()
        compose.onNodeWithText(text(R.string.actor_agent)).assertExists()
        compose.onNodeWithText(text(R.string.actor_app)).assertExists()
        compose.onNodeWithText(text(R.string.history_change, text(R.string.field_title), "Call", "Call the accountant")).assertExists()
        compose.onNodeWithText(context.resources.getQuantityString(R.plurals.history_pending, 1, 1)).assertExists()
    }

    @Test
    fun offlineHistoryIsMarkedAsTheLastCopy() {
        show(state = HistoryState.CACHED)
        compose.onNodeWithText(text(R.string.history_cached)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun moveToTrash() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.TRASH).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("trash"), actions.calls)
    }

    @Test
    fun aTaskInTheTrashIsReadOnlyUntilRestored() {
        val trashed = Recorder()
        show(task.copy(deletedAt = System.currentTimeMillis()), trashed)
        compose.onNodeWithTag(TaskDetailTags.TRASH_BANNER).assertIsDisplayed()
        compose.onNodeWithTag(TaskDetailTags.TRASH).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.add_label)).assertDoesNotExist()
        compose.onNodeWithTag(TaskDetailTags.RESTORE).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("restore"), trashed.calls)
    }
}
