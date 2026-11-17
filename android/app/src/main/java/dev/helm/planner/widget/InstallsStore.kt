package dev.helm.planner.widget

import android.content.Context
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.installsWidget by preferencesDataStore(name = "installs_widget")

/** The installs widget's address and last good file, shared by every placed copy of the widget. */
class InstallsStore(context: Context) {
    private val dataStore = context.applicationContext.installsWidget

    val data: Flow<WidgetData> = dataStore.data.map(::read)

    suspend fun current(): WidgetData = data.first()

    /** A new address forgets the file read from the old one. */
    suspend fun setUrl(url: String) {
        dataStore.edit { prefs ->
            if (prefs[KEY_URL] == url) return@edit
            write(prefs, WidgetData(url = url))
        }
    }

    /** Applies a fetch of [url]; a result for an address changed meanwhile is dropped. */
    suspend fun apply(url: String, result: FetchResult, now: Long) {
        dataStore.edit { prefs ->
            val current = read(prefs)
            if (current.url == url) write(prefs, current.after(result, now))
        }
    }

    private fun read(prefs: Preferences) = WidgetData(
        url = prefs[KEY_URL],
        body = prefs[KEY_BODY],
        fetchedAt = prefs[KEY_FETCHED_AT],
        failure = prefs[KEY_FAILURE]?.let(::decodeFailure),
    )

    private fun write(prefs: MutablePreferences, data: WidgetData) {
        prefs.put(KEY_URL, data.url)
        prefs.put(KEY_BODY, data.body)
        prefs.put(KEY_FETCHED_AT, data.fetchedAt)
        prefs.put(KEY_FAILURE, data.failure?.let(::encodeFailure))
    }

    private fun <T> MutablePreferences.put(key: Preferences.Key<T>, value: T?) {
        if (value == null) remove(key) else set(key, value)
    }

    private fun encodeFailure(failure: FetchFailure): String = when (failure) {
        FetchFailure.Network -> NETWORK
        FetchFailure.InvalidFile -> INVALID_FILE
        is FetchFailure.Http -> "$HTTP${failure.status}"
    }

    private fun decodeFailure(text: String): FetchFailure? = when {
        text == NETWORK -> FetchFailure.Network
        text == INVALID_FILE -> FetchFailure.InvalidFile
        text.startsWith(HTTP) -> text.removePrefix(HTTP).toIntOrNull()?.let(FetchFailure::Http)
        else -> null
    }

    private companion object {
        val KEY_URL = stringPreferencesKey("url")
        val KEY_BODY = stringPreferencesKey("body")
        val KEY_FETCHED_AT = longPreferencesKey("fetched_at")
        val KEY_FAILURE = stringPreferencesKey("failure")
        const val NETWORK = "network"
        const val INVALID_FILE = "invalid_file"
        const val HTTP = "http:"
    }
}
