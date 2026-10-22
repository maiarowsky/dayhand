package dev.helm.planner.ui.theme

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Light, dark or as the phone is set. */
enum class ThemeMode(val id: String) {
    System("system"),
    Light("light"),
    Dark("dark"),
    ;

    companion object {
        fun byId(id: String?): ThemeMode = entries.firstOrNull { it.id == id } ?: System
    }
}

/**
 * How the app looks: the mode, one palette for dark and one for light (Mussh palettes are each light or dark, so the
 * user picks both and the mode decides which one shows) and the text font.
 */
data class Appearance(
    val mode: ThemeMode = ThemeMode.System,
    val darkPalette: Palette = Palettes.DefaultDark,
    val lightPalette: Palette = Palettes.DefaultLight,
    val font: HelmFont = HelmFont.Default,
) {
    init {
        require(!darkPalette.light) { "darkPalette must be a dark palette" }
        require(lightPalette.light) { "lightPalette must be a light palette" }
    }

    /** The palette on screen when the phone is in dark mode or not. */
    fun palette(systemDark: Boolean): Palette = when (mode) {
        ThemeMode.Light -> lightPalette
        ThemeMode.Dark -> darkPalette
        ThemeMode.System -> if (systemDark) darkPalette else lightPalette
    }

    /** Selects [palette] for the variant it belongs to, keeping the other one. */
    fun withPalette(palette: Palette): Appearance =
        if (palette.light) copy(lightPalette = palette) else copy(darkPalette = palette)
}

/** Key–string storage: [SharedPreferences] on the phone, a map in tests. */
interface SettingValues {
    fun string(key: String): String?
    fun put(values: Map<String, String>)
}

class PreferenceValues(private val prefs: SharedPreferences) : SettingValues {
    override fun string(key: String): String? = prefs.getString(key, null)

    override fun put(values: Map<String, String>) {
        prefs.edit().apply { values.forEach { (key, value) -> putString(key, value) } }.apply()
    }
}

/**
 * The appearance kept between launches, read synchronously at start so the first frame already has the right colours.
 * An unknown value (e.g. a palette removed in a later version) gives the default instead of a failed start.
 * [appearance] changes at once on [save], so the whole app redraws without a restart.
 */
class AppearanceStore(private val values: SettingValues) {

    constructor(context: Context) : this(
        PreferenceValues(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)),
    )

    private val state = MutableStateFlow(load())
    val appearance: StateFlow<Appearance> = state.asStateFlow()

    fun save(appearance: Appearance) {
        persist(appearance)
        state.value = appearance
    }

    private fun persist(appearance: Appearance) {
        values.put(
            mapOf(
                KEY_MODE to appearance.mode.id,
                KEY_DARK to appearance.darkPalette.id,
                KEY_LIGHT to appearance.lightPalette.id,
                KEY_FONT to appearance.font.id,
            ),
        )
    }

    private fun load(): Appearance = Appearance(
        mode = ThemeMode.byId(values.string(KEY_MODE)),
        darkPalette = Palettes.darkById(values.string(KEY_DARK)),
        lightPalette = Palettes.lightById(values.string(KEY_LIGHT)),
        font = HelmFont.byId(values.string(KEY_FONT)),
    )

    companion object {
        const val PREFS = "helm_appearance"
        const val KEY_MODE = "appearance.mode"
        const val KEY_DARK = "appearance.palette-dark"
        const val KEY_LIGHT = "appearance.palette-light"
        const val KEY_FONT = "appearance.font"
    }
}
