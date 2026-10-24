package dev.helm.planner.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingInputTest {
    @Test
    fun `codes are read like the backend reads them`() {
        assertEquals("E6M8-FE02-XSNT", PairingInput.normalizeCode("E6M8-FE02-XSNT"))
        assertEquals("E6M8-FE02-XSNT", PairingInput.normalizeCode(" e6m8 fe02 xsnt "))
        assertEquals("E6M8-FE02-XSNT", PairingInput.normalizeCode("e6m8fe02xsnt"))
        // O is read as 0, I and L as 1.
        assertEquals("1100-ABCD-EFGH", PairingInput.normalizeCode("ilOo-abcd-efgh"))
    }

    @Test
    fun `codes of the wrong length or with letters outside the alphabet are refused`() {
        assertNull(PairingInput.normalizeCode("E6M8-FE02-XSN"))
        assertNull(PairingInput.normalizeCode("E6M8-FE02-XSNTT"))
        assertNull(PairingInput.normalizeCode("E6M8-FE02-XSNU"))
        assertNull(PairingInput.normalizeCode("E6M8_FE02_XSNT"))
        assertNull(PairingInput.normalizeCode(""))
    }

    @Test
    fun `server addresses are trimmed and a convex cloud address becomes its HTTP actions address`() {
        assertEquals("https://impressive-grouse-796.eu-west-1.convex.site", PairingInput.normalizeServerUrl(" https://impressive-grouse-796.eu-west-1.convex.site/ "))
        assertEquals("https://happy-otter-123.convex.site", PairingInput.normalizeServerUrl("https://happy-otter-123.convex.cloud"))
        assertEquals("http://10.0.2.2:3211", PairingInput.normalizeServerUrl("http://10.0.2.2:3211"))
    }

    @Test
    fun `only http and https addresses with a host and no path are accepted`() {
        assertNull(PairingInput.normalizeServerUrl("10.0.2.2:3211"))
        assertNull(PairingInput.normalizeServerUrl("ftp://example.com"))
        assertNull(PairingInput.normalizeServerUrl("https://"))
        assertNull(PairingInput.normalizeServerUrl("http://exa mple.com"))
        assertNull(PairingInput.normalizeServerUrl("https://example.convex.site/auth/pair"))
    }

    @Test
    fun `a pairing link gives the server and the code`() {
        val link = PairingInput.parseLink("dayhand://pair?url=https%3A%2F%2Fimpressive-grouse-796.eu-west-1.convex.site&code=E6M8-FE02-XSNT")
        assertEquals(PairingLink("https://impressive-grouse-796.eu-west-1.convex.site", "E6M8-FE02-XSNT"), link)
        assertEquals(PairingLink("http://10.0.2.2:3211", null), PairingInput.parseLink("dayhand://pair?url=http://10.0.2.2:3211"))
    }

    @Test
    fun `a helm pairing link from hlm before the rename still works`() {
        val link = PairingInput.parseLink("helm://pair?url=https%3A%2F%2Fimpressive-grouse-796.eu-west-1.convex.site&code=E6M8-FE02-XSNT")
        assertEquals(PairingLink("https://impressive-grouse-796.eu-west-1.convex.site", "E6M8-FE02-XSNT"), link)
    }

    @Test
    fun `other links are not pairing links`() {
        assertNull(PairingInput.parseLink("https://example.com/pair?code=E6M8-FE02-XSNT"))
        assertNull(PairingInput.parseLink("dayhand://task?id=1"))
        assertNull(PairingInput.parseLink("helm://task?id=1"))
        assertNull(PairingInput.parseLink("not a link"))
    }

    @Test
    fun `a local backend's loopback address is replaced by the host the phone reached`() {
        assertEquals("http://10.0.2.2:3210", PairingInput.reachableConvexUrl("http://127.0.0.1:3210", "http://10.0.2.2:3211"))
        assertEquals("http://192.168.1.20:3210", PairingInput.reachableConvexUrl("http://localhost:3210", "http://192.168.1.20:3211"))
        assertEquals(
            "https://impressive-grouse-796.eu-west-1.convex.cloud",
            PairingInput.reachableConvexUrl("https://impressive-grouse-796.eu-west-1.convex.cloud", "https://impressive-grouse-796.eu-west-1.convex.site"),
        )
    }
}
