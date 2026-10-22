package dev.helm.planner.settings

import android.content.Context
import android.util.Base64
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.domain.HelmDates
import dev.helm.planner.domain.ReminderRules
import dev.helm.planner.notify.ReminderSettings
import java.net.URI
import java.net.URISyntaxException
import java.security.GeneralSecurityException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** Where the backend is and how the app signs in to it. */
data class BackendConfig(val url: String, val token: String)

data class AppSettings(
    val backend: BackendConfig?,
    /** Test switch: behave as if there were no network (nothing is sent or received). */
    val offlineMode: Boolean,
    /** The user's time zone as the backend last reported it. */
    val timezone: String,
    /** HH:MM of the morning summary, in [timezone] (server setting `summaryTime`). */
    val summaryTime: String = ReminderRules.DEFAULT_SUMMARY_TIME,
    /** Minutes before a timed task's due time when it rings (server setting `defaultReminderMinutes`). */
    val reminderMinutes: List<Int> = ReminderRules.DEFAULT_REMINDER_MINUTES,
) {
    val hasToken: Boolean get() = backend != null

    val reminders: ReminderSettings get() = ReminderSettings(timezone, summaryTime, reminderMinutes)
}

private val Context.helmSettings by preferencesDataStore(name = "helm_settings")

/**
 * App settings in DataStore. The app token is encrypted with AES-256-GCM by Tink under a
 * master key that lives in the Android Keystore, so the file alone does not reveal it; the
 * app also opts out of backups. The token is never logged or shown again after saving.
 */
class SettingsStore(context: Context) {
    private val dataStore = context.applicationContext.helmSettings
    private val aead: Aead by lazy { createAead(context.applicationContext) }

    val settings: Flow<AppSettings> = dataStore.data.map(::read)

    suspend fun current(): AppSettings = settings.first()

    /** Saves the address; a null [token] keeps the stored one. */
    suspend fun saveBackend(url: String, token: String?) {
        val encrypted = token?.let { encrypt(it) }
        dataStore.edit { prefs ->
            prefs[KEY_URL] = url
            if (encrypted != null) prefs[KEY_TOKEN] = encrypted
        }
    }

    suspend fun setOfflineMode(enabled: Boolean) {
        dataStore.edit { it[KEY_OFFLINE] = enabled }
    }

    suspend fun setSummaryTime(time: String) {
        dataStore.edit { it[KEY_SUMMARY_TIME] = time }
    }

    suspend fun setReminderMinutes(minutes: List<Int>) {
        dataStore.edit { it[KEY_REMINDER_MINUTES] = encodeMinutes(minutes) }
    }

    /**
     * The settings from a server snapshot. With [keepLocalChanges] (a settings change still waits
     * in the outbox) only the time zone is taken, so the snapshot does not undo the user's change.
     */
    suspend fun applyServer(snapshot: RemoteEvent.Snapshot, keepLocalChanges: Boolean) {
        dataStore.edit { prefs ->
            prefs[KEY_TIMEZONE] = snapshot.timezone
            if (!keepLocalChanges) {
                prefs[KEY_SUMMARY_TIME] = snapshot.summaryTime
                prefs[KEY_REMINDER_MINUTES] = encodeMinutes(snapshot.reminderMinutes)
            }
        }
    }

    private fun read(prefs: Preferences): AppSettings {
        val url = prefs[KEY_URL]
        val token = prefs[KEY_TOKEN]?.let(::decrypt)
        return AppSettings(
            backend = if (url != null && token != null) BackendConfig(url, token) else null,
            offlineMode = prefs[KEY_OFFLINE] ?: false,
            timezone = prefs[KEY_TIMEZONE] ?: HelmDates.DEFAULT_TIMEZONE,
            summaryTime = prefs[KEY_SUMMARY_TIME] ?: ReminderRules.DEFAULT_SUMMARY_TIME,
            reminderMinutes = prefs[KEY_REMINDER_MINUTES]?.let(::decodeMinutes) ?: ReminderRules.DEFAULT_REMINDER_MINUTES,
        )
    }

    private fun encrypt(token: String): String =
        Base64.encodeToString(aead.encrypt(token.toByteArray(), ASSOCIATED_DATA), Base64.NO_WRAP)

    /** A token that cannot be decrypted (e.g. the Keystore key was reset) counts as no token. */
    private fun decrypt(stored: String): String? = try {
        String(aead.decrypt(Base64.decode(stored, Base64.NO_WRAP), ASSOCIATED_DATA))
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    companion object {
        private val KEY_URL = stringPreferencesKey("backend_url")
        private val KEY_TOKEN = stringPreferencesKey("app_token_encrypted")
        private val KEY_OFFLINE = booleanPreferencesKey("offline_mode")
        private val KEY_TIMEZONE = stringPreferencesKey("timezone")
        private val KEY_SUMMARY_TIME = stringPreferencesKey("summary_time")
        private val KEY_REMINDER_MINUTES = stringPreferencesKey("reminder_minutes")
        private val ASSOCIATED_DATA = "helm-app-token".toByteArray()
        private const val KEYSET_NAME = "helm_token_keyset"
        private const val KEYSET_PREFS = "helm_token_keyset_prefs"
        private const val MASTER_KEY_URI = "android-keystore://helm_token_master_key"

        /** Minutes as `0,15,60`; an empty string is "no reminders". */
        private fun encodeMinutes(minutes: List<Int>) = minutes.joinToString(",")

        private fun decodeMinutes(stored: String): List<Int> =
            stored.split(',').mapNotNull { it.trim().toIntOrNull() }

        private fun createAead(context: Context): Aead {
            AeadConfig.register()
            return AndroidKeysetManager.Builder()
                .withSharedPref(context, KEYSET_NAME, KEYSET_PREFS)
                .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
                .withMasterKeyUri(MASTER_KEY_URI)
                .build()
                .keysetHandle
                .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        }
    }
}

/** Checks of what the user types in Settings, before anything is stored. */
object SettingsInput {
    private val TOKEN_RE = Regex("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")

    /** `https://…` or `http://…` without a trailing slash, or null when it is not a usable address. */
    fun normalizeUrl(input: String): String? {
        val url = input.trim().trimEnd('/')
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return null
        }
        if (uri.scheme != "http" && uri.scheme != "https") return null
        if (uri.host.isNullOrEmpty()) return null
        return url
    }

    fun isToken(input: String): Boolean = TOKEN_RE.matches(input.trim())
}
