package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.Task
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.projects.LocalProjects
import dev.helm.planner.ui.projects.ProjectPickerSheet
import dev.helm.planner.ui.projects.ProjectUiContext
import dev.helm.planner.ui.projects.ProjectsScreen
import dev.helm.planner.ui.projects.ProjectsUiState
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The task details, the project picker and Projects on an account without projects whose tasks carry labels: what the
 * owner reported as unreadable. Sample data only; run it on purpose with the tour arguments (see [TourConfig]) and
 * the phone's language and font size set with adb.
 */
@RunWith(AndroidJUnit4::class)
class TaskDetailTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()

    private val task = Task(
        localId = "sample",
        title = "Przetestuj nową wersję aplikacji na telefonie przed wydaniem (do wtorku, 07:01)",
        note = "Zainstaluj wersję z ostatniego wydania, przejdź przez Dzisiaj, kalendarz i tablicę, a potem sprawdź " +
            "przypomnienia po restarcie telefonu. Zapisz każdy błąd z krokami, które go wywołują.",
        dueDate = "2026-10-26",
        createdAt = 0,
        updatedAt = 0,
    )
    private val today = "2026-10-27"

    private fun show(content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent {
            var picking by remember { mutableStateOf<Task?>(null) }
            CompositionLocalProvider(LocalProjects provides ProjectUiContext(pickTask = { picking = it })) {
                TourTheme(config) {
                    content()
                    picking?.let { ProjectPickerSheet(it.projectId, onDismiss = { picking = null }, onPick = {}) }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    @Test
    fun detailsPickerAndProjects() {
        val state = TaskDetailUiState.Ready(task, today, "Europe/Warsaw", emptyList(), HistoryState.FRESH, 0, defaultReminders = listOf(0))
        show { TaskDetailScreen(state, object : TaskDetailActions {}) }
        shot("detail-top")
        compose.onNodeWithTag(TaskDetailTags.TRASH).performScrollTo()
        shot("detail-bottom")
        compose.onNodeWithTag("detail-project").performScrollTo().performClick()
        shot("picker-empty")
    }

    @Test
    fun projectsWithoutProjects() {
        val tasks = listOf(task, task.copy(localId = "second"), task.copy(localId = "third"))
        show { ProjectsScreen(ProjectsUiState(emptyList(), tasks, today, "Europe/Warsaw", 0), {}, {}, {}) }
        shot("projects-empty")
    }
}
