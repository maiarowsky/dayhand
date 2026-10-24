package dev.helm.planner.ui

import android.content.Context
import android.content.res.Configuration
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.HelmApplication
import dev.helm.planner.MainActivity
import dev.helm.planner.R
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppLanguages
import dev.helm.planner.ui.settings.SettingsTags
import java.util.Locale
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.runner.RunWith

/** Android resolves each of the eight languages to its own strings, and the picker in Settings switches the running app. */
@RunWith(AndroidJUnit4::class)
class LanguageSwitchTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    @get:Rule(order = 0)
    val connectPromptDone = object : ExternalResource() {
        override fun before() = runBlocking {
            AppLanguages.set(context, AppLanguage.SYSTEM)
            (context.applicationContext as HelmApplication).container.settings.setConnectPromptDone()
        }
    }

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @After
    fun backToThePhonesLanguage() = AppLanguages.set(context, AppLanguage.SYSTEM)

    private fun inLanguage(tag: String): Context =
        context.createConfigurationContext(Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag(tag)) })

    // Section labels are drawn in capitals of the app's language.
    private fun waitForText(text: String) = compose.waitUntil(10_000) {
        compose.onAllNodesWithText(text, ignoreCase = true, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun everyLanguageResolvesToItsOwnStrings() {
        val seen = mutableMapOf<String, AppLanguage>()
        AppLanguage.entries.filter { it.tag != null }.forEach { language ->
            val title = inLanguage(language.tag!!).getString(R.string.today_title)
            assertNull("${language.name} says “$title” like ${seen[title]}", seen.put(title, language))
        }
    }

    @Test
    fun pickingALanguageInSettingsSwitchesTheApp() {
        assumeTrue("per-app languages need Android 13", AppLanguages.supported)
        val german = inLanguage("de")
        val english = inLanguage("en")
        compose.onNodeWithContentDescription(context.getString(R.string.open_settings)).performClick()
        compose.onNodeWithTag(SettingsTags.LANGUAGE_ROW).performScrollTo().performClick()

        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.GERMAN.name).performScrollTo().performClick()
        waitForText(german.getString(R.string.settings_language_title))
        assertEquals(AppLanguage.GERMAN, AppLanguages.current(context))

        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.JAPANESE.name).performScrollTo().performClick()
        waitForText(inLanguage("ja").getString(R.string.settings_language_title))
        assertEquals(AppLanguage.JAPANESE, AppLanguages.current(context))

        compose.onNodeWithTag(SettingsTags.LANGUAGE + AppLanguage.ENGLISH.name).performScrollTo().performClick()
        waitForText(english.getString(R.string.settings_language_title))
        assertEquals(AppLanguage.ENGLISH, AppLanguages.current(context))
    }
}
