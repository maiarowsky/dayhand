package dev.helm.planner.ui.agents

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import dev.helm.planner.R
import dev.helm.planner.agents.AgentControls
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.agents.ToolPolicy
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.settings.SettingsPage
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** The rules set for agent keys, one row each ("Key claude: complete_task → Ask"); a tap opens the rule. */
@Composable
internal fun PolicyGroup(controls: Section<AgentControls>, actions: AgentsActions) {
    val policies = (controls as? Section.Loaded)?.value?.policies ?: return
    if (policies.isEmpty()) {
        ListNote(stringResource(R.string.agents_no_policies))
        return
    }
    ListGroup(
        stringResource(R.string.agents_policies),
        rows = policies.mapIndexed { index, policy ->
            {
                ListRow(
                    policyName(policy),
                    AgentsTags.POLICY + index,
                    icon = LineIcon.Code,
                    value = ruleText(policy.rule),
                    onClick = { actions.open(AgentsPage.Policy(policy.keyId, policy.tool)) },
                )
            }
        },
    )
    ListNote(stringResource(R.string.agents_policies_hint))
}

/** One rule: allow, ask or deny, each with what it does; a tap on another one sends it to the server. */
@Composable
internal fun PolicyPage(page: AgentsPage.Policy, state: AgentsUiState, actions: AgentsActions) {
    val policy = (state.controls as? Section.Loaded)?.value?.policies?.firstOrNull { it.keyId == page.keyId && it.tool == page.tool }
    SettingsPage(stringResource(R.string.agents_policy_title), actions::back, AgentsTags.POLICY_PAGE) {
        MessageGroup(state.message)
        if (policy == null) {
            ListNote(stringResource(R.string.agents_gone))
            return@SettingsPage
        }
        val tool = toolText(policy.tool)
        Text(policyName(policy), style = helmType.title, color = palette.text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        ListGroup(
            stringResource(R.string.agents_policy_rule),
            rows = PolicyRule.entries.map { rule ->
                {
                    val current = rule == policy.rule
                    ListRow(
                        ruleText(rule),
                        AgentsTags.RULE + rule.wire,
                        modifier = Modifier.semantics { selected = current },
                        note = consequence(rule, tool, policy.keyName),
                        titleColor = if (rule == PolicyRule.DENY) palette.danger else palette.text,
                        enabled = !state.busy,
                        trailing = if (current) ({ LineIconView(LineIcon.Check, palette.accent) }) else null,
                        chevron = false,
                        onClick = if (current) null else ({ actions.setPolicy(policy.keyId, policy.tool, rule) }),
                    )
                }
            },
        )
        ListNote(stringResource(R.string.agents_policy_hint))
        if (state.busy) Status(stringResource(R.string.agents_sending), loading = true)
    }
}

@Composable
private fun policyName(policy: ToolPolicy): String = stringResource(R.string.agents_policy_name, policy.keyName, toolText(policy.tool))

@Composable
private fun toolText(tool: String): String = if (tool == ToolPolicy.ANY_TOOL) stringResource(R.string.agents_policy_any_tool) else tool

@Composable
private fun consequence(rule: PolicyRule, tool: String, key: String): String = when (rule) {
    PolicyRule.ALLOW -> stringResource(R.string.agents_rule_allow_note, key, tool)
    PolicyRule.ASK -> stringResource(R.string.agents_rule_ask_note, key, tool)
    PolicyRule.DENY -> stringResource(R.string.agents_rule_deny_note, key, tool)
}

@Composable
internal fun ruleText(rule: PolicyRule): String = stringResource(
    when (rule) {
        PolicyRule.ALLOW -> R.string.agents_rule_allow
        PolicyRule.ASK -> R.string.agents_rule_ask
        PolicyRule.DENY -> R.string.agents_rule_deny
    },
)
