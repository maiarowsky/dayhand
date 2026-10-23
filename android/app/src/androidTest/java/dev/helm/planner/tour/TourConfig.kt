package dev.helm.planner.tour

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/**
 * One screenshot run, from `-e tourVariant <name> -e tourMode light|dark -e tourDark <id> -e tourLight <id>` and
 * optionally `-e tourFont <id>`.
 * Screenshots are whole device screens (UiAutomation), so sheets, dialogs and system bars are in them.
 */
data class TourConfig(
    val variant: String,
    val dark: Boolean,
    val darkPalette: String?,
    val lightPalette: String?,
    val font: String? = null,
) {
    companion object {
        fun fromArguments(): TourConfig {
            val args = InstrumentationRegistry.getArguments()
            return TourConfig(
                variant = args.getString("tourVariant") ?: "local",
                dark = args.getString("tourMode") == "dark",
                darkPalette = args.getString("tourDark"),
                lightPalette = args.getString("tourLight"),
                font = args.getString("tourFont"),
            )
        }
    }
}

/** Edge to edge with bar icons for the run's mode, like the app. */
fun ComponentActivity.tourBars(dark: Boolean) {
    val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
}

/** Saves the whole screen as `<external files>/tour/<variant>/<name>.png`, pulled with adb afterwards. */
fun shoot(activity: Activity, config: TourConfig, name: String) {
    // Sheets and dialogs animate in real time, outside the test clock.
    Thread.sleep(700)
    val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("no screenshot")
    val dir = File(activity.getExternalFilesDir(null), "tour/${config.variant}").apply { mkdirs() }
    File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
}
