package dev.helm.planner.ui

import androidx.annotation.StringRes
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.data.local.AcceptanceItem
import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.ProofCheck
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatFrom
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.data.local.WeekdayOfMonth
import dev.helm.planner.domain.Actor
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.FieldChange
import dev.helm.planner.domain.HistoryEntry
import dev.helm.planner.domain.HistoryField
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.task.AgentWorkTags
import dev.helm.planner.ui.task.ChecklistTags
import dev.helm.planner.ui.task.EditorTags
import dev.helm.planner.ui.task.TaskDetailActions
import dev.helm.planner.ui.task.TaskDetailScreen
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.task.TaskDetailUiState
import dev.helm.planner.ui.theme.HelmTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TaskDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private val task = Task(
        localId = "a", serverId = "s1", title = "Call the accountant", note = "Ask about VAT",
        dueDate = "2026-10-23", dueTime = "09:30", status = TaskStatus.TODO,
        repeat = RepeatRule(RepeatEvery.DAY), labels = listOf("Dayhand"),
        links = listOf(TaskLink("https://example.com", "Spec")), createdAt = 0, updatedAt = 0,
    )

    private val history = listOf(
        HistoryEntry(2_000, Actor.AGENT, "update", listOf(FieldChange(HistoryField.TITLE, JsonPrimitive("Call"), JsonPrimitive("Call the accountant")))),
        HistoryEntry(1_000, Actor.APP, "create", emptyList()),
    )

    private class Recorder : TaskDetailActions {
        val calls = mutableListOf<String>()
        override fun rename(localId: String, title: String) { calls += "rename:$title" }
        override fun setRepeat(localId: String, rule: RepeatRule?) { calls += "repeat:$rule" }
        override fun setLabels(localId: String, labels: List<String>) { calls += "labels:$labels" }
        override fun setLinks(localId: String, links: List<TaskLink>) { calls += "links:${links.map { it.url }}" }
        override fun setDue(localId: String, date: String?, time: String?) { calls += "due:$date:$time" }
        override fun move(localId: String, status: TaskStatus) { calls += "move:${status.wire}" }
        override fun moveToTrash(localId: String) { calls += "trash" }
        override fun restore(localId: String) { calls += "restore" }
        override fun setReminders(localId: String, reminders: List<TaskReminder>?) { calls += "reminders:$reminders" }
        override fun toggleItem(localId: String, itemId: String) { calls += "toggle:$itemId" }
        override fun addItem(localId: String, title: String) { calls += "add:$title" }
        override fun renameItem(localId: String, itemId: String, title: String) { calls += "rename:$itemId:$title" }
        override fun removeItem(localId: String, itemId: String) { calls += "remove:$itemId" }
        override fun moveItem(localId: String, itemId: String, by: Int) { calls += "move:$itemId:$by" }
        override fun release(localId: String) { calls += "release:$localId" }
    }

    private fun show(
        task: Task = this.task,
        actions: TaskDetailActions = Recorder(),
        state: HistoryState = HistoryState.FRESH,
        pending: Int = 0,
        dependencies: List<AgentWork.Dependency> = emptyList(),
    ) {
        val ui = TaskDetailUiState.Ready(task, "2026-10-22", "Europe/Warsaw", history, state, pending, listOf("Dayhand", "home"), listOf(0, 30), dependencies)
        compose.setContent { HelmTheme { TaskDetailScreen(ui, actions) } }
    }

    @Test
    fun showsEveryFieldOfTheTask() {
        show()
        compose.onNodeWithTag(TaskDetailTags.TITLE).assertTextContains("Call the accountant").assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(TaskDetailTags.DUE).assertTextContains(text(R.string.day_and_time, text(R.string.day_tomorrow), "09:30"))
        compose.onNodeWithTag(TaskDetailTags.REPEAT).assertTextContains(context.resources.getQuantityString(R.plurals.repeat_days, 1, 1), substring = true)
        compose.onNodeWithContentDescription(text(R.string.remove_label, "Dayhand")).assertIsDisplayed()
        compose.onNodeWithText("Spec").assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag(TaskDetailTags.NOTE).performScrollTo().assertTextContains("Ask about VAT", substring = true)
    }

    @Test
    fun showsWhoWorksOnTheTaskItsCriteriaAndItsProof() {
        val inAnHour = System.currentTimeMillis() + 60 * 60_000
        show(
            task.copy(
                claimName = "claude-code",
                claimExpiresAt = inAnHour,
                acceptance = listOf(AcceptanceItem("a1", "CSV opens", met = true), AcceptanceItem("a2", "Docs updated")),
                proof = TaskProof(summary = "Export shipped", checks = listOf(ProofCheck("unit tests", "pass"), ProofCheck("lint", "fail"))),
            ),
        )
        val until = java.time.format.DateTimeFormatter.ofPattern("HH:mm")
            .format(java.time.Instant.ofEpochMilli(inAnHour).atZone(java.time.ZoneId.of("Europe/Warsaw")))
        compose.onNodeWithTag(AgentWorkTags.CLAIM).assertTextContains(text(R.string.agent_works_until, "claude-code", until))
        compose.onNodeWithTag(AgentWorkTags.criterion(0)).performScrollTo().assertTextContains("CSV opens", substring = true)
        compose.onNodeWithTag(AgentWorkTags.criterion(1)).assertTextContains("Docs updated", substring = true)
        compose.onNodeWithText(text(R.string.acceptance_title_progress, text(R.string.detail_acceptance), 1, 2), ignoreCase = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(AgentWorkTags.PROOF).performScrollTo()
        compose.onNodeWithText("Export shipped").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("${text(R.string.proof_check_fail)}  lint").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun showsThePlanWhatTheTaskWaitsForAndWhyItIsBlocked() {
        show(
            task.copy(plan = "Draft, then send to the client", blockedReason = "the client has not answered"),
            dependencies = listOf(
                AgentWork.Dependency(12, "Send the invoice", AgentWork.DependencyState.DONE),
                AgentWork.Dependency(14, "Pay the VAT", AgentWork.DependencyState.OPEN),
                AgentWork.Dependency(null, null, AgentWork.DependencyState.MISSING),
            ),
        )
        compose.onNodeWithTag(AgentWorkTags.BLOCKED).performScrollTo()
            .assertTextContains(text(R.string.detail_blocked, "the client has not answered"))
        compose.onNodeWithText(text(R.string.detail_waiting_on)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(AgentWorkTags.dependency(0)).performScrollTo()
            .assertTextContains(text(R.string.dependency_done, "#12 Send the invoice"), substring = true)
        compose.onNodeWithTag(AgentWorkTags.dependency(1)).assertTextContains("#14 Pay the VAT", substring = true)
        compose.onNodeWithTag(AgentWorkTags.dependency(2)).assertTextContains(text(R.string.dependency_missing), substring = true)
        compose.onNodeWithTag(AgentWorkTags.PLAN).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Draft, then send to the client").assertIsDisplayed()
        // Nobody holds the task: nothing to end.
        compose.onNodeWithTag(AgentWorkTags.RELEASE).assertDoesNotExist()
    }

    @Test
    fun endingAClaimAsksFirst() {
        val actions = Recorder()
        show(task.copy(claimName = "claude-code", claimExpiresAt = System.currentTimeMillis() + 60 * 60_000), actions)
        compose.onNodeWithTag(AgentWorkTags.RELEASE).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText(text(R.string.release_claim_title, "claude-code")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.cancel)).performClick()
        assertEquals(emptyList<String>(), actions.calls)

        compose.onNodeWithTag(AgentWorkTags.RELEASE).performClick()
        compose.onNodeWithText(text(R.string.release_claim_text, "claude-code")).assertIsDisplayed()
        compose.onNodeWithTag(AgentWorkTags.RELEASE_CONFIRM).performClick()
        assertEquals(listOf("release:a"), actions.calls)
    }

    @Test
    fun aClaimOnATaskInTheTrashCannotBeEnded() {
        show(task.copy(claimName = "claude-code", claimExpiresAt = System.currentTimeMillis() + 60 * 60_000, deletedAt = System.currentTimeMillis()))
        compose.onNodeWithTag(AgentWorkTags.CLAIM).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(AgentWorkTags.RELEASE).assertDoesNotExist()
    }

    @Test
    fun anExpiredClaimIsNotShown() {
        show(task.copy(claimName = "claude-code", claimExpiresAt = System.currentTimeMillis() - 1_000))
        compose.onNodeWithTag(AgentWorkTags.CLAIM).assertDoesNotExist()
        compose.onNodeWithTag(AgentWorkTags.ACCEPTANCE).assertDoesNotExist()
        compose.onNodeWithTag(AgentWorkTags.SECTION).assertDoesNotExist()
    }

    @Test
    fun renameGoesThroughADialogAndRefusesAnEmptyTitle() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.TITLE).performClick()
        // The dialog window gets focus a frame or two after it opens.
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag(EditorTags.FIELD).assertIsFocused() }.isSuccess }
        compose.onNodeWithTag(EditorTags.FIELD).performTextInput("!")
        compose.onNodeWithTag(EditorTags.FIELD).assertTextContains("Call the accountant!")
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("   ")
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("Call the tax office")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        assertEquals(listOf("rename:Call the tax office"), actions.calls)
    }

    @Test
    fun repeatLabelsLinksAndStatusAreEditable() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.status(TaskStatus.DOING)).assertHeightIsAtLeast(48.dp).performClick()

        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.every(RepeatEvery.WEEK)).performClick()
        compose.onNodeWithTag(EditorTags.weekday(1)).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(EditorTags.weekday(4)).performClick()
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithText(text(R.string.add_label)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText("home").performClick()

        compose.onNodeWithText(text(R.string.add_link)).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.URL).performTextInput("example.org")
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.URL).performTextReplacement("https://example.org/plan")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithText(text(R.string.remove_due)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()

        assertEquals(
            listOf(
                "move:doing",
                "repeat:${RepeatRule(RepeatEvery.WEEK, 1, listOf(1, 4))}",
                "labels:[Dayhand, home]",
                "links:[https://example.com, https://example.org/plan]",
                "due:null:null",
            ),
            actions.calls,
        )
    }

    @Test
    fun checklistRowsTickAddRenameMoveAndRemove() {
        val actions = Recorder()
        val items = listOf(ChecklistItem("c1", "Milk", done = true), ChecklistItem("c2", "Bread"))
        show(task.copy(checklist = items), actions)
        compose.onNodeWithText(text(R.string.checklist_title_progress, text(R.string.detail_checklist), 1, 2), ignoreCase = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(ChecklistTags.check(0)).assertIsOn()
        compose.onNodeWithTag(ChecklistTags.check(1)).assertIsOff().assertHeightIsAtLeast(48.dp).performClick()

        compose.onNodeWithTag(ChecklistTags.ADD).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.FIELD).performTextInput("Eggs")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithTag(ChecklistTags.item(1)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag(EditorTags.ITEM_DOWN).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.ITEM_UP).performClick()
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("Rye bread")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithTag(ChecklistTags.item(0)).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.ITEM_REMOVE).performClick()

        assertEquals(listOf("toggle:c2", "add:Eggs", "move:c2:-1", "rename:c2:Rye bread", "remove:c1"), actions.calls)
    }

    @Test
    fun aTaskWithoutAChecklistOffersToStartOne() {
        show(task.copy(checklist = emptyList()))
        compose.onNodeWithText(text(R.string.checklist_empty)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(ChecklistTags.ADD).assertIsDisplayed()
    }

    @Test
    fun monthlyRepeatOnTheLastFridayCountedFromCompletionForSixTimes() {
        val actions = Recorder()
        // 30 Oct 2026 is the last Friday of October.
        show(task.copy(dueDate = "2026-10-30", repeat = null), actions)
        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.every(RepeatEvery.MONTH)).performClick()
        compose.onNodeWithTag(EditorTags.month("last")).assertIsDisplayed()
        compose.onNodeWithTag(EditorTags.month("nth:5:5")).assertIsDisplayed()
        compose.onNodeWithTag(EditorTags.month("nth:-1:5")).performClick()
        compose.onNodeWithTag(EditorTags.FROM_COMPLETION).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.END_COUNT).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.COUNT).performScrollTo().performTextReplacement("0")
        compose.onNodeWithTag(EditorTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(EditorTags.COUNT).performTextReplacement("6")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        val rule = RepeatRule(RepeatEvery.MONTH, from = RepeatFrom.COMPLETION, weekdayOfMonth = WeekdayOfMonth(-1, 5), count = 6)
        assertEquals(listOf("repeat:$rule"), actions.calls)
    }

    @Test
    fun repeatSummaryShowsTheMonthPatternAndTheEnd() {
        val rule = RepeatRule(RepeatEvery.MONTH, monthDay = -1, until = "2026-12-31")
        show(task.copy(repeat = rule))
        compose.onNodeWithTag(TaskDetailTags.REPEAT).performScrollTo()
            .assertTextContains(text(R.string.repeat_label_last_day), substring = true)
    }

    @Test
    fun remindersFollowSettingsUntilTheTaskGetsItsOwn() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.REMINDERS).performScrollTo()
            .assertTextContains(text(R.string.reminders_default_value, ""), substring = true)
            .performClick()
        compose.onNodeWithTag(EditorTags.REMINDERS_CUSTOM).performClick()
        // The defaults (0 and 30) are the starting point; drop 30, add 60.
        compose.onNodeWithTag(EditorTags.before(30)).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.before(60)).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        compose.onNodeWithTag(TaskDetailTags.REMINDERS).performScrollTo().performClick()
        compose.onNodeWithTag(EditorTags.REMINDERS_NONE).performClick()
        compose.onNodeWithTag(EditorTags.SAVE).performClick()

        assertEquals(
            listOf("reminders:${listOf(TaskReminder.before(0), TaskReminder.before(60))}", "reminders:[]"),
            actions.calls,
        )
    }

    @Test
    fun ownRemindersAreListedOnTheRow() {
        show(task.copy(reminders = listOf(TaskReminder.at("18:00", 1))))
        compose.onNodeWithTag(TaskDetailTags.REMINDERS).performScrollTo().assertTextContains("18:00", substring = true)
    }

    @Test
    fun historySaysWhoChangedWhat() {
        show(pending = 1)
        compose.onNodeWithTag(TaskDetailTags.HISTORY).performScrollTo()
        compose.onNodeWithText(text(R.string.actor_agent)).assertExists()
        compose.onNodeWithText(text(R.string.actor_app)).assertExists()
        compose.onNodeWithText(text(R.string.history_change, text(R.string.field_title), "Call", "Call the accountant")).assertExists()
        compose.onNodeWithText(context.resources.getQuantityString(R.plurals.history_pending, 1, 1)).assertExists()
    }

    @Test
    fun offlineHistoryIsMarkedAsTheLastCopy() {
        show(state = HistoryState.CACHED)
        compose.onNodeWithText(text(R.string.history_cached)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun moveToTrash() {
        val actions = Recorder()
        show(actions = actions)
        compose.onNodeWithTag(TaskDetailTags.TRASH).performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("trash"), actions.calls)
    }

    @Test
    fun aTaskInTheTrashIsReadOnlyUntilRestored() {
        val trashed = Recorder()
        show(task.copy(deletedAt = System.currentTimeMillis()), trashed)
        compose.onNodeWithTag(TaskDetailTags.TRASH_BANNER).assertIsDisplayed()
        compose.onNodeWithTag(TaskDetailTags.TRASH).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.add_label)).assertDoesNotExist()
        compose.onNodeWithTag(TaskDetailTags.RESTORE).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("restore"), trashed.calls)
    }
}
