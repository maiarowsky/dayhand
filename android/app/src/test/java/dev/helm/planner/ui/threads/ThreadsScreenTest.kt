package dev.helm.planner.ui.threads

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.Threads
import dev.helm.planner.ui.projects.ProjectsScreen
import dev.helm.planner.ui.projects.ProjectsUiState
import dev.helm.planner.ui.theme.HelmTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Sample threads only: synthetic topics and example.com links. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en")
class ThreadsScreenTest {
    @get:Rule val compose = createComposeRule()
    private val hour = 3_600_000L
    private val now = 100 * hour
    private fun thread(id: String, title: String, note: String?, updatedAt: Long = now - 2 * hour) =
        Task(id, title = title, note = note, labels = listOf("wątek"), createdAt = 0, updatedAt = updatedAt)

    private val confirm = thread("confirm", "DO POTWIERDZENIA: Bakery flyers", """
        Stan teraz: Printed and packed.
        Co zrobiono: Sent the files to the printer.
        Co od Ciebie: nic
        Jak sprawdzić: See https://example.com/flyers.pdf for the proof.
        Podsumowanie: The flyers are printed. They are packed. Pick-up is tomorrow.
    """.trimIndent())
    private val waiting = thread("waiting", "Wątek: Garden fence", "Stan teraz: Two quotes in. A third is coming.\nCo od Ciebie: Pick a quote.",
        updatedAt = now - 3 * 24 * hour)
    private val progress = thread("progress", "Wątek: Tax papers", "Just a loose note. Nothing in the format.", updatedAt = now - 5 * 60_000)
    private val tasks = listOf(progress, waiting, confirm, Task("plain", title = "Milk", createdAt = 0, updatedAt = 0))

    @Test fun listGroupsThreadsInOrderWithStrippedTitlesHeadlinesAndAges() {
        var opened: String? = null
        compose.setContent { HelmTheme { ThreadsScreen(ThreadsUiState(tasks, now), onThread = { opened = it }, onBack = {}) } }
        compose.onNodeWithText("For you: 2").assertIsDisplayed()
        val order = listOf(Threads.Group.TO_CONFIRM, Threads.Group.WAITING, Threads.Group.IN_PROGRESS).map {
            compose.onNodeWithTag(ThreadTags.group(it)).fetchSemanticsNode().positionInRoot.y
        }
        assertEquals(order.sorted(), order)
        compose.onNodeWithTag(ThreadTags.row("confirm")).assertTextContains("Bakery flyers").assertTextContains("The flyers are printed.")
            .assertTextContains("2 h")
        compose.onNodeWithText("DO POTWIERDZENIA", substring = true).assertDoesNotExist()
        compose.onNodeWithTag(ThreadTags.row("waiting")).assertTextContains("Garden fence").assertTextContains("Two quotes in.").assertTextContains("3 d")
        compose.onNodeWithTag(ThreadTags.row("progress")).assertTextContains("Just a loose note.").assertTextContains("5 min").performScrollTo().performClick()
        assertEquals("progress", opened)
        compose.onNodeWithTag(ThreadTags.row("plain")).assertDoesNotExist()
    }

    @Test fun anEmptyListSaysWhatAThreadIs() {
        compose.setContent { HelmTheme { ThreadsScreen(ThreadsUiState(emptyList(), now), onThread = {}, onBack = {}) } }
        compose.onNodeWithTag(ThreadTags.EMPTY).assertTextContains("wątek", substring = true)
        compose.onNodeWithText("For you: 0").assertIsDisplayed()
    }

    @Test fun detailsSplitTheNoteKeepLinksAndCloseOnlyAfterConfirming() {
        val closed = mutableListOf<String>()
        compose.setContent { HelmTheme { ThreadScreen(confirm, now, onClose = { closed += it }, onOpenTask = {}, onBack = {}) } }
        compose.onNodeWithText("Bakery flyers").assertIsDisplayed()
        fun section(field: Threads.Field, text: String) =
            compose.onNode(hasTestTag(ThreadTags.field(field)) and hasAnyDescendant(hasText(text))).assertExists()
        section(Threads.Field.SUMMARY, "The flyers are printed. They are packed. Pick-up is tomorrow.")
        section(Threads.Field.STATE, "Printed and packed.")
        section(Threads.Field.DONE, "Sent the files to the printer.")
        section(Threads.Field.ASK, "nic")
        section(Threads.Field.CHECK, "See https://example.com/flyers.pdf for the proof.")
        compose.onNodeWithText("HOW TO CHECK").assertExists()
        // The summary comes first, above the current state.
        val tops = listOf(Threads.Field.SUMMARY, Threads.Field.STATE, Threads.Field.DONE, Threads.Field.ASK, Threads.Field.CHECK)
            .map { compose.onNodeWithTag(ThreadTags.field(it)).fetchSemanticsNode().positionInRoot.y }
        assertEquals(tops.sorted(), tops)
        compose.onNodeWithTag(ThreadTags.CLOSE).performScrollTo().performClick()
        assertTrue("one tap only asks", closed.isEmpty())
        compose.onNodeWithText("Cancel").performClick()
        assertTrue(closed.isEmpty())
        compose.onNodeWithTag(ThreadTags.CLOSE).performScrollTo().performClick()
        compose.onNodeWithTag(ThreadTags.CLOSE_CONFIRM).performClick()
        assertEquals(listOf("confirm"), closed)
    }

    @Test fun aNoteWithoutTheFormatIsShownAsItIs() {
        compose.setContent { HelmTheme { ThreadScreen(progress, now, onClose = {}, onOpenTask = {}, onBack = {}) } }
        compose.onNodeWithText("Just a loose note. Nothing in the format.").assertIsDisplayed()
        compose.onAllNodesWithTag(ThreadTags.field(Threads.Field.STATE)).assertCountEquals(0)
    }

    @Test fun projectsShowsTheThreadsRowWithItsCountOnlyWhenThereAreThreads() {
        var openedThreads = false
        compose.setContent { HelmTheme { ProjectsScreen(ProjectsUiState(emptyList(), tasks, "2026-10-27", "UTC", 0), onProject = {}, onLabel = {},
            onTrash = {}, onSettings = {}, onThreads = { openedThreads = true }) } }
        compose.onNodeWithTag("projects-threads").assertTextContains("2").assertTextContains("To confirm: 1 · Waiting for you: 1").performClick()
        assertTrue(openedThreads)
    }

    @Test fun projectsHasNoThreadsRowWithoutThreads() {
        compose.setContent { HelmTheme { ProjectsScreen(ProjectsUiState(emptyList(), listOf(tasks.last()), "2026-10-27", "UTC", 0), onProject = {},
            onLabel = {}, onTrash = {}, onSettings = {}, onThreads = {}) } }
        compose.onNodeWithTag("projects-threads").assertDoesNotExist()
    }
}
