package dev.helm.planner.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
import dev.helm.planner.settings.SettingsStore
import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The pairing is stored encrypted with the Keystore key, survives a new store, and goes on disconnect. */
@RunWith(AndroidJUnit4::class)
class DeviceStorageTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val device = Credential.Device("http://10.0.2.2:3211", "jd7device", "Pixel 9", "helmdev_selector.secret-value")

    @After
    fun tearDown() = runTest { SettingsStore(context).forgetDevice(revoked = false) }

    @Test
    fun pairingIsStoredEncryptedAndReadBack() = runTest {
        SettingsStore(context).saveDevice("http://10.0.2.2:3210", device)
        val settings = SettingsStore(context).current()
        assertEquals(BackendConfig("http://10.0.2.2:3210", device), settings.backend)
        assertEquals("http://10.0.2.2:3211", settings.serverUrl)
        assertTrue(settings.connectPromptDone)
        assertFalse(settings.pairingLost)
        // The device token never reaches the settings file in the clear.
        val file = File(context.filesDir, "datastore/helm_settings.preferences_pb")
        assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("secret-value"))
        assertFalse(settings.backend.toString().contains("secret-value"))
    }

    @Test
    fun disconnectForgetsTheTokenButKeepsTheAddress() = runTest {
        val store = SettingsStore(context)
        store.saveDevice("http://10.0.2.2:3210", device)
        store.forgetDevice(revoked = false)
        val settings = store.current()
        assertNull(settings.backend)
        assertEquals("http://10.0.2.2:3211", settings.serverUrl)
        assertFalse(settings.pairingLost)
    }

    @Test
    fun aRevokedPairingIsRememberedUntilTheNextOne() = runTest {
        val store = SettingsStore(context)
        store.saveDevice("http://10.0.2.2:3210", device)
        store.forgetDevice(revoked = true)
        assertTrue(store.current().pairingLost)
        store.saveDevice("http://10.0.2.2:3210", device)
        assertFalse(store.current().pairingLost)
    }
}
