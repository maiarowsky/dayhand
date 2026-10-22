package dev.helm.planner.ui.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** The bottom bar between the main views, on the card colour with the accent for the current one. */
@Composable
fun HelmTabBar(content: @Composable RowScope.() -> Unit) {
    NavigationBar(containerColor = palette.surface, contentColor = palette.text, tonalElevation = 0.dp, content = content)
}

/** One tab: soft-accent pill behind the icon and accent icon and label when [selected]. */
@Composable
fun RowScope.HelmTab(selected: Boolean, icon: ImageVector, label: String, onClick: () -> Unit) {
    val p = palette
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, contentDescription = null) },
        label = { Text(label, style = helmType.smallStrong) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = p.accent,
            selectedTextColor = p.accent,
            indicatorColor = p.accentSoft,
            unselectedIconColor = p.textMuted,
            unselectedTextColor = p.textMuted,
        ),
    )
}
