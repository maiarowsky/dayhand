package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmShapes
import dev.helm.planner.ui.theme.Palette
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** A card (Mussh "FeatureCard" container): [color] on a 20 dp rounded shape with 18 dp padding, optionally tappable. */
@Composable
fun HelmCard(
    modifier: Modifier = Modifier,
    color: Color = palette.surface,
    onClick: (() -> Unit)? = null,
    contentPadding: Dp = HelmDimens.cardPadding,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(HelmShapes.card)
            .background(color)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** A labelled group (Mussh settings section): a muted section label over a card holding [content]. */
@Composable
fun CardSection(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(title, Modifier.padding(start = 4.dp, top = 12.dp), color = palette.textMuted)
        HelmCard(content = content)
    }
}

/** An icon on a rounded tile in the accent's soft colour. */
@Composable
fun IconTile(icon: ImageVector, size: Dp = HelmDimens.iconTile, tint: Color = palette.accent, background: Color = palette.accentSoft) {
    Box(Modifier.size(size).background(background, HelmShapes.tile), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

/** What a [StatusBanner] says: its soft background and the colour of its action. */
enum class BannerTone { Info, Warning, Danger, Success }

private fun BannerTone.background(p: Palette) = when (this) {
    BannerTone.Info -> p.accentSoft
    BannerTone.Warning -> p.warningSoft
    BannerTone.Danger -> p.dangerSoft
    BannerTone.Success -> p.successSoft
}

/**
 * A line about the state of the app (offline, server refused the token…) on a soft card, read out when it changes.
 * The text stays in the text colour on every tone, which keeps at least 4.5:1 in every palette.
 */
@Composable
fun StatusBanner(
    text: String,
    tone: BannerTone,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val p = palette
    Column(
        modifier
            .fillMaxWidth()
            .clip(HelmShapes.card)
            .background(tone.background(p))
            .padding(start = HelmDimens.cardPadding, end = 8.dp, top = 14.dp, bottom = if (action != null) 4.dp else 14.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Text(text, style = helmType.body, color = p.text, modifier = Modifier.padding(end = 10.dp))
        if (action != null && onAction != null) {
            TextAction(action, onAction, modifier = Modifier.align(Alignment.End))
        }
    }
}

/** Nothing to show: an icon tile, a sentence, an optional explanation and the one action that helps. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    action: String? = null,
    actionIcon: ImageVector? = null,
    onAction: (() -> Unit)? = null,
) {
    val p = palette
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconTile(icon, size = 64.dp)
        Text(title, style = helmType.title, color = p.text, textAlign = TextAlign.Center)
        body?.let { Text(it, style = helmType.body, color = p.textMuted, textAlign = TextAlign.Center) }
        if (action != null && onAction != null) {
            Spacer(Modifier.size(4.dp))
            PrimaryButton(action, onAction, icon = actionIcon, fillWidth = false)
        }
    }
}

/**
 * One choice in a list of options (palette, font): a card with a 1 dp border, accent border, soft fill and a check
 * mark when [selected]. A screen reader reads it as a radio button.
 */
@Composable
fun OptionCard(selected: Boolean, tag: String, onSelect: () -> Unit, content: @Composable RowScope.() -> Unit) {
    val p = palette
    Row(
        Modifier
            .fillMaxWidth()
            .clip(HelmShapes.option)
            .background(if (selected) p.accentSoft else p.surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) p.accent else p.border, HelmShapes.option)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .padding(12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
        if (selected) {
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Filled.Check, contentDescription = null, tint = p.accent, modifier = Modifier.size(22.dp))
        }
    }
}
