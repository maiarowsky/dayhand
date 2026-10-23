package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.local.WeekdayOfMonth
import dev.helm.planner.domain.Actor
import dev.helm.planner.domain.BoardColumns
import dev.helm.planner.domain.FieldChange
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.domain.HistoryField
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.board.BoardActions
import dev.helm.planner.ui.board.BoardScreen
import dev.helm.planner.ui.board.BoardTags
import dev.helm.planner.ui.board.BoardUiState
import dev.helm.planner.ui.task.ChecklistTags
import dev.helm.planner.ui.task.EditorTags
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.trash.TrashActions
import dev.helm.planner.ui.trash.TrashScreen
import dev.helm.planner.ui.trash.TrashUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.JsonPrimitive

/** The board, task details and trash for the before/after screenshots; see [ScreenTour]. Sample data is Polish. */
@RunWith(AndroidJUnit4::class)
class BoardTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()

    private fun show(content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config, content) }
        compose.waitForIdle()
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    private fun task(id: String, title: String, status: TaskStatus = TaskStatus.TODO, block: Task.() -> Task = { this }) =
        Task(localId = id, title = title, status = status, createdAt = 0, updatedAt = 0).block()

    private val columns = BoardColumns(
        date = "2026-10-22",
        todo = listOf(
            task("a", "Podlać kwiaty") { copy(dueDate = "2026-10-21") },
            task("b", "Zadzwonić do dentysty") { copy(dueDate = "2026-10-22", dueTime = "09:30", labels = listOf("dom")) },
            task("c", "Przejrzeć pull request") { copy(labels = listOf("Helm", "praca")) },
            task("d", "Kupić chleb"),
        ),
        doing = listOf(
            task("n", "Zaplanować tydzień", TaskStatus.DOING) { copy(isNow = true, resumeNote = "Szkic w docs/tydzien.md, dalej: budżet") },
            task("e", "Raport kwartalny", TaskStatus.DOING) { copy(dueDate = "2026-10-24", labels = listOf("praca")) },
        ),
        done = listOf(task("f", "Poranny bieg", TaskStatus.DONE) { copy(completedAt = 1) }),
    )

    private val detailTask = task("a", "Zadzwonić do księgowej") {
        copy(
            serverId = "s1", note = "Zapytać o VAT za wrzesień i termin zeznania.", dueDate = "2026-10-23", dueTime = "09:30",
            repeat = RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 4)), labels = listOf("Helm", "finanse"),
            links = listOf(TaskLink("https://example.com/umowa", "Umowa"), TaskLink("https://example.com/faktury")),
            checklist = listOf(
                ChecklistItem("c1", "Wyciągi z banku", done = true),
                ChecklistItem("c2", "Faktury kosztowe"),
                ChecklistItem("c3", "Pytania o ulgę"),
            ),
            reminders = listOf(TaskReminder.before(15), TaskReminder.at("18:00", 1)),
        )
    }

    private val history = listOf(
        HistoryEntry(1_792_650_000_000, Actor.AGENT, "update", listOf(FieldChange(HistoryField.TITLE, JsonPrimitive("Księgowa"), JsonPrimitive("Zadzwonić do księgowej")))),
        HistoryEntry(1_792_600_000_000, Actor.CLI, "setStatus", listOf(FieldChange(HistoryField.STATUS, JsonPrimitive("doing"), JsonPrimitive("todo")))),
        HistoryEntry(1_792_500_000_000, Actor.APP, "create", emptyList()),
    )

    private fun detail(task: Task) =
        TaskDetailUiState.Ready(task, "2026-10-22", "Europe/Warsaw", history, HistoryState.FRESH, 1, listOf("Helm", "dom", "praca"), listOf(0, 30))

    @Test
    fun board() {
        show { BoardScreen(BoardUiState(columns, ConnectionStatus.SYNCED, 0), object : BoardActions {}) }
        shot("10-board")
        compose.onNodeWithTag(BoardTags.tab(TaskStatus.DOING)).performClick()
        shot("11-board-doing")
    }

    @Test
    fun details() {
        show { TaskDetailScreen(detail(detailTask), object : TaskDetailActions {}) }
        shot("12-details")
        compose.onNodeWithTag(TaskDetailTags.TRASH).performScrollTo()
        shot("13-details-history")
        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().performClick()
        shot("14-dialog-repeat")
    }

    @Test
    fun detailsRepeatAndReminders() {
        val monthly = detailTask.copy(dueDate = "2026-10-30", repeat = RepeatRule(RepeatEvery.MONTH, weekdayOfMonth = WeekdayOfMonth(-1, 5), count = 6))
        show { TaskDetailScreen(detail(monthly), object : TaskDetailActions {}) }
        compose.onNodeWithTag(ChecklistTags.SECTION).performScrollTo()
        shot("17-details-checklist")
        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().performClick()
        shot("18-dialog-repeat-month")
        compose.onNodeWithTag(EditorTags.END_COUNT).performScrollTo()
        shot("19-dialog-repeat-ends")
    }

    @Test
    fun detailsReminders() {
        show { TaskDetailScreen(detail(detailTask), object : TaskDetailActions {}) }
        compose.onNodeWithTag(TaskDetailTags.REMINDERS).performScrollTo().performClick()
        shot("20-dialog-reminders")
    }

    @Test
    fun detailsInTrash() {
        val deleted = LocalDate.of(2026, 10, 20).atStartOfDay(ZoneId.of("Europe/Warsaw")).toInstant().toEpochMilli()
        show { TaskDetailScreen(detail(detailTask.copy(deletedAt = deleted)), object : TaskDetailActions {}) }
        shot("15-details-trashed")
    }

    @Test
    fun trash() {
        val day = { d: Int -> LocalDate.of(2026, 10, d).atStartOfDay(ZoneId.of("Europe/Warsaw")).toInstant().toEpochMilli() }
        val tasks = listOf(
            task("x", "Stary szkic notatki") { copy(deletedAt = day(21)) },
            task("y", "Zamówić drukarkę") { copy(deletedAt = day(15)) },
            task("z", "Spotkanie odwołane") { copy(deletedAt = day(2)) },
        )
        show { TrashScreen(TrashUiState(tasks, "2026-10-22", "Europe/Warsaw"), object : TrashActions {}) }
        shot("16-trash")
    }
}
