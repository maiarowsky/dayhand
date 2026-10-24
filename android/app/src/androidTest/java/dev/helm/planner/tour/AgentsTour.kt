package dev.helm.planner.tour

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.agents.AgentControls
import dev.helm.planner.agents.ApprovalDecision
import dev.helm.planner.agents.ApprovalOption
import dev.helm.planner.agents.ApprovalRequest
import dev.helm.planner.agents.ApprovalStatus
import dev.helm.planner.agents.PlanHealth
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.agents.Proposal
import dev.helm.planner.agents.ToolPolicy
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.TodaySections
import dev.helm.planner.ui.agents.AgentsActions
import dev.helm.planner.ui.agents.AgentsPage
import dev.helm.planner.ui.agents.AgentsScreen
import dev.helm.planner.ui.agents.AgentsTags
import dev.helm.planner.ui.agents.AgentsUiState
import dev.helm.planner.ui.agents.MergeTarget
import dev.helm.planner.ui.agents.Section
import dev.helm.planner.ui.today.ConnectionStatus
import dev.helm.planner.ui.today.HealthCard
import dev.helm.planner.ui.today.TodayActions
import dev.helm.planner.ui.today.TodayScreen
import dev.helm.planner.ui.today.TodayUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Screenshots of Settings → Agents (the switch, requests, proposals, policies), a request and its decision, a
 * proposal and merging it, one tool policy's rules, and the plan health card above Today. Synthetic data in Polish, like [ScreenTour].
 */
@RunWith(AndroidJUnit4::class)
class AgentsTour {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val config = TourConfig.fromArguments()

    private val deploy = ApprovalRequest(
        id = "ap1", taskRef = 12, taskTitle = "Wydanie 2.4", action = "Wdrożyć wersję 2.4 na produkcję",
        detail = "Wszystkie testy przeszły; migracja bazy jest jednokierunkowa.",
        options = listOf(
            ApprovalOption("o1", "Wdróż teraz", "Klienci dostaną 2.4 w ciągu 10 minut"),
            ApprovalOption("o2", "Poczekaj do poniedziałku", "Nic się nie zmienia do poniedziałku 9:00"),
        ),
        reversible = false, status = ApprovalStatus.PENDING, expiresAt = 0, createdAt = 0, requestedBy = "claude", policyTool = null, decision = null,
    )
    private val held = deploy.copy(
        id = "ap2", taskRef = 7, taskTitle = "Stare kopie zapasowe", action = "worker chce wywołać delete_task",
        detail = null, reversible = true, requestedBy = "worker", policyTool = "delete_task",
        options = listOf(ApprovalOption("allow", "Pozwól raz", null), ApprovalOption("deny", "Odmów", null)),
    )
    private val earlier = deploy.copy(
        id = "ap0", action = "Wysłać raport do klienta", taskRef = null, taskTitle = null, status = ApprovalStatus.DECIDED,
        decision = ApprovalDecision("o1", "Wyślij", "ok, z poprawką w tabeli", 0),
    )
    private val proposals = listOf(
        Proposal("p1", 31, "Naprawić błąd koszyka przy kodzie rabatowym", "Zgłoszone 14 razy od wczoraj.", "Sentry", "sentry", "CHECKOUT-42", "https://sentry.example/i/42", 0),
        Proposal("p2", 32, "Odpowiedzieć Annie w sprawie umowy", null, "Anna", "email", "m-2210", null, 0),
    )
    private val state = AgentsUiState(
        controls = Section.Loaded(AgentControls(paused = false, pausedAt = null, reason = null, policies = listOf(ToolPolicy("k1", "worker", "*", PolicyRule.ASK), ToolPolicy("k1", "worker", "delete_task", PolicyRule.DENY), ToolPolicy("k2", "claude", "complete_task", PolicyRule.ASK)))),
        approvals = Section.Loaded(listOf(deploy, held, earlier)),
        proposals = Section.Loaded(proposals),
        targets = listOf(
            MergeTarget("s1", "Błędy koszyka", "2026-10-24"),
            MergeTarget("s2", "Przegląd płatności", "2026-10-27"),
            MergeTarget("s3", "Uporządkować backlog", null),
        ),
        timeLabel = { "24 paź 14:30" },
    )

    private var shown by mutableStateOf<AgentsUiState?>(null)

    private fun page(name: String, next: AgentsUiState) {
        if (shown == null) {
            compose.runOnUiThread { compose.activity.tourBars(config.dark) }
            compose.setContent { TourTheme(config) { shown?.let { AgentsScreen(it, object : AgentsActions {}) } } }
        }
        compose.runOnUiThread { shown = next }
        compose.waitForIdle()
        shoot(compose.activity, config, name)
    }

    @Test
    fun pages() {
        page("50-agents", state)
        page("51-agents-paused", state.copy(controls = Section.Loaded(AgentControls(true, 0, "przerwa na lunch", emptyList()))))
        page("52-approval", state.copy(page = AgentsPage.Approval("ap1")))
        compose.onNodeWithTag(AgentsTags.OPTION + "o2").performScrollTo().performClick()
        compose.waitForIdle()
        shoot(compose.activity, config, "53-approval-choose")
    }

    @Test
    fun policyRequestAndProposals() {
        page("54-approval-policy", state.copy(page = AgentsPage.Approval("ap2")))
        page("55-proposal", state.copy(page = AgentsPage.Proposal("p1")))
        page("56-proposal-merge", state.copy(page = AgentsPage.Merge("p1")))
        page("57-approval-decided", state.copy(page = AgentsPage.Approval("ap0")))
        page("59-policy", state.copy(page = AgentsPage.Policy("k2", "complete_task")))
    }

    @Test
    fun todayWithHealthCard() {
        fun task(id: String, title: String, due: String?, time: String? = null) =
            Task(localId = id, title = title, dueDate = due, dueTime = time, createdAt = 0, updatedAt = 0)
        val today = TodayUiState(
            TodaySections(
                "2026-10-24",
                overdue = listOf(task("o1", "Podlać kwiaty", "2026-10-22")),
                now = task("n", "Przegląd płatności", "2026-10-24").copy(isNow = true, status = TaskStatus.DOING),
                today = listOf(task("t1", "Zadzwonić do dentysty", "2026-10-24", "09:30"), task("t2", "Przejrzeć pull request", "2026-10-24")),
                done = emptyList(),
            ),
            ConnectionStatus.SYNCED,
            0,
        )
        val health = PlanHealth(
            agentsPaused = false, overdue = 1, dueToday = 3, inProgress = 1, expiredClaims = 0, blocked = 1,
            awaitingApproval = 1, pendingApprovals = 2, proposals = 2, completedToday = 2, withoutProof = 1, oldestOpenDays = 18,
        )
        compose.runOnUiThread { compose.activity.tourBars(config.dark) }
        compose.setContent { TourTheme(config) { TodayScreen(today, object : TodayActions {}, header = { HealthCard(health, onReview = {}) }) } }
        compose.waitForIdle()
        shoot(compose.activity, config, "58-today-health")
    }
}
