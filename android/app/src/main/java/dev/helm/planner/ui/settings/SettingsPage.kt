package dev.helm.planner.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmType
import dev.helm.planner.ui.theme.LocalHelmType
import dev.helm.planner.ui.theme.palette

/**
 * Settings or one of its pages (Mussh "SettingsPage"): the back arrow and title, then a scrolling column with the
 * screen margin and 12 dp between groups. [pinned] stays above the scrolling part (the appearance preview over the
 * list of palettes).
 */
@Composable
fun SettingsPage(title: String, onBack: () -> Unit, tag: String, pinned: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    SettingsType {
        Column(Modifier.fillMaxSize().background(palette.background).testTag(tag)) {
            ScreenHeader(title, onBack)
            pinned?.let { Box(Modifier.padding(horizontal = HelmDimens.screenMargin).padding(bottom = 12.dp)) { it() } }
            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                    .padding(horizontal = HelmDimens.screenMargin),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                content()
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/**
 * Settings speak in the system sans whatever font the app reads in, as Mussh's settings do: the font choice shows in
 * its preview and on the other screens, and Settings stays a calm list. Dialogs opened here follow it too.
 */
@Composable
internal fun SettingsType(content: @Composable () -> Unit) {
    val type = remember { HelmType(FontFamily.Default) }
    CompositionLocalProvider(LocalHelmType provides type) {
        MaterialTheme(typography = type.material, content = content)
    }
}
