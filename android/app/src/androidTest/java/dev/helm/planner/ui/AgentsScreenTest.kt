package dev.helm.planner.ui

import androidx.activity.ComponentActivity
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.R
import dev.helm.planner.agents.AgentControls
import dev.helm.planner.agents.ApprovalDecision
import dev.helm.planner.agents.ApprovalOption
import dev.helm.planner.agents.ApprovalRequest
import dev.helm.planner.agents.ApprovalStatus
import dev.helm.planner.agents.PlanHealth
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.agents.Proposal
import dev.helm.planner.agents.ToolPolicy
import dev.helm.planner.ui.agents.AgentsActions
import dev.helm.planner.ui.agents.AgentsMessage
import dev.helm.planner.ui.agents.AgentsPage
import dev.helm.planner.ui.agents.AgentsScreen
import dev.helm.planner.ui.agents.AgentsTags
import dev.helm.planner.ui.agents.AgentsUiState
import dev.helm.planner.ui.agents.MergeTarget
import dev.helm.planner.ui.agents.Section
import dev.helm.planner.ui.theme.HelmTheme
import dev.helm.planner.ui.today.HEALTH_CARD_TAG
import dev.helm.planner.ui.today.HealthCard
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AgentsScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)
    private fun plural(@PluralsRes id: Int, n: Int) = context.resources.getQuantityString(id, n, n)

    private val deploy = ApprovalRequest(
        id = "ap1", taskRef = 4, taskTitle = "Release 2.4", action = "Deploy 2.4 to production", detail = "All checks passed",
        options = listOf(ApprovalOption("o1", "Deploy now", "Customers get 2.4 in 10 minutes"), ApprovalOption("o2", "Wait", "Nothing changes until Monday")),
        reversible = false, status = ApprovalStatus.PENDING, expiresAt = 2, createdAt = 1, requestedBy = "claude", policyTool = null, decision = null,
    )
    private val earlier = deploy.copy(
        id = "ap0", action = "Delete old backups", status = ApprovalStatus.DECIDED, reversible = true,
        decision = ApprovalDecision("o2", "Wait", null, 1),
    )
    private val proposal = Proposal("t1", 7, "Fix checkout", "From the error report", "Ann", "sentry", "CHECKOUT-42", "https://sentry.example/42", 1)

    private val loaded = AgentsUiState(
        controls = Section.Loaded(AgentControls(paused = true, pausedAt = 1, reason = "lunch", policies = listOf(ToolPolicy("k1", "claude", "complete_task", PolicyRule.ASK)))),
        approvals = Section.Loaded(listOf(deploy, earlier)),
        proposals = Section.Loaded(listOf(proposal)),
        targets = listOf(MergeTarget("s1", "Checkout bugs", "2026-10-25"), MergeTarget("s2", "Write the blog post", null)),
        timeLabel = { "24 Oct 12:00" },
    )

    private class Recorder : AgentsActions {
        val calls = mutableListOf<String>()
        override fun setPaused(paused: Boolean) { calls += "paused:$paused" }
        override fun open(page: AgentsPage) { calls += "open:$page" }
        override fun back() { calls += "back" }
        override fun decide(approvalId: String, optionId: String, note: String?) { calls += "decide:$approvalId:$optionId:$note" }
        override fun accept(proposalId: String) { calls += "accept:$proposalId" }
        override fun merge(proposalId: String, intoTaskId: String) { calls += "merge:$proposalId:$intoTaskId" }
        override fun reject(proposalId: String, reason: String?) { calls += "reject:$proposalId:$reason" }
        override fun setPolicy(keyId: String, tool: String, rule: PolicyRule) { calls += "policy:$keyId:$tool:${rule.wire}" }
    }

    private fun show(state: AgentsUiState, actions: AgentsActions) = compose.setContent { HelmTheme { AgentsScreen(state, actions) } }

    @Test
    fun listShowsTheSwitchWaitingRequestsProposalsAndPolicies() {
        val actions = Recorder()
        show(loaded, actions)
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOn()
        compose.onNodeWithText(text(R.string.agents_waiting, 1), ignoreCase = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_request_note, "claude", "24 Oct 12:00") + " · #4").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.EARLIER + "ap0").performScrollTo()
        compose.onNodeWithText(text(R.string.agents_chose, "Wait")).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.PROPOSAL + "t1").performScrollTo()
        compose.onNodeWithText(text(R.string.agents_from, "Ann") + " · sentry:CHECKOUT-42").assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.POLICY + "0").performScrollTo()
        compose.onNodeWithText(text(R.string.agents_policy_name, "claude", "complete_task")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_rule_ask)).assertIsDisplayed()

        compose.onNodeWithTag(AgentsTags.PAUSE).performScrollTo().performClick()
        compose.onNodeWithTag(AgentsTags.APPROVAL + "ap1").performScrollTo().performClick()
        compose.onNodeWithTag(AgentsTags.PROPOSAL + "t1").performScrollTo().performClick()
        assertEquals(listOf("paused:false", "open:${AgentsPage.Approval("ap1")}", "open:${AgentsPage.Proposal("t1")}"), actions.calls)
    }

    @Test
    fun aRequestShowsItsConsequencesAndIsDecidedWithANote() {
        val actions = Recorder()
        show(loaded.copy(page = AgentsPage.Approval("ap1")), actions)
        compose.onNodeWithText("Deploy 2.4 to production").assertIsDisplayed()
        compose.onNodeWithText("#4 Release 2.4").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_irreversible)).assertIsDisplayed()
        compose.onNodeWithText("Nothing changes until Monday").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.OPTION + "o2").performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.agents_choose_title, "Wait")).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.NOTE).performTextInput("Monday then")
        compose.onNodeWithTag(AgentsTags.CHOOSE).performClick()
        assertEquals(listOf("decide:ap1:o2:Monday then"), actions.calls)
    }

    @Test
    fun aDecidedRequestShowsTheAnswerAndNoOptions() {
        show(loaded.copy(page = AgentsPage.Approval("ap0")), Recorder())
        compose.onNodeWithTag(AgentsTags.DECISION).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.OPTION + "o1").assertDoesNotExist()
    }

    @Test
    fun aProposalIsAcceptedRejectedWithAReasonOrMergedIntoAFoundTask() {
        val actions = Recorder()
        var state by mutableStateOf(loaded.copy(page = AgentsPage.Proposal("t1")))
        compose.setContent { HelmTheme { AgentsScreen(state, actions) } }
        compose.onNodeWithText(text(R.string.agents_requested_by, "Ann")).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.ACCEPT).performScrollTo().performClick()
        compose.onNodeWithTag(AgentsTags.REJECT).performScrollTo().performClick()
        compose.onNodeWithTag(AgentsTags.NOTE).performTextInput("Duplicate")
        compose.onNodeWithTag(AgentsTags.REJECT_CONFIRM).performClick()
        compose.onNodeWithTag(AgentsTags.MERGE).performScrollTo().performClick()

        state = loaded.copy(page = AgentsPage.Merge("t1"))
        compose.onNodeWithTag(AgentsTags.SEARCH).performTextInput("checkout")
        compose.onNodeWithTag(AgentsTags.TARGET + "s2").assertDoesNotExist()
        compose.onNodeWithTag(AgentsTags.TARGET + "s1").performClick()
        compose.onNodeWithTag(AgentsTags.MERGE_CONFIRM).performClick()
        assertEquals(
            listOf("accept:t1", "reject:t1:Duplicate", "open:${AgentsPage.Merge("t1")}", "merge:t1:s1"),
            actions.calls,
        )
    }

    @Test
    fun aPolicyRowOpensItsThreeRulesAndAnotherRuleIsSent() {
        val actions = Recorder()
        var state by mutableStateOf(loaded)
        compose.setContent { HelmTheme { AgentsScreen(state, actions) } }
        compose.onNodeWithTag(AgentsTags.POLICY + "0").performScrollTo().performClick()
        assertEquals(listOf("open:${AgentsPage.Policy("k1", "complete_task")}"), actions.calls)

        state = loaded.copy(page = AgentsPage.Policy("k1", "complete_task"))
        compose.onNodeWithTag(AgentsTags.POLICY_PAGE).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_policy_name, "claude", "complete_task")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_rule_allow_note, "claude", "complete_task")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_rule_ask_note, "claude", "complete_task")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_rule_deny_note, "claude", "complete_task")).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.RULE + "ask").assertIsSelected()
        compose.onNodeWithTag(AgentsTags.RULE + "deny").assertIsNotSelected()

        // The rule in force sends nothing; another one goes to the server.
        compose.onNodeWithTag(AgentsTags.RULE + "ask").performClick()
        compose.onNodeWithTag(AgentsTags.RULE + "deny").performClick()
        assertEquals("policy:k1:complete_task:deny", actions.calls.last())
        assertEquals(2, actions.calls.size)
    }

    @Test
    fun aRefusedRuleSaysWhyOnTheList() {
        show(loaded.copy(message = AgentsMessage.POLICY_KEY_GONE), Recorder())
        compose.onNodeWithTag(AgentsTags.MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.agents_policy_key_gone)).assertIsDisplayed()
    }

    @Test
    fun aRuleOfARemovedKeySaysItIsGone() {
        show(loaded.copy(page = AgentsPage.Policy("k9", "*")), Recorder())
        compose.onNodeWithText(text(R.string.agents_gone)).assertIsDisplayed()
        compose.onNodeWithTag(AgentsTags.RULE + "deny").assertDoesNotExist()
    }

    @Test
    fun healthCardSaysWhatNeedsALookAndLeadsToAgents() {
        var reviewed = 0
        val health = PlanHealth(
            agentsPaused = false, overdue = 2, dueToday = 1, inProgress = 0, expiredClaims = 0, blocked = 0,
            awaitingApproval = 0, pendingApprovals = 1, proposals = 0, completedToday = 0, withoutProof = 0, oldestOpenDays = null,
        )
        compose.setContent { HelmTheme { HealthCard(health, onReview = { reviewed++ }) } }
        val line = listOf(plural(R.plurals.health_overdue, 2), plural(R.plurals.health_approvals, 1), plural(R.plurals.health_due_today, 1))
        compose.onNodeWithText(text(R.string.health_title, line.joinToString(" · "))).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.health_review)).performClick()
        assertEquals(1, reviewed)
        compose.onNodeWithTag(HEALTH_CARD_TAG).assertIsDisplayed()
    }
}
