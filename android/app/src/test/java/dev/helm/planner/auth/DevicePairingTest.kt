package dev.helm.planner.auth

import dev.helm.planner.settings.Credential
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DevicePairingTest {
    private var online = true
    private var saved: Pair<String, Credential.Device>? = null
    private var sentCode: String? = null
    private var reply: () -> PairReply = { error("no reply set") }

    private val api = PairingApi { _, body ->
        sentCode = Regex("\"code\":\"([^\"]+)\"").find(body)?.groupValues?.get(1)
        reply()
    }
    private val pairing = DevicePairing(api, isOnline = { online }, save = { url, device -> saved = url to device })

    @Test
    fun `a good code stores the device with an address the phone can reach`() = runTest {
        reply = { PairReply(200, """{"deviceId":"jd7","deviceName":"sdk_gphone64","deviceToken":"helmdev_a.b","convexUrl":"http://127.0.0.1:3210"}""") }
        val outcome = pairing.connect("http://10.0.2.2:3211/", "e6m8 fe02 xsnt", "sdk_gphone64")
        assertEquals(ConnectOutcome.Connected, outcome)
        assertEquals("E6M8-FE02-XSNT", sentCode)
        assertEquals("http://10.0.2.2:3210" to Credential.Device("http://10.0.2.2:3211", "jd7", "sdk_gphone64", "helmdev_a.b"), saved)
    }

    @Test
    fun `input is checked before anything is sent`() = runTest {
        assertEquals(ConnectOutcome.Failed(ConnectError.BAD_ADDRESS), pairing.connect("convex.site", "E6M8-FE02-XSNT", "p"))
        assertEquals(ConnectOutcome.Failed(ConnectError.BAD_CODE), pairing.connect("https://x.convex.site", "E6M8", "p"))
        online = false
        assertEquals(ConnectOutcome.Failed(ConnectError.NO_NETWORK), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        assertNull(sentCode)
        assertNull(saved)
    }

    @Test
    fun `server answers become readable errors and nothing is stored`() = runTest {
        reply = { PairReply(401, """{"error":"invalid_grant"}""") }
        assertEquals(ConnectOutcome.Failed(ConnectError.INVALID_CODE), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        reply = { PairReply(429, """{"error":"rate_limited"}""", retryAfter = "120") }
        assertEquals(ConnectOutcome.Failed(ConnectError.RATE_LIMITED, 120), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        reply = { PairReply(404, "Not found") }
        assertEquals(ConnectOutcome.Failed(ConnectError.NOT_HELM), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        reply = { PairReply(502, "") }
        assertEquals(ConnectOutcome.Failed(ConnectError.SERVER_ERROR), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        reply = { throw IOException("connect timed out") }
        assertEquals(ConnectOutcome.Failed(ConnectError.UNREACHABLE), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
        assertNull(saved)
    }

    @Test
    fun `a network lost during the request is reported as no network`() = runTest {
        reply = {
            online = false
            throw IOException("no route")
        }
        assertEquals(ConnectOutcome.Failed(ConnectError.NO_NETWORK), pairing.connect("https://x.convex.site", "E6M8-FE02-XSNT", "p"))
    }

    @Test
    fun `the device name fits the backend's limits`() {
        assertEquals("Phone", DevicePairing.deviceLabel("  "))
        assertEquals(100, DevicePairing.deviceLabel("x".repeat(150)).length)
    }
}
