package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A finished task with a three-line title, its proof, a due day, a project, a long note in paragraphs and three
 * history entries, and the note's editor: the screen the owner asked to slim down. Sample data only; run it on purpose
 * with the tour arguments (see [TourConfig]) and the phone's language and font size set with adb.
 */
@RunWith(AndroidJUnit4::class)
class TaskNoteTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()
    private val today = "2026-10-27"

    private val task = Task(
        localId = "sample",
        title = "Odpowiedz Samowi na zgłoszenie o brakującej ścieżce instalacji narzędzia (adres pomocy na stronie)",
        status = TaskStatus.DONE,
        note = listOf(
            "Gdzie: skrzynka pomocy, na którą przyszło zgłoszenie z formularza na stronie (przekierowanie z adresu pomocy).",
            "To prawdziwe zgłoszenie: format diagnostyki pochodzi z aplikacji, a błąd jest w kodzie (brak jednej ścieżki " +
                "instalacji). Poprawka jest w pracy lokalnie, bez wydania.",
            "Szkic odpowiedzi (do zatwierdzenia, potem wysyłasz sam):",
            "Hi Sam, thanks for the report and the diagnostics. The app looks for the tool in your login shell and a few " +
                "fixed folders, and the folder you installed it to is not one of them yet. That is my bug. Until I fix it, " +
                "a link in a folder the app already checks works: ln -s /opt/tool/bin/tool ~/.local/bin/tool",
            "Then run the diagnostics again. I will add the folder in the next update. Thanks again!",
        ).joinToString("\n"),
        dueDate = today,
        projectId = "app",
        proof = TaskProof(summary = "Właściciel potwierdził w rozmowie 27.10: pierwsza odpowiedź wysłana."),
        createdAt = 0,
        updatedAt = 0,
    )
    private val project = Project("app", serverId = "app", name = "Aplikacja", color = "amber", position = 0.0, createdAt = 0, updatedAt = 0)
    private val history = listOf(
        HistoryEntry(1_793_080_800_000, Actor.AGENT, "complete", listOf(FieldChange(HistoryField.STATUS, JsonPrimitive("todo"), JsonPrimitive("done")))),
        HistoryEntry(1_793_076_600_000, Actor.AGENT, "update", listOf(FieldChange(HistoryField.NOTE, JsonNull, JsonPrimitive("Gdzie: skrzynka pomocy")))),
        HistoryEntry(1_793_076_000_000, Actor.AGENT, "create", listOf(FieldChange(HistoryField.TITLE, JsonNull, JsonPrimitive(task.title)))),
    )

    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    @Test
    fun detailsAndNoteEditor() {
        val state = TaskDetailUiState.Ready(task, today, "Europe/Warsaw", history, HistoryState.FRESH, 0, listOf(0))
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent {
            CompositionLocalProvider(LocalProjects provides ProjectUiContext(listOf(project))) {
                TourTheme(config) { TaskDetailScreen(state, object : TaskDetailActions {}) }
            }
        }
        shot("detail-top")
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo()
        shot("detail-note")
        compose.onNodeWithTag(TaskDetailTags.TRASH).performScrollTo()
        shot("detail-bottom")
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().performClick()
        shot("note-editor")
    }
}
