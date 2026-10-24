package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.BoardColumns
import dev.helm.planner.ui.board.BoardActions
import dev.helm.planner.ui.board.BoardScreen
import dev.helm.planner.ui.board.BoardTags
import dev.helm.planner.ui.board.BoardUiState
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.ConnectionStatus
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BoardScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private fun task(id: String, status: TaskStatus = TaskStatus.TODO, block: Task.() -> Task = { this }) =
        Task(localId = id, title = "Task $id", status = status, createdAt = 0, updatedAt = 0).block()

    private class Recorder : BoardActions {
        val calls = mutableListOf<String>()
        override fun move(localId: String, status: TaskStatus) { calls += "move:$localId:${status.wire}" }
        override fun setNow(localId: String) { calls += "now:$localId" }
        override fun clearNow() { calls += "clearNow" }
        override fun openTask(localId: String) { calls += "open:$localId" }
        override fun openTrash() { calls += "trash" }
        override fun saveResumeNote(localId: String, note: String) { calls += "resume:$localId:$note" }
    }

    private val columns = BoardColumns(
        date = "2026-10-22",
        todo = listOf(task("a") { copy(dueDate = "2026-10-20", labels = listOf("Dayhand")) }, task("b")),
        doing = listOf(task("n", TaskStatus.DOING) { copy(isNow = true, resumeNote = "page 3") }),
        done = emptyList(),
    )

    private fun show(actions: BoardActions = Recorder(), connection: ConnectionStatus = ConnectionStatus.SYNCED, pending: Int = 0) {
        compose.setContent { HelmTheme { BoardScreen(BoardUiState(columns, connection, pending), actions) } }
    }

    @Test
    fun threeColumnsWithCountsAndLargeTabs() {
        show()
        compose.onNodeWithTag(BoardTags.tab(TaskStatus.TODO))
            .assertTextContains(text(R.string.column_with_count, text(R.string.column_todo), 2))
            .assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(BoardTags.tab(TaskStatus.DOING)).assertTextContains(text(R.string.column_with_count, text(R.string.column_doing), 1))
        compose.onNodeWithTag(BoardTags.tab(TaskStatus.DONE)).assertTextContains(text(R.string.column_with_count, text(R.string.column_done), 0))
        compose.onNodeWithText("Dayhand").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.overdue_due, LocalDate.of(2026, 10, 20).format(DateTimeFormatter.ofPattern("EEE, d MMM", Locale.getDefault()))), substring = true, useUnmergedTree = true).assertExists()
    }

    @Test
    fun theNowTaskLeadsInProgressWithItsResumeNote() {
        val actions = Recorder()
        show(actions)
        compose.onNodeWithTag(BoardTags.tab(TaskStatus.DOING)).performClick()
        compose.onNodeWithTag(BoardTags.NOW).assertIsDisplayed()
        compose.onNodeWithText("page 3").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText(text(R.string.save)).performClick()
        assertEquals(listOf("resume:n:page 3"), actions.calls)
    }

    @Test
    fun aCardMovesFromItsMenuWithoutDragging() {
        val actions = Recorder()
        show(actions)
        compose.onNodeWithContentDescription(text(R.string.more_actions, "Task a")).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText(text(R.string.move_to_column, text(R.string.column_doing))).performClick()
        compose.onNodeWithContentDescription(text(R.string.more_actions, "Task b")).performClick()
        compose.onNodeWithText(text(R.string.set_now)).performClick()
        assertEquals(listOf("move:a:doing", "now:b"), actions.calls)
    }

    @Test
    fun screenReadersGetTheMovesAsActions() {
        val actions = Recorder()
        show(actions)
        val node = compose.onNodeWithTag(BoardTags.card("a")).fetchSemanticsNode()
        val custom = node.config.getOrNull(SemanticsActions.CustomActions).orEmpty()
        val labels = custom.map { it.label }
        assertTrue(labels.contains(text(R.string.move_to_column, text(R.string.column_done))))
        compose.runOnUiThread { custom.first { it.label == text(R.string.move_to_column, text(R.string.column_done)) }.action.invoke() }
        assertEquals(listOf("move:a:done"), actions.calls)
        assertTrue("tapping a card opens it", node.config.getOrNull(SemanticsActions.OnClick) != null)
    }

    @Test
    fun tappingACardOpensItsDetails() {
        val actions = Recorder()
        show(actions)
        compose.onNodeWithText("Task b").performClick()
        assertEquals(listOf("open:b"), actions.calls)
    }

    @Test
    fun longPressAndDragOntoAnotherColumnMovesTheCard() {
        val actions = Recorder()
        show(actions)
        val card = compose.onNodeWithTag(BoardTags.card("b")).fetchSemanticsNode().boundsInRoot
        val target = compose.onNodeWithTag(BoardTags.tab(TaskStatus.DONE)).fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag(BoardTags.card("b")).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 200)
            val to = target.center - card.topLeft
            val steps = 10
            repeat(steps) { i -> moveTo(center + (to - center) * ((i + 1f) / steps)) }
            up()
        }
        compose.waitForIdle()
        assertEquals(listOf("move:b:done"), actions.calls)
    }

    @Test
    fun theBoardWorksOfflineAndSaysSo() {
        show(connection = ConnectionStatus.OFFLINE, pending = 2)
        compose.onNodeWithTag(BoardTags.STATUS).assertTextContains(text(R.string.status_offline, 2))
        compose.onNodeWithContentDescription(text(R.string.trash_title)).assertHeightIsAtLeast(48.dp)
    }
}
