package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.domain.AgentWork.DependencyState
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object AgentWorkTags {
    const val SECTION = "detail-agent"
    const val CLAIM = "detail-claim"
    const val RELEASE = "detail-release"
    const val RELEASE_CONFIRM = "detail-release-confirm"
    const val BLOCKED = "detail-blocked"
    const val WAITING_ON = "detail-waiting-on"
    const val PLAN = "detail-plan"
    const val ACCEPTANCE = "detail-acceptance"
    const val PROOF = "detail-proof"
    fun criterion(index: Int) = "detail-acceptance-$index"
    fun dependency(index: Int) = "detail-dependency-$index"
}

/**
 * What an agent does with the task (backend 0.10.0). An "Agent" card holds "agent: <name> works until 14:30" while a
 * claim lasts, with **End the claim** (after a confirmation) to take the task over, the blocked reason in red, the
 * tasks it waits for ("#12 Send the invoice (done)") and the plan. Below it the acceptance criteria with the ones met
 * ticked, and the proof the task was completed with. Nothing is shown for a task without any of them.
 */
@Composable
internal fun AgentWorkSection(
    task: Task,
    dependencies: List<AgentWork.Dependency>,
    nowMs: Long,
    timezone: String,
    editable: Boolean,
    actions: TaskDetailActions,
) {
    val claim = AgentWork.activeClaim(task, nowMs, timezone)
    if (claim != null || task.blockedReason != null || dependencies.isNotEmpty() || task.plan != null) {
        CardSection(stringResource(R.string.detail_agent), Modifier.testTag(AgentWorkTags.SECTION)) {
            claim?.let { ClaimRow(task, it, editable, actions) }
            task.blockedReason?.let { reason ->
                Text(
                    stringResource(R.string.detail_blocked, reason),
                    style = helmType.bodyStrong,
                    color = palette.danger,
                    modifier = Modifier.testTag(AgentWorkTags.BLOCKED),
                )
            }
            if (dependencies.isNotEmpty()) {
                InfoRow(stringResource(R.string.detail_waiting_on), Modifier.testTag(AgentWorkTags.WAITING_ON)) {
                    dependencies.forEachIndexed { index, dependency -> DependencyLine(dependency, Modifier.testTag(AgentWorkTags.dependency(index))) }
                }
            }
            task.plan?.let { plan ->
                InfoRow(stringResource(R.string.detail_plan), Modifier.testTag(AgentWorkTags.PLAN)) {
                    Text(plan, style = helmType.body, color = palette.text)
                }
            }
        }
    }
    if (task.acceptance.isNotEmpty()) {
        val (met, all) = AgentWork.criteriaMet(task)
        CardSection(stringResource(R.string.acceptance_title_progress, stringResource(R.string.detail_acceptance), met, all)) {
            Column(Modifier.testTag(AgentWorkTags.ACCEPTANCE), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                task.acceptance.forEachIndexed { index, item ->
                    val mark = stringResource(if (item.met) R.string.acceptance_met else R.string.acceptance_unmet)
                    Text(
                        "$mark  ${item.text}",
                        style = helmType.body,
                        color = if (item.met) palette.text else palette.textMuted,
                        modifier = Modifier.testTag(AgentWorkTags.criterion(index)),
                    )
                }
            }
        }
    }
    task.proof?.let { ProofCard(it) }
}

/** Who works on the task and until when, and the owner's way to take it over at once. */
@Composable
private fun ClaimRow(task: Task, claim: AgentWork.Claim, editable: Boolean, actions: TaskDetailActions) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    Text(
        stringResource(R.string.agent_works_until, claim.name, claim.until),
        style = helmType.smallStrong,
        color = palette.accent,
        modifier = Modifier.testTag(AgentWorkTags.CLAIM),
    )
    if (editable) {
        DetailAction(
            stringResource(R.string.release_claim),
            { confirming = true },
            Icons.Filled.Close,
            Modifier.testTag(AgentWorkTags.RELEASE),
        )
    }
    if (confirming) {
        HelmDialog(
            title = stringResource(R.string.release_claim_title, claim.name),
            onDismiss = { confirming = false },
            confirm = stringResource(R.string.release_claim),
            onConfirm = {
                confirming = false
                actions.release(task.localId)
            },
            dismiss = stringResource(R.string.cancel),
            confirmTag = AgentWorkTags.RELEASE_CONFIRM,
        ) {
            Text(stringResource(R.string.release_claim_text, claim.name), style = helmType.body)
        }
    }
}

/** "✓  #12 Send the invoice (done)", "○  #14 Pay the VAT", or a task not on this phone. */
@Composable
private fun DependencyLine(dependency: AgentWork.Dependency, modifier: Modifier) {
    val name = dependency.title?.let { title ->
        dependency.ref?.let { stringResource(R.string.dependency_with_ref, it, title) } ?: title
    }
    val text = when (dependency.state) {
        DependencyState.OPEN -> name.orEmpty()
        DependencyState.DONE -> stringResource(R.string.dependency_done, name.orEmpty())
        DependencyState.IN_TRASH -> stringResource(R.string.dependency_in_trash, name.orEmpty())
        DependencyState.MISSING -> stringResource(R.string.dependency_missing)
    }
    val open = dependency.state == DependencyState.OPEN
    val mark = when (dependency.state) {
        DependencyState.OPEN -> stringResource(R.string.acceptance_unmet)
        DependencyState.DONE, DependencyState.IN_TRASH -> stringResource(R.string.acceptance_met)
        DependencyState.MISSING -> null
    }
    Text(
        mark?.let { "$it  $text" } ?: text,
        style = helmType.body,
        color = if (open) palette.text else palette.textMuted,
        modifier = modifier,
    )
}

/** A muted label (a heading for screen readers) over its content. */
@Composable
private fun InfoRow(label: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = helmType.smallStrong, color = palette.textMuted, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
private fun ProofCard(proof: TaskProof) {
    CardSection(stringResource(R.string.detail_proof)) {
        Column(Modifier.testTag(AgentWorkTags.PROOF), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            proof.summary?.let { Text(it, style = helmType.body, color = palette.text) }
            proof.checks.forEach { check ->
                val result = stringResource(if (check.passed) R.string.proof_check_pass else R.string.proof_check_fail)
                Text("$result  ${check.name}", style = helmType.small, color = if (check.passed) palette.text else palette.danger)
            }
            proof.links.forEach { link -> Text(link.title ?: link.url, style = helmType.small, color = palette.accent) }
            if (proof.summary == null && proof.checks.isEmpty() && proof.links.isEmpty()) Placeholder(stringResource(R.string.proof_empty))
        }
    }
}
