package dev.helm.planner.settings

import org.junit.Assert.assertEquals
import org.junit.Test

/** The tag Android keeps for the app's language (system settings or Helm's own picker) and the choice it shows. */
class AppLanguageTest {
    @Test
    fun noTagIsThePhonesLanguage() {
        assertEquals(AppLanguage.SYSTEM, AppLanguage.of(null))
        assertEquals(AppLanguage.SYSTEM, AppLanguage.of(""))
    }

    @Test
    fun everyChoiceReadsBackFromItsOwnTag() {
        AppLanguage.entries.forEach { assertEquals(it, AppLanguage.of(it.tag)) }
    }

    @Test
    fun aRegionOrScriptOfTheSameLanguageIsThatLanguage() {
        assertEquals(AppLanguage.CHINESE_SIMPLIFIED, AppLanguage.of("zh-Hans-CN"))
        assertEquals(AppLanguage.CHINESE_SIMPLIFIED, AppLanguage.of("zh-cn"))
        assertEquals(AppLanguage.PORTUGUESE_BRAZIL, AppLanguage.of("pt"))
        assertEquals(AppLanguage.ENGLISH, AppLanguage.of("en-GB"))
        assertEquals(AppLanguage.GERMAN, AppLanguage.of("de-AT"))
        assertEquals(AppLanguage.POLISH, AppLanguage.of("pl-PL"))
    }

    @Test
    fun anotherLanguageIsThePhonesLanguage() {
        assertEquals(AppLanguage.SYSTEM, AppLanguage.of("it"))
        assertEquals(AppLanguage.SYSTEM, AppLanguage.of("ko-KR"))
    }
}
