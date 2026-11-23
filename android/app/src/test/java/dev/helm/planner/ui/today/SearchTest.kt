package dev.helm.planner.ui.today

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.todaySections
import dev.helm.planner.ui.theme.HelmTheme
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The magnifier on Today finds tasks on any day, done or without a day, and opens the one tapped. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp")
class SearchTest {
    @get:Rule val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T08:00:00Z").toEpochMilli()
    private fun task(id: String, title: String, block: Task.() -> Task = { this }) =
        Task(localId = id, title = title, createdAt = 0, updatedAt = 0).block()

    private val tasks = listOf(
        task("next-week", "Invoice the bakery") { copy(dueDate = "2026-10-29", dueTime = "14:00") },
        task("no-day", "Invoice template") { copy(note = "the old one") },
        task("done", "Invoice for October") { copy(status = TaskStatus.DONE, completedAt = now - 1) },
        task("other", "Water the plants") { copy(dueDate = "2026-10-22") },
        task("trashed", "Invoice draft") { copy(deletedAt = 1) },
    )

    @Test fun theMagnifierFindsTasksAndATapOpensOne() {
        val opened = mutableListOf<String>()
        val actions = object : TodayActions {
            override fun openTask(localId: String) { opened += localId }
        }
        compose.setContent {
            val state = TodayUiState(todaySections(tasks, now, "UTC"), ConnectionStatus.LOCAL, 0, timezone = "UTC", tasks = tasks)
            HelmTheme { TodayScreen(state, actions, now = { now }) }
        }

        compose.onNodeWithContentDescription("Search tasks").performClick()
        compose.onNodeWithTag(SearchTags.FIELD).performTextInput("invoice")
        listOf("next-week", "no-day", "done").forEach { compose.onNodeWithTag(SearchTags.result(it)).assertIsDisplayed() }
        compose.onNodeWithTag(SearchTags.result("trashed")).assertDoesNotExist()
        compose.onNodeWithTag(SearchTags.result("other")).assertDoesNotExist()

        compose.onNodeWithTag(SearchTags.result("no-day")).performClick()
        assertEquals(listOf("no-day"), opened)
        compose.onNodeWithTag(SearchTags.SHEET).assertDoesNotExist()
    }

    @Test fun nothingFoundSaysSo() {
        compose.setContent {
            val state = TodayUiState(todaySections(tasks, now, "UTC"), ConnectionStatus.LOCAL, 0, timezone = "UTC", tasks = tasks)
            HelmTheme { TodayScreen(state, object : TodayActions {}, now = { now }) }
        }
        compose.onNodeWithTag(SearchTags.OPEN).performClick()
        compose.onNodeWithTag(SearchTags.FIELD).performTextInput("dentist")
        compose.onNodeWithTag(SearchTags.NONE).assertIsDisplayed()
    }
}
