package dev.helm.planner.auth

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/** A `dayhand://pair?url=…&code=…` link from `dayhand pair` (text or QR), see docs/pairing.md. */
data class PairingLink(val serverUrl: String?, val code: String?)

/** Checks of what the user types on the Connect screen, the same rules as the backend. */
object PairingInput {
    /** Crockford base32 without I, L, O and U, as `CODE_ALPHABET` in `backend/convex/lib/secrets.ts`. */
    private const val CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val CODE_LENGTH = 12
    private const val GROUP = 4
    private val LOOPBACK_HOSTS = setOf("127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]")

    /** `dayhand://pair` is what `dayhand pair` prints; `helm://pair` is the same link from `hlm` before the rename. */
    private val LINK_SCHEMES = setOf("dayhand", "helm")

    /**
     * `XXXX-XXXX-XXXX` from a typed code (any case, with or without dashes and spaces; `O` is
     * read as `0`, `I` and `L` as `1`), or null when it cannot be a pairing code.
     */
    fun normalizeCode(input: String): String? {
        val code = input.uppercase()
            .filterNot { it.isWhitespace() || it == '-' }
            .replace('O', '0')
            .replace('I', '1')
            .replace('L', '1')
        if (code.length != CODE_LENGTH || code.any { it !in CODE_ALPHABET }) return null
        return code.chunked(GROUP).joinToString("-")
    }

    /**
     * The HTTP actions URL (`https://<name>.convex.site`) without a trailing slash, or null.
     * A Convex deployment URL (`.convex.cloud`) is turned into its HTTP actions URL, since that
     * is the address people copy from the dashboard most often.
     */
    fun normalizeServerUrl(input: String): String? {
        val url = input.trim().trimEnd('/')
        val uri = parse(url) ?: return null
        if (uri.scheme != "http" && uri.scheme != "https") return null
        val host = uri.host
        if (host.isNullOrEmpty()) return null
        if (!uri.rawPath.isNullOrEmpty() || uri.rawQuery != null) return null
        return if (host.endsWith(".convex.cloud")) url.replace(".convex.cloud", ".convex.site") else url
    }

    /** The server and code from a pairing link, or null when [uri] is not one. */
    fun parseLink(uri: String): PairingLink? {
        val parsed = parse(uri.trim()) ?: return null
        if (parsed.scheme !in LINK_SCHEMES || parsed.host != "pair") return null
        val params = parsed.rawQuery.orEmpty().split('&').mapNotNull { pair ->
            val parts = pair.split('=', limit = 2)
            if (parts.size != 2) return@mapNotNull null
            parts[0] to decode(parts[1])
        }.toMap()
        return PairingLink(
            serverUrl = params["url"]?.let(::normalizeServerUrl),
            code = params["code"]?.let(::normalizeCode),
        )
    }

    /**
     * The Convex URL to use from this phone. `/auth/pair` returns the deployment's own view of
     * its address; a local backend calls itself `127.0.0.1`, which the phone cannot reach, so
     * there the host of the server the phone just talked to is used with the returned port.
     */
    fun reachableConvexUrl(convexUrl: String, serverUrl: String): String {
        val convex = parse(convexUrl) ?: return convexUrl
        val server = parse(serverUrl) ?: return convexUrl
        if (convex.host !in LOOPBACK_HOSTS) return convexUrl.trimEnd('/')
        return URI(convex.scheme, null, server.host, convex.port, null, null, null).toString()
    }

    private fun decode(value: String): String = try {
        URLDecoder.decode(value, Charsets.UTF_8.name())
    } catch (_: IllegalArgumentException) {
        value
    }

    private fun parse(value: String): URI? = try {
        URI(value)
    } catch (_: URISyntaxException) {
        null
    }
}
