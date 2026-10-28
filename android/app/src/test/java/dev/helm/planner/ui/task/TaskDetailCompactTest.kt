package dev.helm.planner.ui.task

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.data.local.TaskStatus
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
import kotlinx.serialization.json.JsonNull
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
 * A finished task as the owner reported it (three-line title, proof, due today, a project, a long note in paragraphs,
 * three history entries) on a small phone (360 × 780 dp): the details are compact and the note's editor is wide.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "pl-w360dp-h780dp")
class TaskDetailCompactTest {
    @get:Rule val compose = createComposeRule()

    // Polish, like the owner's phone and the 0.13.2 measurements below.
    private val note = listOf(
        "Gdzie: skrzynka pomocy, na którą przyszło zgłoszenie z formularza na stronie (przekierowanie z adresu pomocy).",
        "To prawdziwe zgłoszenie: format diagnostyki pochodzi z aplikacji, a błąd jest w kodzie (brak jednej ścieżki " +
            "instalacji). Poprawka jest w pracy lokalnie, bez wydania.",
        "Szkic odpowiedzi (do zatwierdzenia, potem wysyłasz sam):",
        "Hi Sam, thanks for the report and the diagnostics. The app looks for the tool in your login shell and a few " +
            "fixed folders, and the folder you installed it to is not one of them yet. That is my bug. Until I fix it, " +
            "a link in a folder the app already checks works: ln -s /opt/tool/bin/tool ~/.local/bin/tool",
        "Then run the diagnostics again. I will add the folder in the next update. Thanks again!",
    ).joinToString("\n")

    private val task = Task(
        "task",
        title = "Odpowiedz Samowi na zgłoszenie o brakującej ścieżce instalacji narzędzia (adres pomocy na stronie)",
        status = TaskStatus.DONE,
        note = note,
        dueDate = TODAY,
        projectId = "app",
        proof = TaskProof(summary = "Właściciel potwierdził w rozmowie 27.10: pierwsza odpowiedź wysłana."),
        createdAt = 0,
        updatedAt = 0,
    )
    private val project = Project("app", serverId = "app", name = "Aplikacja", color = "amber", position = 0.0, createdAt = 0, updatedAt = 0)
    private val history = listOf(
        HistoryEntry(3_000_000, Actor.AGENT, "complete", listOf(FieldChange(HistoryField.STATUS, JsonPrimitive("todo"), JsonPrimitive("done")))),
        HistoryEntry(2_000_000, Actor.AGENT, "update", listOf(FieldChange(HistoryField.NOTE, JsonNull, JsonPrimitive("Gdzie: skrzynka pomocy")))),
        HistoryEntry(1_000_000, Actor.AGENT, "create", listOf(FieldChange(HistoryField.TITLE, JsonNull, JsonPrimitive(task.title)))),
    )
    private val saved = mutableListOf<String>()
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private fun text(@StringRes id: Int) = context.getString(id)

    private fun show(font: HelmFont = HelmFont.Default, scale: Float = 1f) {
        val shown = mutableStateOf(task)
        val actions = object : TaskDetailActions {
            override fun setNote(localId: String, note: String) {
                saved += note
                shown.value = shown.value.copy(note = note.ifBlank { null })
            }
        }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density.density, scale),
                LocalProjects provides ProjectUiContext(listOf(project)),
            ) {
                val state = TaskDetailUiState.Ready(shown.value, TODAY, "UTC", history, HistoryState.FRESH, 0, emptyList(), listOf(0))
                HelmTheme(Appearance(font = font)) { TaskDetailScreen(state, actions) }
            }
        }
    }

    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).getBoundsInRoot()

    private fun SemanticsNodeInteraction.lines(): Int {
        val layout = mutableListOf<TextLayoutResult>()
        fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layout)
        return layout.single().lineCount
    }

    /** From the top of the card with the status to the end of the project row. */
    private fun statusToProject(font: HelmFont): Dp {
        show(font)
        return bounds("detail-project").bottom - bounds(TaskDetailTags.SUMMARY).top
    }

    @Test fun statusToProjectIsAThirdLowerThanBeforeInTheDefaultFont() {
        val height = statusToProject(HelmFont.Default)
        assertTrue("status to project is $height, was $BEFORE_DEFAULT", height <= BEFORE_DEFAULT * 0.7f)
    }

    @Test fun statusToProjectIsAThirdLowerThanBeforeInTheMonospacedFont() {
        val height = statusToProject(HelmFont.Mono)
        assertTrue("status to project is $height, was $BEFORE_MONO", height <= BEFORE_MONO * 0.7f)
    }

    @Test fun titleStatusDueProjectAndTheStartOfTheNoteAreOnTheFirstScreen() {
        show(HelmFont.Mono)
        listOf(TaskDetailTags.TITLE, TaskDetailTags.status(TaskStatus.DONE), TaskDetailTags.DUE, "detail-project").forEach { tag ->
            compose.onNodeWithTag(tag).assertIsDisplayed()
            assertTrue("$tag ends below the first screen", bounds(tag).bottom <= FIRST_SCREEN)
        }
        // The label and at least two lines of the note.
        assertTrue("the note starts at ${bounds(TaskDetailTags.NOTE).top}", bounds(TaskDetailTags.NOTE).top + 64.dp <= FIRST_SCREEN)
    }

    @Test fun theProofIsShortTextUnderTheStatusInTheTopCard() {
        show()
        compose.onNode(hasTestTag(AgentWorkTags.PROOF) and hasAnyAncestor(hasTestTag(TaskDetailTags.SUMMARY))).assertIsDisplayed()
        val proof = bounds(AgentWorkTags.PROOF)
        assertTrue("the proof is below the status", proof.top >= bounds(TaskDetailTags.status(TaskStatus.DONE)).bottom)
        assertTrue("the proof is above the due day", proof.bottom <= bounds(TaskDetailTags.DUE).top)
        assertTrue("the proof is ${proof.bottom - proof.top} high", proof.bottom - proof.top <= 40.dp)
    }

    @Test fun theDueDayAndItsActionsShareOneRow() {
        show()
        val day = bounds(TaskDetailTags.DUE)
        val time = compose.onNodeWithText(text(R.string.add_time)).getBoundsInRoot()
        val clear = compose.onNodeWithContentDescription(text(R.string.remove_due)).getBoundsInRoot()
        assertEquals(day.top.value, time.top.value, 1f)
        assertEquals(day.top.value, clear.top.value, 1f)
        assertTrue("the cross is ${clear.bottom - clear.top} high", clear.bottom - clear.top >= 48.dp)
    }

    @Test fun aLongNoteFoldsAndUnfoldsWithAnyChangeOneTapAway() {
        show()
        val folded = bounds(TaskDetailTags.NOTE).let { it.bottom - it.top }
        compose.onNodeWithTag(TaskDetailTags.NOTE_MORE).performScrollTo().performClick()
        val whole = bounds(TaskDetailTags.NOTE).let { it.bottom - it.top }
        assertTrue("folded note is $folded, unfolded $whole", whole > folded)
        compose.onNodeWithText(text(R.string.title_show_less)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.LONG_TEXT).assertIsDisplayed()
    }

    @Test fun theRoundedNoteBlockCutsNoLetterInItsCorners() {
        show()
        val block = bounds(TaskDetailTags.NOTE)
        val label = compose.onNodeWithText(text(R.string.quick_add_note), useUnmergedTree = true).getBoundsInRoot()
        val body = compose.onNodeWithText(note, useUnmergedTree = true).getBoundsInRoot()
        // The block is clipped to a 14 dp rounded rectangle: the label starts in its top corner, the last folded
        // line in its bottom one.
        assertInsideCorner("the label", label.left - block.left, label.top - block.top)
        assertInsideCorner("the last line", body.left - block.left, block.bottom - body.bottom)
    }

    private fun assertInsideCorner(what: String, x: Dp, y: Dp) {
        val dx = (NOTE_CORNER - x).coerceAtLeast(0.dp).value
        val dy = (NOTE_CORNER - y).coerceAtLeast(0.dp).value
        assertTrue("$what is $x from the side and $y from the edge", dx * dx + dy * dy <= NOTE_CORNER.value * NOTE_CORNER.value)
    }

    @Test fun anUnfoldedNoteEditedShortOrEmptyLeavesNoFoldButton() {
        show()
        compose.onNodeWithTag(TaskDetailTags.NOTE_MORE).performScrollTo().performClick()
        listOf("Krótko.", "").forEach { short ->
            compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().performClick()
            compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement(short)
            compose.onNodeWithTag(EditorTags.SAVE).performClick()
            compose.onNodeWithTag(TaskDetailTags.NOTE_MORE).assertDoesNotExist()
        }
        assertEquals(listOf("Krótko.", ""), saved)
    }

    @Test fun historyIsFoldedUnderItsNameAlone() {
        show()
        val header = compose.onNodeWithTag("${TaskDetailTags.HISTORY}-header").performScrollTo().assertIsDisplayed()
        val texts = header.fetchSemanticsNode().config[SemanticsProperties.Text].map { it.text }
        assertEquals(listOf(text(R.string.detail_history).uppercase()), texts.map { it.uppercase() })
        compose.onNodeWithTag(TaskDetailTags.HISTORY).assertDoesNotExist()
    }

    @Test fun theNoteEditorUsesTheWholeWidthWithTheCursorAfterTheText() {
        show(HelmFont.Mono)
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().performClick()
        val field = compose.onNodeWithTag(EditorTags.FIELD)
        val width = field.getBoundsInRoot().let { it.right - it.left }
        assertTrue("the field is $width wide", width >= SCREEN_WIDTH * 0.9f)
        val lines = field.lines()
        // 19 instead of 33: the width doubles little, the monospaced font of 0.13.2's dialog was the wide part.
        assertTrue("the note takes $lines lines, was $BEFORE_EDITOR_LINES_MONO", lines * 1.7f <= BEFORE_EDITOR_LINES_MONO)
        val selection = field.fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]
        assertEquals(note.length, selection.start)
        assertEquals(note.length, selection.end)
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        assertEquals(listOf(note), saved)
    }

    @Test fun nothingLeavesTheScreenSidewaysAt130Percent() = assertInsideAt(1.3f)

    @Test fun nothingLeavesTheScreenSidewaysAt200Percent() = assertInsideAt(2f)

    private fun assertInsideAt(scale: Float) {
        show(HelmFont.Mono, scale)
        fun check(node: SemanticsNode) {
            val box = node.boundsInRoot
            val right = with(node.layoutInfo.density) { box.right.toDp() }
            assertTrue("${node.config} ends at $right", right <= SCREEN_WIDTH + 0.5.dp)
            node.children.forEach(::check)
        }
        check(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode())
    }

    private companion object {
        const val TODAY = "2026-10-27"
        val SCREEN_WIDTH = 360.dp
        val NOTE_CORNER = 14.dp

        /** The test window has no status or navigation bar; a phone keeps about 48 dp for them. */
        val FIRST_SCREEN = 780.dp - 48.dp

        /** Measured with this task in Android 0.13.2 (main before this change), with the proof further down. */
        val BEFORE_DEFAULT = 319.dp
        val BEFORE_MONO = 325.dp

        /** Lines of this note in 0.13.2's note dialog in the monospaced font the owner uses (emulator, 360 dp). */
        const val BEFORE_EDITOR_LINES_MONO = 33
    }
}
