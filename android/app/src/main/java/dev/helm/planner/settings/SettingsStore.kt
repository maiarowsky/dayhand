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
import java.security.GeneralSecurityException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** How the app signs in to the backend. Secrets stay out of [toString]. */
sealed interface Credential {
    /** A phone paired with a one-time code: [serverUrl] (HTTP actions) issues app tokens for [deviceToken]. */
    data class Device(
        val serverUrl: String,
        val deviceId: String,
        val deviceName: String,
        val deviceToken: String,
    ) : Credential {
        override fun toString() = "Device(serverUrl=$serverUrl, deviceId=$deviceId, deviceName=$deviceName)"
    }

    /** An app token pasted in Settings by version 0.2; kept working until the phone is paired. */
    data class AppToken(val token: String) : Credential {
        override fun toString() = "AppToken"
    }
}

/** Where the backend is ([url]: the Convex deployment URL) and how the app signs in to it. */
data class BackendConfig(val url: String, val credential: Credential)

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
    /** The server (HTTP actions URL) last paired with, kept after disconnecting to fill in the address again. */
    val serverUrl: String? = null,
    /** The server signed this phone out (revoked); the app shows it until the phone is paired again. */
    val pairingLost: Boolean = false,
    /** The Connect screen was shown at first start (and connected or skipped); it does not open by itself again. */
    val connectPromptDone: Boolean = false,
) {
    val hasToken: Boolean get() = backend != null

    val reminders: ReminderSettings get() = ReminderSettings(timezone, summaryTime, reminderMinutes)
}

private val Context.helmSettings by preferencesDataStore(name = "helm_settings")

/**
 * App settings in DataStore. The device token (and a pasted app token of version 0.2) is
 * encrypted with AES-256-GCM by Tink under a master key that lives in the Android Keystore, so
 * the file alone does not reveal it; the app also opts out of backups. Tokens are never logged
 * or shown.
 */
class SettingsStore(context: Context) {
    private val dataStore = context.applicationContext.helmSettings
    private val aead: Aead by lazy { createAead(context.applicationContext) }

    val settings: Flow<AppSettings> = dataStore.data.map(::read)

    suspend fun current(): AppSettings = settings.first()

    /** Stores a new pairing ([convexUrl] for the Convex client); it replaces any earlier sign-in. */
    suspend fun saveDevice(convexUrl: String, device: Credential.Device) {
        val encrypted = encrypt(device.deviceToken, DEVICE_TOKEN_DATA)
        dataStore.edit { prefs ->
            prefs[KEY_URL] = convexUrl
            prefs[KEY_SERVER_URL] = device.serverUrl
            prefs[KEY_DEVICE_ID] = device.deviceId
            prefs[KEY_DEVICE_NAME] = device.deviceName
            prefs[KEY_DEVICE_TOKEN] = encrypted
            prefs.remove(KEY_TOKEN)
            prefs[KEY_PAIRING_LOST] = false
            prefs[KEY_CONNECT_PROMPT_DONE] = true
        }
    }

    /**
     * Forgets the sign-in on this phone (disconnect, or [revoked] by the server). Tasks and
     * changes waiting in the outbox stay; they go out after the next pairing.
     */
    suspend fun forgetDevice(revoked: Boolean) {
        dataStore.edit { prefs ->
            prefs.remove(KEY_DEVICE_TOKEN)
            prefs.remove(KEY_DEVICE_ID)
            prefs.remove(KEY_DEVICE_NAME)
            prefs.remove(KEY_TOKEN)
            prefs[KEY_PAIRING_LOST] = revoked
        }
    }

    suspend fun setConnectPromptDone() {
        dataStore.edit { it[KEY_CONNECT_PROMPT_DONE] = true }
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
        return AppSettings(
            backend = backend(prefs),
            offlineMode = prefs[KEY_OFFLINE] ?: false,
            timezone = prefs[KEY_TIMEZONE] ?: HelmDates.DEFAULT_TIMEZONE,
            summaryTime = prefs[KEY_SUMMARY_TIME] ?: ReminderRules.DEFAULT_SUMMARY_TIME,
            reminderMinutes = prefs[KEY_REMINDER_MINUTES]?.let(::decodeMinutes) ?: ReminderRules.DEFAULT_REMINDER_MINUTES,
            serverUrl = prefs[KEY_SERVER_URL],
            pairingLost = prefs[KEY_PAIRING_LOST] ?: false,
            connectPromptDone = prefs[KEY_CONNECT_PROMPT_DONE] ?: false,
        )
    }

    private fun backend(prefs: Preferences): BackendConfig? {
        val url = prefs[KEY_URL] ?: return null
        val serverUrl = prefs[KEY_SERVER_URL]
        val deviceToken = prefs[KEY_DEVICE_TOKEN]?.let { decrypt(it, DEVICE_TOKEN_DATA) }
        if (serverUrl != null && deviceToken != null) {
            val device = Credential.Device(
                serverUrl = serverUrl,
                deviceId = prefs[KEY_DEVICE_ID].orEmpty(),
                deviceName = prefs[KEY_DEVICE_NAME].orEmpty(),
                deviceToken = deviceToken,
            )
            return BackendConfig(url, device)
        }
        val token = prefs[KEY_TOKEN]?.let { decrypt(it, APP_TOKEN_DATA) } ?: return null
        return BackendConfig(url, Credential.AppToken(token))
    }

    private fun encrypt(token: String, associatedData: ByteArray): String =
        Base64.encodeToString(aead.encrypt(token.toByteArray(), associatedData), Base64.NO_WRAP)

    /** A token that cannot be decrypted (e.g. the Keystore key was reset) counts as no token. */
    private fun decrypt(stored: String, associatedData: ByteArray): String? = try {
        String(aead.decrypt(Base64.decode(stored, Base64.NO_WRAP), associatedData))
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
        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        private val KEY_DEVICE_NAME = stringPreferencesKey("device_name")
        private val KEY_DEVICE_TOKEN = stringPreferencesKey("device_token_encrypted")
        private val KEY_PAIRING_LOST = booleanPreferencesKey("pairing_lost")
        private val KEY_CONNECT_PROMPT_DONE = booleanPreferencesKey("connect_prompt_done")
        private val APP_TOKEN_DATA = "helm-app-token".toByteArray()
        private val DEVICE_TOKEN_DATA = "helm-device-token".toByteArray()
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
