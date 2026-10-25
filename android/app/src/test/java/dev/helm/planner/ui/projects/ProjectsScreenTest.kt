package dev.helm.planner.ui.projects

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.board.BoardActions
import dev.helm.planner.ui.board.BoardTags
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.QuickAddSheet
import dev.helm.planner.ui.today.QuickAddTags
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayRow
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en")
class ProjectsScreenTest {
    @get:Rule val compose = createComposeRule()
    private val project = Project("home", name = "Home", color = "amber", position = 0.0, createdAt = 0, updatedAt = 0)
    private val archived = project.copy(localId = "old", name = "Old", archivedAt = 1)
    private val task = Task("task", title = "Milk", projectLocalId = "home", dueDate = "2026-10-22", labels = listOf("phone"), createdAt = 0, updatedAt = 0)
    private val projects = listOf(project, archived)
    private var picked: String? = "not-picked"

    @Composable private fun Host(content: @Composable () -> Unit) {
        var selecting by remember { mutableStateOf<Task?>(null) }
        CompositionLocalProvider(LocalProjects provides ProjectUiContext(projects = projects, pickTask = { selecting = it })) {
            HelmTheme {
                content()
                selecting?.let { ProjectPickerSheet(it.projectLocalId, onDismiss = { selecting = null }, onPick = { picked = it }) }
            }
        }
    }

    @Test fun projectsListHasCountsNoProjectLabelsArchiveAndTrash() {
        var opened: String? = "none"
        compose.setContent { Host { ProjectsScreen(ProjectsUiState(projects, listOf(task, task.copy(localId = "loose", projectLocalId = null)), "2026-10-23", "UTC", 0),
            onProject = { opened = it }, onLabel = {}, onTrash = {}, onSettings = {}) } }
        compose.onNodeWithTag("project-row-home").assertTextContains("1", substring = true).performClick()
        assertEquals("home", opened)
        compose.onNodeWithTag("project-row-none").assertTextContains("1", substring = true)
        compose.onNodeWithTag("project-label-phone").assertIsDisplayed()
        compose.onNodeWithTag("projects-archive").performScrollTo().performClick()
        compose.onNodeWithTag("project-archived-old").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("projects-trash").performScrollTo().assertIsDisplayed()
    }

    @Test fun projectSwitchesBetweenListAndFilteredBoardAndFabKeepsProject() {
        var added: String? = null
        val actions = object : TodayActions {
            override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectLocalId: String?) { added = "$title:$projectLocalId" }
        }
        compose.setContent { Host { ProjectScreen(ProjectUiState(project, "home", null, listOf(task), "2026-10-23", "UTC"), actions, object : BoardActions {}, {}) } }
        compose.onNodeWithTag("project-task-list").assertIsDisplayed()
        compose.onNodeWithTag("project-board-tab").performClick()
        compose.onNodeWithTag(BoardTags.card("task")).assertIsDisplayed()
        compose.onNodeWithTag("project-list-tab").performClick()
        compose.onNodeWithTag("project-add").performClick()
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput("Bread")
        compose.onNodeWithTag(QuickAddTags.SAVE).performClick()
        assertEquals("Bread:home", added)
    }

    @Test fun quickAddPickerAssignsActiveProjectsAndDoesNotOfferArchivedOnes() {
        var added: String? = null
        compose.setContent { Host { QuickAddSheet("UTC", {}, { title, _, _, _, id -> added = "$title:$id" }) } }
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextInput("Bread")
        compose.onNodeWithText("More options").performClick()
        compose.onNodeWithTag("quick-add-project").performScrollTo().performClick()
        compose.onNodeWithTag("project-pick-old").assertDoesNotExist()
        compose.onNodeWithTag("project-pick-home").performClick()
        compose.onNodeWithTag(QuickAddTags.SAVE).performScrollTo().performClick()
        assertEquals("Bread:home", added)
    }

    @Test fun detailsUseTheSamePickerAndCanClearTheProject() {
        val state = TaskDetailUiState.Ready(task, "2026-10-23", HelmDates.DEFAULT_TIMEZONE, emptyList(), HistoryState.FRESH, 0, emptyList(), emptyList())
        compose.setContent { Host { TaskDetailScreen(state, object : TaskDetailActions {}) } }
        compose.onNodeWithTag("detail-project").performScrollTo().performClick()
        compose.onNodeWithTag("project-pick-none").performClick()
        assertNull(picked)
    }

    @Test fun todayRowMenuOpensTheSharedPicker() {
        compose.setContent { Host { TodayRow(task, LocalDate.parse("2026-10-23"), object : TodayActions {}) } }
        compose.onNodeWithContentDescription("More actions: Milk").performClick()
        compose.onNodeWithText("Move to project…").performClick()
        compose.onNodeWithTag("project-pick-home").performClick()
        assertEquals("home", picked)
    }

    @Test fun boardCardMenuUsesTheSharedPicker() {
        compose.setContent { Host { dev.helm.planner.ui.board.BoardCard(task, LocalDate.parse("2026-10-23"), object : BoardActions {}, dev.helm.planner.ui.board.BoardDragState()) } }
        compose.onNodeWithContentDescription("More actions: Milk").performClick()
        compose.onNodeWithText("Move to project…").performClick()
        compose.onNodeWithTag("project-pick-none").performClick()
        assertNull(picked)
    }

    @Test fun calendarDayMenuUsesTheSharedPicker() {
        val entry = dev.helm.planner.domain.CalendarEntry(task, "2026-10-23", null, false, false, false)
        val day = dev.helm.planner.domain.CalendarDay("2026-10-23", true, listOf(entry), emptyList())
        compose.setContent { Host { dev.helm.planner.ui.calendar.DaySheet(day, {}, {}, {}, {}) } }
        compose.onNodeWithContentDescription("More actions: Milk").performClick()
        compose.onNodeWithText("Move to project…").performClick()
        compose.onNodeWithTag("project-pick-none").performClick()
        assertNull(picked)
    }

    @Test fun pickerCreatesAProjectInPlace() {
        val actions = object : ProjectActions {
            override fun create(draft: ProjectDraft, onCreated: (Project) -> Unit) { onCreated(project.copy(localId = "new", name = draft.name)) }
        }
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(projects, actions)) {
            HelmTheme { ProjectPickerSheet(null, {}, { picked = it }) }
        } }
        compose.onNodeWithTag("project-picker-new").performClick()
        compose.onNodeWithTag("project-picker-name").performTextInput("New")
        compose.onNodeWithTag("project-picker-save").performClick()
        assertEquals("new", picked)
    }
}
