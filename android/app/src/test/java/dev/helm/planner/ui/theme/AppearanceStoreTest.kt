package dev.helm.planner.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class AppearanceStoreTest {
    private class MemoryValues(val map: MutableMap<String, String> = mutableMapOf()) : SettingValues {
        override fun string(key: String): String? = map[key]
        override fun put(values: Map<String, String>) {
            map.putAll(values)
        }
    }

    @Test
    fun startsWithMusshDefaults() {
        val appearance = AppearanceStore(MemoryValues()).appearance.value
        assertEquals(ThemeMode.System, appearance.mode)
        assertSame(Palettes.Terracotta, appearance.darkPalette)
        assertSame(Palettes.Paper, appearance.lightPalette)
        assertEquals(HelmFont.System, appearance.font)
    }

    @Test
    fun savedChoiceIsAppliedAtOnceAndSurvivesARestart() {
        val values = MemoryValues()
        val store = AppearanceStore(values)
        val chosen = Appearance(ThemeMode.Dark, Palettes.Nord, Palettes.SolarizedLight, HelmFont.Atkinson)
        store.save(chosen)
        assertEquals(chosen, store.appearance.value)
        // A new store over the same values is what the next launch sees.
        assertEquals(chosen, AppearanceStore(values).appearance.value)
    }

    @Test
    fun unknownOrWrongVariantValuesFallBackToDefaults() {
        val values = MemoryValues(
            mutableMapOf(
                AppearanceStore.KEY_MODE to "sepia",
                AppearanceStore.KEY_DARK to Palettes.Paper.id,
                AppearanceStore.KEY_LIGHT to "removed-palette",
                AppearanceStore.KEY_FONT to "comic",
            ),
        )
        assertEquals(Appearance(), AppearanceStore(values).appearance.value)
    }

    @Test
    fun keysAndIdsStayStable() {
        val values = MemoryValues()
        AppearanceStore(values).save(Appearance(ThemeMode.Light, Palettes.Dracula, Palettes.RosePineDawn, HelmFont.SourceSerif))
        assertEquals(
            mapOf(
                "appearance.mode" to "light",
                "appearance.palette-dark" to "dracula",
                "appearance.palette-light" to "rose-pine-dawn",
                "appearance.font" to "source-serif",
            ),
            values.map,
        )
    }
}
