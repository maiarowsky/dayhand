package dev.helm.planner.ui.common

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import dev.helm.planner.R
import dev.helm.planner.domain.AgentWork
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

object BlockedTags {
    fun mark(localId: String) = "blocked-$localId"
}

/**
 * "⛔" before the title of a task that cannot go on, on Today and the board. Screen readers hear why instead:
 * "Blocked: <reason>", "Waiting for 2 tasks", or both.
 */
@Composable
fun BlockedMark(blocked: AgentWork.Blocked, localId: String, modifier: Modifier = Modifier) {
    val description = blockedDescription(blocked)
    Text(
        stringResource(R.string.blocked_mark),
        style = helmType.body,
        color = palette.danger,
        modifier = modifier
            .semantics { contentDescription = description }
            .testTag(BlockedTags.mark(localId)),
    )
}

@Composable
fun blockedDescription(blocked: AgentWork.Blocked): String {
    val reason = blocked.reason?.let { stringResource(R.string.detail_blocked, it) }
    val waiting = blocked.waitingOn.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.blocked_waiting_on, it, it) }
    return when {
        reason != null && waiting != null -> stringResource(R.string.blocked_reason_and_waiting, reason, waiting)
        else -> reason ?: waiting.orEmpty()
    }
}
