package dev.helm.planner.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.ui.components.HelmCard
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ScreenHeader
import dev.helm.planner.ui.components.SecondaryButton
import dev.helm.planner.ui.theme.BundledFont
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/** Licences of what the app ships: Helm itself and every bundled font with its full licence text. */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(palette.background).testTag("licenses")) {
        ScreenHeader(stringResource(R.string.licenses_title), onBack)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = HelmDimens.screenMargin),
            verticalArrangement = Arrangement.spacedBy(HelmDimens.sectionGap),
        ) {
            ListNote(stringResource(R.string.licenses_intro))
            HelmFont.bundledFonts.forEach { FontLicense(it) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun FontLicense(font: BundledFont) {
    val p = palette
    val context = LocalContext.current
    var open by rememberSaveable(font.name) { mutableStateOf(false) }
    val text = remember(font.license, open) {
        if (open) context.assets.open("licenses/${font.license}").bufferedReader().use { it.readText() } else null
    }
    HelmCard {
        Text(stringResource(R.string.licenses_font, font.name, font.version), style = helmType.bodyStrong, color = p.text)
        Text(stringResource(R.string.licenses_ofl), style = helmType.small, color = p.textMuted)
        SecondaryButton(stringResource(if (open) R.string.licenses_hide else R.string.licenses_show), onClick = { open = !open })
        text?.let { Text(it, style = helmType.small, color = p.textMuted) }
    }
}
