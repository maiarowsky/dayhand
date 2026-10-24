package dev.helm.planner.ui.agents

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.agents.AgentControls
import dev.helm.planner.agents.ApprovalOption
import dev.helm.planner.agents.ApprovalRequest
import dev.helm.planner.agents.ApprovalStatus
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.agents.Proposal
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.HelmTextField
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.components.helmSwitchColors
import dev.helm.planner.ui.settings.SettingsPage
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object AgentsTags {
    const val PAGE = "agents_page"
    const val PAUSE = "agents_pause"
    const val STATUS = "agents_status"
    const val MESSAGE = "agents_message"
    const val APPROVAL = "agents_approval_"
    const val EARLIER = "agents_earlier_"
    const val PROPOSAL = "agents_proposal_"
    const val POLICY = "agents_policy_"
    const val POLICY_PAGE = "agents_policy_page"
    const val RULE = "agents_rule_"
    const val APPROVAL_PAGE = "agents_approval_page"
    const val OPTION = "agents_option_"
    const val CHOOSE = "agents_choose"
    const val NOTE = "agents_note"
    const val DECISION = "agents_decision"
    const val PROPOSAL_PAGE = "agents_proposal_page"
    const val ACCEPT = "agents_accept"
    const val MERGE = "agents_merge"
    const val REJECT = "agents_reject"
    const val REJECT_CONFIRM = "agents_reject_confirm"
    const val MERGE_PAGE = "agents_merge_page"
    const val SEARCH = "agents_merge_search"
    const val TARGET = "agents_target_"
    const val MERGE_CONFIRM = "agents_merge_confirm"
}

sealed interface Section<out T> {
    data object Loading : Section<Nothing>
    data class Loaded<T>(val value: T) : Section<T>
    data class Failed(val unauthorized: Boolean) : Section<Nothing>
}

/** The list, one approval request, one proposal, the tasks a proposal can merge into, or one tool policy. */
sealed interface AgentsPage {
    data object Main : AgentsPage
    data class Approval(val id: String) : AgentsPage
    data class Proposal(val id: String) : AgentsPage
    data class Merge(val proposalId: String) : AgentsPage
    data class Policy(val keyId: String, val tool: String) : AgentsPage
}

/** What happened to the owner's last change, shown on the list or the retained policy page. */
enum class AgentsMessage {
    DECIDED, DECIDE_REFUSED, ACCEPTED, MERGED, REJECTED, PROPOSAL_GONE, PAUSE_FAILED, POLICY_SET, POLICY_KEY_GONE, POLICY_REFUSED, FAILED,
}

/** A task a proposal can be merged into: open, on the phone and known to the server. */
data class MergeTarget(val serverId: String, val title: String, val dueDate: String?)

data class AgentsUiState(
    val controls: Section<AgentControls> = Section.Loading,
    val approvals: Section<List<ApprovalRequest>> = Section.Loading,
    val proposals: Section<List<Proposal>> = Section.Loading,
    val page: AgentsPage = AgentsPage.Main,
    val busy: Boolean = false,
    val message: AgentsMessage? = null,
    val targets: List<MergeTarget> = emptyList(),
    /** Formats a time (the phone's zone and language). */
    val timeLabel: (Long) -> String = { it.toString() },
)

interface AgentsActions {
    fun reload() {}
    fun setPaused(paused: Boolean) {}
    fun open(page: AgentsPage) {}
    fun back() {}
    fun decide(approvalId: String, optionId: String, note: String?) {}
    fun accept(proposalId: String) {}
    fun merge(proposalId: String, intoTaskId: String) {}
    fun reject(proposalId: String, reason: String?) {}
    fun setPolicy(keyId: String, tool: String, rule: PolicyRule) {}
}

/** Earlier requests shown under the waiting ones. */
private const val EARLIER_SHOWN = 10

/**
 * Settings → Agents (docs/agent-work.md): pause every agent with one switch, decide approval requests in the style
 * of a new connection's approval, accept, merge or reject proposals, and change the tool policies set with
 * `dayhand policy`. Dayhand records a decision; an agent acts on it, and Dayhand cannot stop one outside itself.
 */
@Composable
fun AgentsScreen(state: AgentsUiState, actions: AgentsActions) {
    BackHandler(onBack = actions::back)
    when (val page = state.page) {
        AgentsPage.Main -> MainPage(state, actions)
        is AgentsPage.Approval -> {
            val request = (state.approvals as? Section.Loaded)?.value?.firstOrNull { it.id == page.id }
            SettingsPage(stringResource(R.string.agents_approval_title), actions::back, AgentsTags.APPROVAL_PAGE) {
                if (request == null) ListNote(stringResource(R.string.agents_gone)) else ApprovalPage(request, state, actions)
            }
        }
        is AgentsPage.Proposal -> {
            val proposal = (state.proposals as? Section.Loaded)?.value?.firstOrNull { it.id == page.id }
            SettingsPage(stringResource(R.string.agents_proposal_title), actions::back, AgentsTags.PROPOSAL_PAGE) {
                if (proposal == null) ListNote(stringResource(R.string.agents_gone)) else ProposalPage(proposal, state, actions)
            }
        }
        is AgentsPage.Merge -> MergePage(page.proposalId, state, actions)
        is AgentsPage.Policy -> PolicyPage(page, state, actions)
    }
}

@Composable
private fun MainPage(state: AgentsUiState, actions: AgentsActions) {
    SettingsPage(stringResource(R.string.agents_title), actions::back, AgentsTags.PAGE) {
        MessageGroup(state.message)
        PauseGroup(state, actions)
        ApprovalGroups(state, actions)
        ProposalGroup(state, actions)
        PolicyGroup(state.controls, actions)
        ListNote(stringResource(R.string.agents_hint))
    }
}

@Composable
private fun PauseGroup(state: AgentsUiState, actions: AgentsActions) {
    when (val controls = state.controls) {
        Section.Loading -> Status(stringResource(R.string.agents_loading), loading = true)
        is Section.Failed -> Status(stringResource(if (controls.unauthorized) R.string.agents_unauthorized else R.string.agents_failed), loading = false)
        is Section.Loaded -> {
            val value = controls.value
            val note = if (value.paused) {
                val since = value.pausedAt?.let { stringResource(R.string.agents_paused_since, state.timeLabel(it)) }
                listOfNotNull(since, value.reason, stringResource(R.string.agents_paused_note)).joinToString(" · ")
            } else {
                stringResource(R.string.agents_running_note)
            }
            val interaction = remember { MutableInteractionSource() }
            ListGroup(
                null,
                rows = listOf {
                    ListRow(
                        stringResource(R.string.agents_pause),
                        AgentsTags.PAUSE,
                        modifier = Modifier.toggleable(value.paused, interaction, null, enabled = !state.busy, role = Role.Switch) {
                            actions.setPaused(it)
                        },
                        icon = if (value.paused) LineIcon.Warning else LineIcon.Check,
                        note = note,
                        titleColor = if (value.paused) palette.danger else palette.text,
                        enabled = !state.busy,
                        trailing = {
                            Switch(
                                checked = value.paused,
                                onCheckedChange = null,
                                enabled = !state.busy,
                                interactionSource = interaction,
                                colors = helmSwitchColors(),
                            )
                        },
                    )
                },
            )
        }
    }
}

@Composable
private fun ApprovalGroups(state: AgentsUiState, actions: AgentsActions) {
    val approvals = (state.approvals as? Section.Loaded)?.value ?: return
    val waiting = approvals.filter { it.status == ApprovalStatus.PENDING }
    if (waiting.isEmpty()) {
        ListNote(stringResource(R.string.agents_no_requests))
    } else {
        ListGroup(
            stringResource(R.string.agents_waiting, waiting.size),
            rows = waiting.map { request ->
                {
                    val about = request.taskRef?.let { " · #$it" }.orEmpty()
                    ListRow(
                        request.action,
                        AgentsTags.APPROVAL + request.id,
                        icon = LineIcon.Bell,
                        note = stringResource(R.string.agents_request_note, request.requestedBy, state.timeLabel(request.expiresAt)) + about,
                        onClick = { actions.open(AgentsPage.Approval(request.id)) },
                    )
                }
            },
        )
    }
    val earlier = approvals.filter { it.status != ApprovalStatus.PENDING }.take(EARLIER_SHOWN)
    if (earlier.isNotEmpty()) {
        ListGroup(
            stringResource(R.string.agents_earlier),
            rows = earlier.map { request ->
                {
                    ListRow(
                        request.action,
                        AgentsTags.EARLIER + request.id,
                        icon = if (request.status == ApprovalStatus.DECIDED) LineIcon.Check else LineIcon.Clock,
                        note = outcomeText(request),
                        onClick = { actions.open(AgentsPage.Approval(request.id)) },
                    )
                }
            },
        )
    }
}

@Composable
private fun ProposalGroup(state: AgentsUiState, actions: AgentsActions) {
    val proposals = (state.proposals as? Section.Loaded)?.value ?: return
    if (proposals.isEmpty()) {
        ListNote(stringResource(R.string.agents_no_proposals))
        return
    }
    ListGroup(
        stringResource(R.string.agents_proposals, proposals.size),
        rows = proposals.map { proposal ->
            { ListRow(proposal.title, AgentsTags.PROPOSAL + proposal.id, icon = LineIcon.List, note = proposalOrigin(proposal)) { actions.open(AgentsPage.Proposal(proposal.id)) } }
        },
    )
}

@Composable
private fun ApprovalPage(request: ApprovalRequest, state: AgentsUiState, actions: AgentsActions) {
    var choosing by rememberSaveable { mutableStateOf<String?>(null) }
    Text(request.action, style = helmType.title, color = palette.text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    ListGroup(
        null,
        rows = buildList<@Composable () -> Unit> {
            add { ListRow(stringResource(R.string.agents_asked_by, request.requestedBy), "agents_asked_by", icon = LineIcon.Info, note = state.timeLabel(request.createdAt)) }
            if (request.taskTitle != null) {
                add { ListRow(listOfNotNull(request.taskRef?.let { "#$it" }, request.taskTitle).joinToString(" "), "agents_task", icon = LineIcon.List) }
            }
            request.policyTool?.let { tool -> add { ListRow(stringResource(R.string.agents_policy_held, tool), "agents_policy_tool", icon = LineIcon.Code) } }
            add {
                if (request.reversible) {
                    ListRow(stringResource(R.string.agents_reversible), "agents_reversible", icon = LineIcon.Refresh)
                } else {
                    ListRow(stringResource(R.string.agents_irreversible), "agents_reversible", icon = LineIcon.Warning, titleColor = palette.danger)
                }
            }
            if (request.status == ApprovalStatus.PENDING) {
                add { ListRow(stringResource(R.string.agents_decide_by, state.timeLabel(request.expiresAt)), "agents_expires", icon = LineIcon.Clock) }
            }
        },
    )
    request.detail?.let { ListNote(it) }
    if (request.status == ApprovalStatus.PENDING) {
        ListGroup(
            stringResource(R.string.agents_choose),
            rows = request.options.map { option ->
                {
                    ListRow(
                        option.label,
                        AgentsTags.OPTION + option.id,
                        note = option.consequence,
                        titleColor = palette.accent,
                        enabled = !state.busy,
                        onClick = { choosing = option.id },
                    )
                }
            },
        )
        ListNote(stringResource(R.string.agents_decision_hint))
    } else {
        ListGroup(null, rows = listOf { ListRow(outcomeText(request), AgentsTags.DECISION, icon = LineIcon.Check, note = request.decision?.note) })
    }
    if (state.busy) Status(stringResource(R.string.agents_sending), loading = true)
    request.options.firstOrNull { it.id == choosing }?.let { option ->
        ChooseDialog(option, request.reversible, onDismiss = { choosing = null }) { note ->
            choosing = null
            actions.decide(request.id, option.id, note)
        }
    }
}

@Composable
private fun ChooseDialog(option: ApprovalOption, reversible: Boolean, onDismiss: () -> Unit, onConfirm: (String?) -> Unit) {
    var note by rememberSaveable { mutableStateOf("") }
    HelmDialog(
        title = stringResource(R.string.agents_choose_title, option.label),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.agents_choose_confirm),
        onConfirm = { onConfirm(note.takeIf { it.isNotBlank() }) },
        dismiss = stringResource(android.R.string.cancel),
        confirmTag = AgentsTags.CHOOSE,
    ) {
        Column {
            option.consequence?.let { Text(it, style = helmType.body, color = palette.textMuted) }
            if (!reversible) Text(stringResource(R.string.agents_irreversible), style = helmType.body, color = palette.danger)
            HelmTextField(
                value = note,
                onValueChange = { note = it.take(MAX_NOTE) },
                modifier = Modifier.testTag(AgentsTags.NOTE),
                label = stringResource(R.string.agents_note_label),
            )
        }
    }
}

@Composable
private fun ProposalPage(proposal: Proposal, state: AgentsUiState, actions: AgentsActions) {
    var rejecting by rememberSaveable { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    Text(proposal.title, style = helmType.title, color = palette.text)
    ListGroup(
        null,
        rows = buildList<@Composable () -> Unit> {
            proposal.requestedBy?.let { add { ListRow(stringResource(R.string.agents_requested_by, it), "agents_requested_by", icon = LineIcon.Info) } }
            if (proposal.sourceKind != null) {
                add {
                    ListRow(
                        "${proposal.sourceKind}:${proposal.sourceRef.orEmpty()}",
                        "agents_source",
                        icon = LineIcon.Link,
                        note = proposal.sourceUrl,
                        chevron = false,
                        onClick = proposal.sourceUrl?.let { url -> { openLink(uri, url) } },
                    )
                }
            }
            add { ListRow(stringResource(R.string.agents_proposed_at, state.timeLabel(proposal.proposedAt)), "agents_proposed_at", icon = LineIcon.Clock) }
        },
    )
    proposal.note?.let { ListNote(it) }
    ListGroup(
        null,
        rows = listOf(
            {
                ListRow(
                    stringResource(R.string.agents_accept),
                    AgentsTags.ACCEPT,
                    icon = LineIcon.Check,
                    note = stringResource(R.string.agents_accept_note),
                    titleColor = palette.accent,
                    enabled = !state.busy,
                    chevron = false,
                    onClick = { actions.accept(proposal.id) },
                )
            },
            {
                ListRow(
                    stringResource(R.string.agents_merge),
                    AgentsTags.MERGE,
                    icon = LineIcon.Copy,
                    note = stringResource(R.string.agents_merge_note),
                    enabled = !state.busy,
                    onClick = { actions.open(AgentsPage.Merge(proposal.id)) },
                )
            },
            {
                ListRow(
                    stringResource(R.string.agents_reject),
                    AgentsTags.REJECT,
                    icon = LineIcon.Unlink,
                    titleColor = palette.danger,
                    enabled = !state.busy,
                    chevron = false,
                    onClick = { rejecting = true },
                )
            },
        ),
    )
    if (state.busy) Status(stringResource(R.string.agents_sending), loading = true)
    if (rejecting) {
        var reason by rememberSaveable { mutableStateOf("") }
        HelmDialog(
            title = stringResource(R.string.agents_reject_title, proposal.title),
            onDismiss = { rejecting = false },
            confirm = stringResource(R.string.agents_reject),
            onConfirm = {
                rejecting = false
                actions.reject(proposal.id, reason.takeIf { it.isNotBlank() })
            },
            dismiss = stringResource(android.R.string.cancel),
            destructive = true,
            confirmTag = AgentsTags.REJECT_CONFIRM,
        ) {
            HelmTextField(
                value = reason,
                onValueChange = { reason = it.take(MAX_NOTE) },
                modifier = Modifier.testTag(AgentsTags.NOTE),
                label = stringResource(R.string.agents_reason_label),
            )
        }
    }
}

@Composable
private fun MergePage(proposalId: String, state: AgentsUiState, actions: AgentsActions) {
    var query by rememberSaveable { mutableStateOf("") }
    var chosen by rememberSaveable { mutableStateOf<String?>(null) }
    val shown = state.targets.filter { query.isBlank() || it.title.contains(query.trim(), ignoreCase = true) }
    SettingsPage(
        stringResource(R.string.agents_merge_title),
        actions::back,
        AgentsTags.MERGE_PAGE,
        pinned = {
            HelmTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.testTag(AgentsTags.SEARCH),
                placeholder = stringResource(R.string.agents_merge_search),
                singleLine = true,
            )
        },
    ) {
        if (shown.isEmpty()) {
            ListNote(stringResource(R.string.agents_merge_none))
        } else {
            ListGroup(
                null,
                rows = shown.map { target ->
                    { ListRow(target.title, AgentsTags.TARGET + target.serverId, value = target.dueDate, chevron = false, enabled = !state.busy) { chosen = target.serverId } }
                },
            )
        }
    }
    state.targets.firstOrNull { it.serverId == chosen }?.let { target ->
        HelmDialog(
            title = stringResource(R.string.agents_merge_confirm_title, target.title),
            onDismiss = { chosen = null },
            confirm = stringResource(R.string.agents_merge_confirm),
            onConfirm = {
                chosen = null
                actions.merge(proposalId, target.serverId)
            },
            dismiss = stringResource(android.R.string.cancel),
            confirmTag = AgentsTags.MERGE_CONFIRM,
        ) { Text(stringResource(R.string.agents_merge_confirm_text), style = helmType.body, color = palette.textMuted) }
    }
}

@Composable
internal fun Status(text: String, loading: Boolean) {
    ListGroup(
        null,
        rows = listOf {
            ListRow(
                text,
                AgentsTags.STATUS,
                icon = if (loading) null else LineIcon.Warning,
                trailing = if (loading) {
                    { CircularProgressIndicator(color = palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp)) }
                } else {
                    null
                },
            )
        },
    )
}

/** A status line in a group, read out when it appears. */
@Composable
internal fun MessageGroup(message: AgentsMessage?) {
    if (message == null) return
    ListGroup(
        null,
        rows = listOf {
            ListRow(
                messageText(message),
                AgentsTags.MESSAGE,
                modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                icon = messageIcon(message),
            )
        },
    )
}

@Composable
private fun outcomeText(request: ApprovalRequest): String = request.decision?.let { stringResource(R.string.agents_chose, it.label) }
    ?: stringResource(R.string.agents_expired)

@Composable
private fun proposalOrigin(proposal: Proposal): String? = listOfNotNull(
    proposal.requestedBy?.let { stringResource(R.string.agents_from, it) },
    proposal.sourceKind?.let { "$it:${proposal.sourceRef.orEmpty()}" },
).joinToString(" · ").ifEmpty { null }

@Composable
private fun messageText(message: AgentsMessage): String = stringResource(
    when (message) {
        AgentsMessage.DECIDED -> R.string.agents_decided
        AgentsMessage.DECIDE_REFUSED -> R.string.agents_decide_refused
        AgentsMessage.ACCEPTED -> R.string.agents_accepted
        AgentsMessage.MERGED -> R.string.agents_merged
        AgentsMessage.REJECTED -> R.string.agents_rejected
        AgentsMessage.PROPOSAL_GONE -> R.string.agents_proposal_gone
        AgentsMessage.PAUSE_FAILED -> R.string.agents_pause_failed
        AgentsMessage.POLICY_SET -> R.string.agents_policy_set
        AgentsMessage.POLICY_KEY_GONE -> R.string.agents_policy_key_gone
        AgentsMessage.POLICY_REFUSED -> R.string.agents_policy_refused
        AgentsMessage.FAILED -> R.string.agents_change_failed
    },
)

private fun messageIcon(message: AgentsMessage): LineIcon = when (message) {
    AgentsMessage.DECIDED, AgentsMessage.ACCEPTED, AgentsMessage.MERGED, AgentsMessage.REJECTED, AgentsMessage.POLICY_SET -> LineIcon.Check
    else -> LineIcon.Warning
}

private const val MAX_NOTE = 1000

/** A source's address in the browser; a phone without one is not a crash. */
private fun openLink(uri: UriHandler, url: String) {
    try {
        uri.openUri(url)
    } catch (_: IllegalArgumentException) {
    }
}
