package dev.helm.planner.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.task.EditorTags
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The note's full-screen editor on a phone, with the real keyboard. */
@RunWith(AndroidJUnit4::class)
class NoteEditorTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val note = "Ask about VAT.\nBring the invoices from October and the receipts from the trip."
    private val task = Task("a", title = "Call the accountant", note = note, createdAt = 0, updatedAt = 0)
    private val saved = mutableListOf<String>()

    private fun open() {
        val ui = TaskDetailUiState.Ready(task, "2026-10-22", "Europe/Warsaw", emptyList(), HistoryState.FRESH, 0, emptyList())
        val actions = object : TaskDetailActions {
            override fun setNote(localId: String, note: String) { saved += note }
        }
        compose.setContent { HelmTheme { TaskDetailScreen(ui, actions) } }
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().performClick()
        // The dialog window gets focus a frame or two after it opens.
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag(EditorTags.FIELD).assertIsFocused() }.isSuccess }
    }

    @Test
    fun fillsTheWidthAndKeepsCancelAndSaveAboveTheKeyboard() {
        open()
        val field = compose.onNodeWithTag(EditorTags.FIELD).getBoundsInRoot()
        val screen = context.resources.configuration.screenWidthDp.dp
        assertTrue("the field is ${field.right - field.left} of $screen", field.right - field.left >= screen * 0.9f)
        // Wait for the keyboard: the field ends above it, the bar stays on top.
        compose.waitUntil(5_000) { compose.onNodeWithTag(EditorTags.FIELD).getBoundsInRoot().bottom < field.bottom }
        compose.onNodeWithTag(EditorTags.SAVE).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.cancel)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.edit_note)).assertIsDisplayed()
    }

    @Test
    fun typesAfterTheTextAndSavesOnlyWithSave() {
        open()
        compose.onNodeWithTag(EditorTags.FIELD).performTextInput(" And the car.")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        assertEquals(listOf("$note And the car."), saved)
    }

    @Test
    fun backCancelsWithoutSaving() {
        open()
        compose.onNodeWithTag(EditorTags.FIELD).performTextInput(" Not this.")
        Espresso.closeSoftKeyboard()
        Espresso.pressBack()
        compose.onNodeWithTag(EditorTags.LONG_TEXT).assertDoesNotExist()
        assertEquals(emptyList<String>(), saved)
        compose.onNodeWithTag(TaskDetailTags.NOTE).performClick()
        // Opened again, it shows the note as saved, not the dropped edit.
        val text = compose.onNodeWithTag(EditorTags.FIELD).fetchSemanticsNode().config[SemanticsProperties.EditableText].text
        assertEquals(note, text)
    }
}
