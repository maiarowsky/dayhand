package dev.helm.planner.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** One main view in the bottom bar. */
data class HelmTabItem(val label: String, val icon: ImageVector, val selected: Boolean, val tag: String, val onClick: () -> Unit)

/** Room between two tabs in the bar (Material's 8 dp) and kept either side of a label inside its tab. */
private val TAB_GAP = 8.dp
private val LABEL_MARGIN = 4.dp

/**
 * The bottom bar between the main views, on the card colour with the accent for the current one. Each label stays on
 * one line; when one of them does not fit its tab (large text on a narrow phone) every tab shows its icon alone, and
 * the label is the icon's name for a screen reader.
 */
@Composable
fun HelmTabBar(items: List<HelmTabItem>) {
    val p = palette
    val style = helmType.smallStrong
    val measurer = rememberTextMeasurer()
    Column {
        HorizontalDivider(color = p.border, thickness = 0.5.dp)
        BoxWithConstraints {
            val room = labelRoom(maxWidth, items.size)
            val roomPx = with(LocalDensity.current) { room.roundToPx() }
            val labels = items.map { it.label }
            val showLabels = remember(labels, style, roomPx) {
                labels.all { measurer.measure(it, style, maxLines = 1, softWrap = false).size.width <= roomPx }
            }
            NavigationBar(containerColor = p.surface, contentColor = p.text, tonalElevation = 0.dp) {
                items.forEach { item ->
                    NavigationBarItem(
                        selected = item.selected,
                        onClick = item.onClick,
                        icon = { Icon(item.icon, contentDescription = if (showLabels) null else item.label) },
                        label = if (showLabels) ({ Text(item.label, style = style, maxLines = 1, softWrap = false) }) else null,
                        modifier = Modifier.testTag(item.tag),
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = p.accent,
                            selectedTextColor = p.accent,
                            indicatorColor = p.accentSoft,
                            unselectedIconColor = p.textMuted,
                            unselectedTextColor = p.textMuted,
                        ),
                    )
                }
            }
        }
    }
}

/** The width a label has in one of [count] tabs sharing [width]. */
internal fun labelRoom(width: Dp, count: Int): Dp =
    if (count == 0) width else (width - TAB_GAP * (count - 1)) / count - LABEL_MARGIN * 2
