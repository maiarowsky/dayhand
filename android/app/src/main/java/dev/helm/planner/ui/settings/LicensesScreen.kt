package dev.helm.planner.ui.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import dev.helm.planner.R
import dev.helm.planner.ui.components.LineIcon
import dev.helm.planner.ui.components.ListGroup
import dev.helm.planner.ui.components.ListNote
import dev.helm.planner.ui.components.ListRow
import dev.helm.planner.ui.theme.BundledFont
import dev.helm.planner.ui.theme.HelmDimens
import dev.helm.planner.ui.theme.HelmFont
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

/**
 * Licenses of what the app ships: Dayhand itself, then one row per bundled font; tapping a row shows its full license text
 * under it.
 */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    SettingsPage(stringResource(R.string.licenses_title), onBack, "licenses") {
        ListNote(stringResource(R.string.licenses_intro))
        ListGroup(
            null,
            rows = HelmFont.bundledFonts.flatMap { font ->
                val shown = open == font.name
                listOfNotNull<@Composable () -> Unit>(
                    {
                        ListRow(
                            stringResource(R.string.licenses_font, font.name, font.version),
                            tag = "license-${font.name}",
                            icon = LineIcon.Document,
                            note = stringResource(R.string.licenses_ofl),
                            value = stringResource(if (shown) R.string.licenses_hide else R.string.licenses_show),
                            chevron = false,
                        ) { open = if (shown) null else font.name }
                    },
                    if (shown) ({ LicenseText(font) }) else null,
                )
            },
        )
    }
}

@Composable
private fun LicenseText(font: BundledFont) {
    val context = LocalContext.current
    val text = remember(font.license) { context.assets.open("licenses/${font.license}").bufferedReader().use { it.readText() } }
    Text(text, style = helmType.small, color = palette.textMuted, modifier = Modifier.padding(HelmDimens.rowPadding))
}
