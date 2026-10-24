package dev.helm.planner.ui.connect

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.auth.PlanReplace
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.HelmDialog
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.LineIconView
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** One way to use Dayhand at first start: an outline icon on a tile, a heading, what it means, then its buttons. */
@Composable
internal fun ChoiceCard(icon: LineIcon, title: String, body: String, tag: String, buttons: @Composable ColumnScope.() -> Unit) {
    val p = palette
    HelmCard(Modifier.testTag(tag)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(HelmDimens.iconTile).background(p.accentSoft, HelmShapes.tile), contentAlignment = Alignment.Center) {
                LineIconView(icon, p.accent, size = 24.dp)
            }
            Text(title, style = helmType.title, color = p.text, modifier = Modifier.semantics { heading() })
        }
        Text(body, style = helmType.body, color = p.textMuted)
        Spacer(Modifier.height(4.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), content = buttons)
    }
}

/**
 * Asked before a code is used for another server than the one whose plan is on the phone: what goes from the
 * phone, what is never sent, and how to keep it.
 */
@Composable
internal fun ReplacePlanDialog(replace: PlanReplace, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val old = hostOf(replace.oldServer)
    val new = hostOf(replace.newServer)
    HelmDialog(
        title = stringResource(R.string.replace_title),
        onDismiss = onDismiss,
        confirm = stringResource(R.string.replace_confirm),
        onConfirm = onConfirm,
        dismiss = stringResource(R.string.cancel),
        destructive = true,
        confirmTag = ConnectTags.REPLACE_CONFIRM,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val tasks = pluralStringResource(R.plurals.replace_tasks, replace.tasks, replace.tasks)
            Text(stringResource(R.string.replace_text, old, new, tasks), style = helmType.body)
            if (replace.pending > 0) {
                val changes = pluralStringResource(R.plurals.replace_changes, replace.pending, replace.pending)
                Text(stringResource(R.string.replace_pending, changes, old), style = helmType.body)
            }
            Text(stringResource(R.string.replace_keep, old), style = helmType.body)
        }
    }
}
