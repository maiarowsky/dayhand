package dev.helm.planner.settings

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList

/** The app's own language, independent of the phone's (Android 13+ per-app languages). */
enum class AppLanguage(val tag: String?) {
    SYSTEM(null),
    POLISH("pl"),
    ENGLISH("en"),
}

object AppLanguages {
    /** Per-app languages exist from Android 13; before that Helm follows the phone. */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun current(context: Context): AppLanguage {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return AppLanguage.SYSTEM
        val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
        val language = if (locales.isEmpty) null else locales[0].language
        return AppLanguage.entries.firstOrNull { it.tag != null && it.tag == language } ?: AppLanguage.SYSTEM
    }

    /** Android stores the choice and recreates the screen in the new language. */
    fun set(context: Context, language: AppLanguage) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        context.getSystemService(LocaleManager::class.java).applicationLocales =
            language.tag?.let { LocaleList.forLanguageTags(it) } ?: LocaleList.getEmptyLocaleList()
    }
}
