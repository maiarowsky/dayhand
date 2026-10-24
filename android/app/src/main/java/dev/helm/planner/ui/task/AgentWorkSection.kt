package dev.helm.planner.ui.task

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskProof
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.ui.components.CardSection
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object AgentWorkTags {
    const val CLAIM = "detail-claim"
    const val ACCEPTANCE = "detail-acceptance"
    const val PROOF = "detail-proof"
    fun criterion(index: Int) = "detail-acceptance-$index"
}

/**
 * What an agent does with the task (backend 0.10.0), read-only: "agent: <name> works until 14:30" while a claim
 * lasts, the acceptance criteria with the ones met ticked, and the proof the task was completed with. Nothing is
 * shown for a task without any of them.
 */
@Composable
internal fun AgentWorkSection(task: Task, nowMs: Long, timezone: String) {
    val claim = AgentWork.activeClaim(task, nowMs, timezone)
    if (claim != null) {
        Text(
            stringResource(R.string.agent_works_until, claim.name, claim.until),
            style = helmType.smallStrong,
            color = palette.accent,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp).testTag(AgentWorkTags.CLAIM),
        )
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
