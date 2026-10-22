package dev.helm.planner.ui.theme

import org.junit.Assert.assertSame
import org.junit.Test

class AppearanceTest {
    private val appearance = Appearance(darkPalette = Palettes.TokyoNight, lightPalette = Palettes.CatppuccinLatte)

    @Test
    fun systemModeFollowsThePhone() {
        assertSame(Palettes.TokyoNight, appearance.palette(systemDark = true))
        assertSame(Palettes.CatppuccinLatte, appearance.palette(systemDark = false))
    }

    @Test
    fun lightAndDarkModesIgnoreThePhone() {
        val light = appearance.copy(mode = ThemeMode.Light)
        val dark = appearance.copy(mode = ThemeMode.Dark)
        listOf(true, false).forEach { systemDark ->
            assertSame(Palettes.CatppuccinLatte, light.palette(systemDark))
            assertSame(Palettes.TokyoNight, dark.palette(systemDark))
        }
    }

    @Test
    fun choosingAPaletteReplacesOnlyItsVariant() {
        val withDark = appearance.withPalette(Palettes.Dracula)
        assertSame(Palettes.Dracula, withDark.darkPalette)
        assertSame(Palettes.CatppuccinLatte, withDark.lightPalette)
        val withLight = appearance.withPalette(Palettes.Paper)
        assertSame(Palettes.TokyoNight, withLight.darkPalette)
        assertSame(Palettes.Paper, withLight.lightPalette)
    }

    @Test(expected = IllegalArgumentException::class)
    fun aLightPaletteCannotBeTheDarkOne() {
        Appearance(darkPalette = Palettes.Paper)
    }

    @Test
    fun fontsResolveByIdWithSystemAsDefault() {
        HelmFont.entries.forEach { assertSame(it, HelmFont.byId(it.id)) }
        assertSame(HelmFont.System, HelmFont.byId(null))
        assertSame(HelmFont.System, HelmFont.byId("unknown"))
    }
}
