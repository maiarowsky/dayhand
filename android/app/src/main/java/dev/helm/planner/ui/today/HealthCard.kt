package dev.helm.planner.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
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
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The plan health report (`app:planHealth`) for the line above Today, read when Today opens, comes back to the
 * front or its tasks change. Null hides the line: no server, or never read. A failed read keeps the last report.
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

/**
 * One thin line of counters above the list, most pressing first, with a dot in the tone of the most pressing one; no
 * card. When the owner is asked something the line opens Agents ([onReview]).
 */
@Composable
fun HealthCard(health: PlanHealth?, onReview: () -> Unit, modifier: Modifier = Modifier) {
    health ?: return
    val p = palette
    val items = HealthSummary.items(health)
    val text = if (items.isEmpty()) {
        stringResource(R.string.health_clear)
    } else {
        stringResource(R.string.health_title, items.map { itemText(it) }.joinToString(" · "))
    }
    val dot = when (HealthSummary.tone(items)) {
        HealthTone.ACT -> p.danger
        HealthTone.LOOK -> p.warning
        HealthTone.CALM -> if (items.isEmpty()) p.success else p.textFaint
    }
    val review = if (HealthSummary.needsOwner(items)) stringResource(R.string.health_review) else null
    Row(
        verticalAlignment = Alignment.Top,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (review != null) Modifier.heightIn(min = HelmDimens.touchTarget).clickable(onClick = onReview) else Modifier)
            .padding(horizontal = HelmDimens.screenMargin, vertical = 4.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .testTag(HEALTH_CARD_TAG)
            .then(modifier),
    ) {
        Box(Modifier.padding(top = DOT_TOP).size(DOT_SIZE).clip(CircleShape).background(dot))
        Text(text, style = helmType.small, color = p.textMuted, modifier = Modifier.weight(1f).padding(start = 8.dp))
        if (review != null) Text(review, style = helmType.smallStrong, color = p.accent, modifier = Modifier.padding(start = 12.dp))
    }
}

private val DOT_SIZE = 8.dp
/** Centres the dot on the first line of small text (18 sp high), however many lines the counters take. */
private val DOT_TOP = 5.dp

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
