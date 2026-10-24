package dev.helm.planner.ui.today

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.R
import dev.helm.planner.agents.AgentControlApi
import dev.helm.planner.agents.HealthItem
import dev.helm.planner.agents.HealthKind
import dev.helm.planner.agents.HealthSummary
import dev.helm.planner.agents.HealthTone
import dev.helm.planner.agents.Load
import dev.helm.planner.agents.PlanHealth
import dev.helm.planner.ui.components.BannerTone
import dev.helm.planner.ui.components.StatusBanner
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The plan health report (`app:planHealth`) for the card above Today, read when Today opens, comes back to the
 * front or its tasks change. Null hides the card: no server, or never read. A failed read keeps the last report.
 */
class HealthCardViewModel(
    private val api: suspend () -> AgentControlApi?,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val state = MutableStateFlow<PlanHealth?>(null)
    val health: StateFlow<PlanHealth?> = state.asStateFlow()
    private var reading: Job? = null

    fun refresh() {
        if (reading?.isActive == true) return
        reading = viewModelScope.launch {
            val remote = api()
            if (remote == null) {
                state.value = null
                return@launch
            }
            when (val load = remote.health(now())) {
                is Load.Loaded -> state.value = load.value
                Load.Unauthorized -> state.value = null
                is Load.Failed -> {}
            }
        }
    }
}

const val HEALTH_CARD_TAG = "today_health"

/** One line on a soft card: what needs a look, most pressing first; Review opens Agents when the owner is asked. */
@Composable
fun HealthCard(health: PlanHealth?, onReview: () -> Unit, modifier: Modifier = Modifier) {
    health ?: return
    val items = HealthSummary.items(health)
    val text = if (items.isEmpty()) {
        stringResource(R.string.health_clear)
    } else {
        stringResource(R.string.health_title, items.map { itemText(it) }.joinToString(" · "))
    }
    val tone = when (HealthSummary.tone(items)) {
        HealthTone.ACT -> BannerTone.Danger
        HealthTone.LOOK -> BannerTone.Warning
        HealthTone.CALM -> if (items.isEmpty()) BannerTone.Success else BannerTone.Info
    }
    StatusBanner(
        text = text,
        tone = tone,
        action = if (HealthSummary.needsOwner(items)) stringResource(R.string.health_review) else null,
        onAction = onReview,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag(HEALTH_CARD_TAG).then(modifier),
    )
}

@Composable
private fun itemText(item: HealthItem): String {
    val n = item.count
    return when (item.kind) {
        HealthKind.PAUSED -> stringResource(R.string.health_paused)
        HealthKind.OVERDUE -> pluralStringResource(R.plurals.health_overdue, n, n)
        HealthKind.EXPIRED_CLAIMS -> pluralStringResource(R.plurals.health_expired_claims, n, n)
        HealthKind.APPROVALS -> pluralStringResource(R.plurals.health_approvals, n, n)
        HealthKind.BLOCKED -> pluralStringResource(R.plurals.health_blocked, n, n)
        HealthKind.PROPOSALS -> pluralStringResource(R.plurals.health_proposals, n, n)
        HealthKind.WITHOUT_PROOF -> pluralStringResource(R.plurals.health_without_proof, n, n)
        HealthKind.DUE_TODAY -> pluralStringResource(R.plurals.health_due_today, n, n)
        HealthKind.IN_PROGRESS -> pluralStringResource(R.plurals.health_in_progress, n, n)
        HealthKind.DONE_TODAY -> pluralStringResource(R.plurals.health_done_today, n, n)
        HealthKind.OLDEST_OPEN -> pluralStringResource(R.plurals.health_oldest, n, n)
    }
}
