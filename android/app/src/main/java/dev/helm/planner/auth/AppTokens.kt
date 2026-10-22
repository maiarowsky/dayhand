package dev.helm.planner.auth

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Where the app JWT for the Convex client and the HTTP API comes from. */
interface AppTokens {
    /**
     * A token to send now. [forceRefresh] asks the server for a new one even when the cached
     * one still looks valid (the server refused it).
     */
    suspend fun token(forceRefresh: Boolean = false): TokenResult
}

/** A token pasted in Settings by an earlier version of the app (`npm run app-token`); it cannot be refreshed. */
class StaticTokens(private val token: String) : AppTokens {
    override suspend fun token(forceRefresh: Boolean): TokenResult = TokenResult.Issued(token, Long.MAX_VALUE)
}

/**
 * App JWTs (1 hour) for a paired phone, from `POST /auth/token`. One instance is shared by the
 * live feed and the outbox, so they reuse the same token. It is kept in memory only and fetched
 * again when less than [refreshMarginMs] is left. `401` means the device was revoked:
 * [onRevoked] drops the pairing. Network errors and `503` keep the device token; a cached JWT
 * that is still valid is used meanwhile.
 */
class DeviceTokens(
    private val serverUrl: String,
    private val deviceToken: String,
    private val api: PairingApi,
    private val onRevoked: suspend () -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val refreshMarginMs: Long = REFRESH_MARGIN_MS,
) : AppTokens {
    private val mutex = Mutex()
    private var cached: TokenResult.Issued? = null

    override suspend fun token(forceRefresh: Boolean): TokenResult = mutex.withLock {
        val current = cached
        val now = clock()
        if (!forceRefresh && current != null && current.expiresAt - now > refreshMarginMs) return current
        when (val fresh = api.token(serverUrl, deviceToken)) {
            is TokenResult.Issued -> fresh.also { cached = it }
            TokenResult.Revoked -> {
                cached = null
                onRevoked()
                fresh
            }
            is TokenResult.Unavailable ->
                if (current != null && current.expiresAt - now > STILL_USABLE_MS) current else fresh
        }
    }

    companion object {
        /** Refresh when less than 5 minutes are left (docs/pairing.md). */
        const val REFRESH_MARGIN_MS = 5 * 60 * 1000L

        /** A cached token this close to its end is not worth sending when a refresh failed. */
        private const val STILL_USABLE_MS = 30 * 1000L
    }
}
