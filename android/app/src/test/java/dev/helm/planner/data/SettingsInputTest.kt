package dev.helm.planner.data

import dev.helm.planner.settings.SettingsInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsInputTest {
    @Test
    fun `addresses are trimmed and lose a trailing slash`() {
        assertEquals("http://10.0.2.2:3210", SettingsInput.normalizeUrl(" http://10.0.2.2:3210/ "))
        assertEquals("https://happy-otter-123.convex.cloud", SettingsInput.normalizeUrl("https://happy-otter-123.convex.cloud"))
    }

    @Test
    fun `only http and https addresses with a host are accepted`() {
        assertNull(SettingsInput.normalizeUrl("10.0.2.2:3210"))
        assertNull(SettingsInput.normalizeUrl("ftp://example.com"))
        assertNull(SettingsInput.normalizeUrl("https://"))
        assertNull(SettingsInput.normalizeUrl("http://exa mple.com"))
    }

    @Test
    fun `a token is three base64url parts`() {
        assertTrue(SettingsInput.isToken("eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJtZSJ9.c2ln-_"))
        assertFalse(SettingsInput.isToken("helm_abcdef"))
        assertFalse(SettingsInput.isToken("a.b"))
        assertFalse(SettingsInput.isToken("a.b.c d"))
    }
}
