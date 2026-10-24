package dev.helm.planner.settings

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList

/**
 * The app's own language, independent of the phone's (Android 13+ per-app languages).
 * Each tag has its res/values-* folder; English is values/ (res/resources.properties).
 */
enum class AppLanguage(val tag: String?) {
    SYSTEM(null),
    ENGLISH("en"),
    POLISH("pl"),
    GERMAN("de"),
    SPANISH("es"),
    FRENCH("fr"),
    PORTUGUESE_BRAZIL("pt-BR"),
    JAPANESE("ja"),
    CHINESE_SIMPLIFIED("zh-CN");

    companion object {
        /**
         * The choice behind an app locale's BCP 47 tag: the exact tag, else the same language
         * (`zh-Hans-CN` is Chinese, `pt` Brazilian Portuguese); any other tag is the phone's language.
         */
        fun of(tag: String?): AppLanguage {
            if (tag.isNullOrEmpty()) return SYSTEM
            val chosen = entries.drop(1)
            return chosen.firstOrNull { it.tag.equals(tag, ignoreCase = true) }
                ?: chosen.firstOrNull { it.tag!!.substringBefore('-').equals(tag.substringBefore('-'), ignoreCase = true) }
                ?: SYSTEM
        }
    }
}

object AppLanguages {
    /** Per-app languages exist from Android 13; before that Dayhand follows the phone. */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun current(context: Context): AppLanguage {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return AppLanguage.SYSTEM
        val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
        return AppLanguage.of(if (locales.isEmpty) null else locales[0].toLanguageTag())
    }

    /** Android stores the choice and recreates the screen in the new language. */
    fun set(context: Context, language: AppLanguage) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        context.getSystemService(LocaleManager::class.java).applicationLocales =
            language.tag?.let { LocaleList.forLanguageTags(it) } ?: LocaleList.getEmptyLocaleList()
    }
}
