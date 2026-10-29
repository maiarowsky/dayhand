package dev.helm.planner.ui.task

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.Actor
import dev.helm.planner.domain.FieldChange
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.domain.HistoryField
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectUiContext
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.HelmTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * An open task with a long note, a checklist and five history entries on a small phone (360 × 780 dp): the note
 * starts higher than in 0.13.3, the history is right under it, and the note is edited in a sheet of most of the screen.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "pl-w360dp-h780dp")
class TaskDetailFirstScreenTest {
    @get:Rule val compose = createComposeRule()

    private val note = (1..12).joinToString("\n") { "Akapit $it notatki z kilkoma słowami, żeby zajął jeden lub dwa wiersze." }
    private val task = Task(
        "task",
        title = "Wklej poprawkę firmowego profilu i sprawdź, czy wszystkie linki działają",
        note = note,
        dueDate = "2026-10-27",
        projectId = "work",
        checklist = listOf(ChecklistItem("a", "Pierwsza"), ChecklistItem("b", "Druga", true)),
        createdAt = 0,
        updatedAt = 0,
    )
    private val project = Project("work", serverId = "work", name = "Firma", color = "amber", position = 0.0, createdAt = 0, updatedAt = 0)
    private val history = (5 downTo 1).map {
        HistoryEntry(it * 1_000_000L, Actor.APP, "update", listOf(FieldChange(HistoryField.TITLE, JsonPrimitive("old $it"), JsonPrimitive("new $it"))))
    }
    private val saved = mutableListOf<String>()

    private fun show(font: HelmFont = HelmFont.Default, scale: Float = 1f) {
        val shown = mutableStateOf(task)
        val actions = object : TaskDetailActions {
            override fun setNote(localId: String, note: String) {
                saved += note
                shown.value = shown.value.copy(note = note)
            }
        }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density.density, scale),
                LocalProjects provides ProjectUiContext(listOf(project)),
            ) {
                val state = TaskDetailUiState.Ready(shown.value, "2026-10-28", "UTC", history, HistoryState.FRESH, 0, listOf(0))
                HelmTheme(Appearance(font = font)) { TaskDetailScreen(state, actions) }
            }
        }
    }

    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).getBoundsInRoot()

    private fun assertNoteHigher(font: HelmFont, scale: Float, before: Dp) {
        show(font, scale)
        val top = bounds(TaskDetailTags.NOTE).top
        assertTrue("the note starts at $top, was $before", top < before)
    }

    @Test fun theNoteStartsHigherThanBeforeInTheDefaultFont() {
        assertNoteHigher(HelmFont.Default, 1f, BEFORE_DEFAULT)
        // Its label and at least two lines without scrolling.
        assertTrue(bounds(TaskDetailTags.NOTE).top + 64.dp <= FIRST_SCREEN)
    }

    @Test fun theNoteStartsHigherThanBeforeInTheMonospacedFont() {
        assertNoteHigher(HelmFont.Mono, 1f, BEFORE_MONO)
        assertTrue(bounds(TaskDetailTags.NOTE).top + 64.dp <= FIRST_SCREEN)
    }

    @Test fun theNoteStartsHigherThanBeforeAt130Percent() = assertNoteHigher(HelmFont.Default, 1.3f, BEFORE_DEFAULT_130)

    @Test fun theHistoryShowsTheLastThreeEntriesAndTheRestOnATap() {
        show()
        compose.onNodeWithTag(TaskDetailTags.HISTORY).performScrollTo()
        listOf(5, 4, 3).forEach { compose.onNodeWithText("new $it", substring = true).assertExists() }
        listOf(2, 1).forEach { compose.onNodeWithText("new $it", substring = true).assertDoesNotExist() }
        compose.onNodeWithTag(TaskDetailTags.HISTORY_MORE).performScrollTo().performClick()
        listOf(2, 1).forEach { compose.onNodeWithText("new $it", substring = true).assertExists() }
        compose.onNodeWithTag(TaskDetailTags.HISTORY_MORE).assertTextContains("Zwiń")
    }

    @Test
    @Config(qualifiers = "pl-w360dp-h3000dp")
    fun theHistoryIsAShortScrollUnderTheNote() {
        show()
        val history = bounds(TaskDetailTags.HISTORY).top
        assertTrue("the history starts ${history - bounds(TaskDetailTags.NOTE).bottom} under the note", history - bounds(TaskDetailTags.NOTE).bottom <= 80.dp)
        assertTrue("the history starts at $history, was $BEFORE_HISTORY", history < BEFORE_HISTORY - 300.dp)
    }

    @Test fun theNoteIsEditedInASheetOfMostOfTheScreen() {
        show()
        compose.onNodeWithTag(TaskDetailTags.NOTE).performClick()
        val sheet = bounds(EditorTags.LONG_TEXT)
        assertTrue("the sheet is ${sheet.right - sheet.left} wide", sheet.right - sheet.left >= 360.dp * 0.95f)
        assertTrue("the sheet is ${sheet.bottom - sheet.top} high", sheet.bottom - sheet.top >= 780.dp * 0.85f)
        listOf(EditorTags.CANCEL, EditorTags.SAVE).forEach { tag ->
            compose.onNodeWithTag(tag).assertIsDisplayed()
            assertTrue("$tag is above the field", bounds(tag).bottom <= bounds(EditorTags.FIELD).top)
        }
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("Nowa notatka")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        compose.onNodeWithTag(EditorTags.LONG_TEXT).assertDoesNotExist()
        assertEquals(listOf("Nowa notatka"), saved)
    }

    @Test fun cancelClosesTheSheetWithoutSaving() {
        show()
        compose.onNodeWithTag(TaskDetailTags.NOTE).performClick()
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("Nie zapisuj")
        compose.onNodeWithTag(EditorTags.CANCEL).performClick()
        compose.onNodeWithTag(EditorTags.LONG_TEXT).assertDoesNotExist()
        assertEquals(emptyList<String>(), saved)
    }

    private companion object {
        /** The test window has no status or navigation bar; a phone keeps about 48 dp for them. */
        val FIRST_SCREEN = 780.dp - 48.dp

        /** Where this task's note started in 0.13.3 (main before this change), measured the same way. */
        val BEFORE_DEFAULT = 444.dp
        val BEFORE_MONO = 446.dp
        val BEFORE_DEFAULT_130 = 524.dp

        /** Where its history started in 0.13.3, after the checklist and the links (window 3000 dp high). */
        val BEFORE_HISTORY = 1195.dp
    }
}
