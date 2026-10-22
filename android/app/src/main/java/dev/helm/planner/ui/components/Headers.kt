package dev.helm.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette
import java.util.Locale

/** An upper-case monospace section label (Mussh "MonoLabel"), marked as a heading for screen readers. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, color: Color = palette.accent) {
    Text(
        text.uppercase(Locale.getDefault()),
        style = helmType.label,
        color = color,
        modifier = modifier.semantics { heading() },
    )
}

/**
 * Header of a top-level screen: a large title with an optional line under it and actions on the right. It keeps clear
 * of the status bar by itself.
 */
@Composable
fun LargeHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    val p = palette
    Row(
        modifier
            .fillMaxWidth()
            .background(p.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .padding(start = HelmDimens.screenMargin, end = 8.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) { heading() }) {
            Text(title, style = helmType.headline, color = p.text)
            subtitle?.let { Text(it, style = helmType.body, color = p.textMuted) }
        }
        actions()
    }
}

/**
 * Header of a sub-screen: the back arrow (48 dp) and the title, as on Mussh's settings pages. Without [onBack] (a
 * screen that cannot be left backwards) the title starts at the screen margin.
 */
@Composable
fun ScreenHeader(title: String, onBack: (() -> Unit)?, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    val p = palette
    Row(
        modifier
            .fillMaxWidth()
            .background(p.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .padding(start = if (onBack != null) 8.dp else HelmDimens.screenMargin, end = 8.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        if (onBack != null) {
            HeaderIconButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), onBack, Modifier.testTag("back"))
            Spacer(Modifier.width(8.dp))
        }
        Text(
            title,
            style = helmType.screenTitle,
            color = p.text,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        actions()
    }
}
