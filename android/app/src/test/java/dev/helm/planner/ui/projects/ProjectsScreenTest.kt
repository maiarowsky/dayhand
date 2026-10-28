package dev.helm.planner.ui.projects

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
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
    private val project = Project("home", serverId = "home", name = "Home", color = "amber", position = 0.0, createdAt = 0, updatedAt = 0)
    private val archived = project.copy(localId = "old", name = "Old", archivedAt = 1)
    private val task = Task("task", title = "Milk", projectId = "home", dueDate = "2026-10-22", createdAt = 0, updatedAt = 0)
    private val projects = listOf(project, archived)
    private var picked: String? = "not-picked"

    @Composable private fun Host(content: @Composable () -> Unit) {
        var selecting by remember { mutableStateOf<Task?>(null) }
        CompositionLocalProvider(LocalProjects provides ProjectUiContext(projects = projects, pickTask = { selecting = it })) {
            HelmTheme {
                content()
                selecting?.let { ProjectPickerSheet(it.projectId, onDismiss = { selecting = null }, onPick = { picked = it }) }
            }
        }
    }

    @Test fun projectsListHasCountsNoProjectArchiveAndTrash() {
        var opened: String? = "none"
        compose.setContent { Host { ProjectsScreen(ProjectsUiState(projects, listOf(task, task.copy(localId = "loose", projectId = null)), "2026-10-23", "UTC", 0),
            onProject = { opened = it }, onTrash = {}, onSettings = {}) } }
        compose.onNodeWithTag("project-row-home").assertTextContains("1", substring = true).performClick()
        assertEquals("home", opened)
        compose.onNodeWithTag("project-row-none").assertTextContains("1", substring = true)
        compose.onNodeWithTag("projects-empty").assertDoesNotExist()
        compose.onNodeWithTag("projects-archive").performScrollTo().performClick()
        compose.onNodeWithTag("project-archived-old").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("projects-trash").performScrollTo().assertIsDisplayed()
    }

    @Test fun withoutProjectsTheScreenSaysSoAndOffersTheFirstOne() {
        val loose = task.copy(projectId = null)
        compose.setContent { Host { ProjectsScreen(ProjectsUiState(emptyList(), listOf(loose), "2026-10-23", "UTC", 0),
            onProject = {}, onTrash = {}, onSettings = {}) } }
        compose.onNodeWithTag("project-row-none").assertIsDisplayed()
        compose.onNodeWithText("You have no projects yet. A project groups tasks, for example Home or Work.").assertIsDisplayed()
        compose.onNodeWithTag("projects-empty-new").assertIsDisplayed().performClick()
        compose.onNodeWithTag("project-name").assertExists()
        compose.onAllNodesWithText("Labels", substring = true).assertCountEquals(0)
    }

    @Test fun projectSwitchesBetweenListAndFilteredBoardAndFabKeepsProject() {
        var added: String? = null
        val actions = object : TodayActions {
            override fun add(title: String, dueDate: String?, dueTime: String?, note: String?, projectId: String?) { added = "$title:$projectId" }
        }
        compose.setContent { Host { ProjectScreen(ProjectUiState(project, "home", listOf(task), "2026-10-23", "UTC"), actions, object : BoardActions {}, {}) } }
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
        val state = TaskDetailUiState.Ready(task, "2026-10-23", HelmDates.DEFAULT_TIMEZONE, emptyList(), HistoryState.FRESH, 0, emptyList())
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

    @Test fun theNoProjectScopeNeverOffersABoard() {
        compose.setContent { Host { ProjectScreen(ProjectUiState(null, null, listOf(task.copy(projectId = null)), "2026-10-23", "UTC"),
            object : TodayActions {}, object : BoardActions {}, {}) } }
        compose.onNodeWithTag("project-list-tab").assertDoesNotExist()
        compose.onNodeWithTag("project-board-tab").assertDoesNotExist()
        compose.onNodeWithTag("project-task-list").assertIsDisplayed()
    }

    @Test fun searchDisappearingAtEightProjectsClearsTheActiveFilter() {
        var choices by mutableStateOf((0..8).map { project.copy(localId = "p$it", serverId = "p$it", name = "Project $it") })
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(choices)) {
            HelmTheme { ProjectPickerSheet(null, {}, {}) }
        } }
        compose.onNodeWithTag("project-search").performTextInput("Project 0")
        compose.onNodeWithTag("project-pick-p1").assertDoesNotExist()
        compose.runOnIdle { choices = choices.take(8) }
        compose.onNodeWithTag("project-search").assertDoesNotExist()
        compose.onNodeWithTag("project-pick-p1").assertExists()
        compose.onNodeWithTag("project-pick-p7").assertExists()
    }

    @Test fun everyTodayRepresentationAndBoardKeepDotAlongsideEmoji() {
        val marked = project.copy(icon = "🥐")
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(listOf(marked))) { HelmTheme {
            androidx.compose.foundation.layout.Column {
                val actions = object : TodayActions {}
                val day = LocalDate.parse("2026-10-23")
                dev.helm.planner.ui.today.TodayRow(task, day, actions)
                dev.helm.planner.ui.today.OverdueRow(task, day, actions)
                dev.helm.planner.ui.today.NowCard(task, day, actions)
                dev.helm.planner.ui.today.DoneRow(task, actions)
                dev.helm.planner.ui.board.BoardCard(task, day, object : BoardActions {}, dev.helm.planner.ui.board.BoardDragState())
            }
        } } }
        compose.onAllNodesWithTag("project-dot-home", useUnmergedTree = true).assertCountEquals(5)
        compose.onAllNodesWithText("🥐", useUnmergedTree = true).assertCountEquals(5)
    }

    @Test fun offlineProjectMessageIsVisibleInTheSharedPicker() {
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(failed = true, connectionRequired = true)) {
            HelmTheme { ProjectPickerSheet(null, {}, {}) }
        } }
        compose.onNodeWithTag("project-picker-new").performClick()
        compose.onNodeWithText("Requires a connection to the server").assertExists()
    }

    @Test fun pickerWithoutProjectsExplainsAndAssignsTheFirstOne() {
        var made: Project? = null
        val actions = object : ProjectActions {
            override fun create(draft: ProjectDraft, onCreated: (Project) -> Unit) { onCreated(project.copy(localId = "first", name = draft.name).also { made = it }) }
        }
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(emptyList(), actions)) {
            HelmTheme { ProjectPickerSheet(null, {}, { picked = it }) }
        } }
        compose.onNodeWithTag("project-pick-none").assertIsDisplayed()
        compose.onNodeWithText("You have no projects yet. Create the first one and the task will be assigned to it.").assertIsDisplayed()
        compose.onNodeWithTag("project-picker-new").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag("project-picker-name").performTextInput("Work")
        compose.onNodeWithTag("project-picker-save").performClick()
        assertEquals("Work", made?.name)
        assertEquals("first", picked)
    }

    @Test fun pickerWithProjectsHasNoEmptyNote() {
        compose.setContent { CompositionLocalProvider(LocalProjects provides ProjectUiContext(projects)) {
            HelmTheme { ProjectPickerSheet(null, {}, {}) }
        } }
        compose.onNodeWithTag("project-picker-empty").assertDoesNotExist()
        compose.onNodeWithTag("project-picker-new").assertHeightIsAtLeast(48.dp)
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
