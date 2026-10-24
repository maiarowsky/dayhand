package dev.helm.planner.ui.agents

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.AppContainer
import dev.helm.planner.agents.AgentControlApi
import dev.helm.planner.agents.AgentControls
import dev.helm.planner.agents.Change
import dev.helm.planner.agents.Load
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.ui.common.appLocale
import dev.helm.planner.ui.common.dateFormat
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Settings → Agents: the switch that pauses every agent, approval requests, the proposal inbox and the tool
 * policies, changed one rule at a time. Nothing is persisted: sections are read on entry and after a decision
 * succeeds or is finally refused. Failed sends keep the current state for retry. [api] is null while the phone
 * is not connected to a server; [tasks] are the plan on the phone, the tasks a proposal can merge into.
 */
class AgentsViewModel(
    private val api: suspend () -> AgentControlApi?,
    tasks: Flow<List<Task>> = emptyFlow(),
    private val cancelNotification: (String) -> Unit = {},
) : ViewModel() {
    private val state = MutableStateFlow(AgentsUiState())
    val ui: StateFlow<AgentsUiState> = state.asStateFlow()

    init {
        reload()
        viewModelScope.launch { tasks.collect { all -> state.update { it.copy(targets = mergeTargets(all)) } } }
    }

    fun reload() = launch {
        val remote = api() ?: return@launch state.update {
            it.copy(controls = Section.Failed(true), approvals = Section.Failed(true), proposals = Section.Failed(true))
        }
        val controls = remote.controls().toSection()
        val approvals = remote.approvals().toSection()
        val proposals = remote.proposals().toSection()
        state.update { it.copy(controls = controls, approvals = approvals, proposals = proposals) }
    }

    /** One tap pauses every agent key and connection; reading stays allowed. */
    fun setPaused(paused: Boolean) = launch {
        val current = (state.value.controls as? Section.Loaded)?.value ?: return@launch
        if (state.value.busy) return@launch
        state.update { it.copy(busy = true, message = null, controls = Section.Loaded(current.copy(paused = paused))) }
        val done = api()?.pause(paused) == Change.Done
        state.update { it.copy(busy = false, message = if (done) null else AgentsMessage.PAUSE_FAILED) }
        reload()
    }

    fun open(page: AgentsPage) = state.update { it.copy(page = page, message = null) }

    fun back() = state.update {
        val page = it.page
        it.copy(page = if (page is AgentsPage.Merge) AgentsPage.Proposal(page.proposalId) else AgentsPage.Main)
    }

    fun decide(approvalId: String, optionId: String, note: String?) = change(
        run = { it.decide(approvalId, optionId, note) },
        done = AgentsMessage.DECIDED,
        refused = { AgentsMessage.DECIDE_REFUSED },
        after = { cancelNotification(approvalId) },
    )

    fun accept(proposalId: String) = change({ it.accept(proposalId) }, AgentsMessage.ACCEPTED, { AgentsMessage.PROPOSAL_GONE })

    fun merge(proposalId: String, intoTaskId: String) =
        change({ it.merge(proposalId, intoTaskId) }, AgentsMessage.MERGED, { AgentsMessage.PROPOSAL_GONE })

    fun reject(proposalId: String, reason: String?) =
        change({ it.reject(proposalId, reason) }, AgentsMessage.REJECTED, { AgentsMessage.PROPOSAL_GONE })

    /** The rule goes to the server at once; `dayhand policy` shows it after. A refusal says why in words. */
    fun setPolicy(keyId: String, tool: String, rule: PolicyRule) = change(
        run = { it.setPolicy(keyId, tool, rule) },
        done = AgentsMessage.POLICY_SET,
        refused = { if (it.code == "not_found") AgentsMessage.POLICY_KEY_GONE else AgentsMessage.POLICY_REFUSED },
    )

    /** Success or a final refusal reloads the list; a failed send keeps the page open for retry. */
    private fun change(
        run: suspend (AgentControlApi) -> Change,
        done: AgentsMessage,
        refused: (Change.Refused) -> AgentsMessage,
        after: () -> Unit = {},
    ) = launch {
        if (state.value.busy) return@launch
        state.update { it.copy(busy = true, message = null) }
        val result = api()?.let { run(it) }
        val message = when (result) {
            Change.Done -> done
            is Change.Refused -> refused(result)
            Change.Unauthorized, is Change.Failed, null -> AgentsMessage.FAILED
        }
        if (result == Change.Done || result is Change.Refused) after()
        // A failure keeps the page open so the owner can try again; anything else goes back to the list.
        state.update {
            it.copy(busy = false, message = message, page = if (message == AgentsMessage.FAILED) it.page else AgentsPage.Main)
        }
        if (message != AgentsMessage.FAILED) reload()
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    companion object {
        /** Open tasks on the phone that the server knows, by due day (undated last), then title. */
        fun mergeTargets(tasks: List<Task>): List<MergeTarget> = tasks
            .filter { it.isActive && it.status != TaskStatus.DONE && it.serverId != null }
            .sortedWith(compareBy<Task>({ it.dueDate == null }, { it.dueDate }, { it.title.lowercase() }))
            .map { MergeTarget(it.serverId!!, it.title, it.dueDate) }
    }
}

private fun <T> Load<T>.toSection(): Section<T> = when (this) {
    is Load.Loaded -> Section.Loaded(value)
    Load.Unauthorized -> Section.Failed(unauthorized = true)
    is Load.Failed -> Section.Failed(unauthorized = false)
}

/** Settings → Agents, signed in as the paired owner; also opened from the health card and a request's notification. */
@Composable
fun AgentsRoute(container: AppContainer, onBack: () -> Unit) {
    val viewModel = viewModel {
        AgentsViewModel(
            api = { container.settings.current().backend?.let(container::agentControlApi) },
            tasks = container.repository.tasks,
            cancelNotification = container.notifier::cancelApproval,
        )
    }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val locale = appLocale()
    val format = remember(locale) { dateFormat("dMMMHHmm", locale).withZone(ZoneId.systemDefault()) }
    val actions = remember(viewModel) {
        object : AgentsActions {
            override fun reload() = viewModel.reload()
            override fun setPaused(paused: Boolean) = viewModel.setPaused(paused)
            override fun open(page: AgentsPage) = viewModel.open(page)
            override fun back() = if (viewModel.ui.value.page == AgentsPage.Main) onBack() else viewModel.back()
            override fun decide(approvalId: String, optionId: String, note: String?) = viewModel.decide(approvalId, optionId, note)
            override fun accept(proposalId: String) = viewModel.accept(proposalId)
            override fun merge(proposalId: String, intoTaskId: String) = viewModel.merge(proposalId, intoTaskId)
            override fun reject(proposalId: String, reason: String?) = viewModel.reject(proposalId, reason)
            override fun setPolicy(keyId: String, tool: String, rule: PolicyRule) = viewModel.setPolicy(keyId, tool, rule)
        }
    }
    AgentsScreen(ui.copy(timeLabel = { format.format(Instant.ofEpochMilli(it)) }), actions)
}

/** What [AgentControls] the page shows while the switch is being changed. */
internal val Section<AgentControls>.paused: Boolean get() = (this as? Section.Loaded)?.value?.paused == true
