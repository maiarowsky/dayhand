package dev.helm.planner.auth

import dev.helm.planner.settings.Credential

/** Why connecting failed, in the words the Connect screen uses. */
enum class ConnectError {
    BAD_ADDRESS,
    BAD_CODE,

    /** Wrong, expired, used or burned code (the server does not say which). */
    INVALID_CODE,
    RATE_LIMITED,
    NO_NETWORK,
    UNREACHABLE,
    NOT_HELM,
    SERVER_ERROR,
}

sealed interface ConnectOutcome {
    data object Connected : ConnectOutcome
    data class Failed(val error: ConnectError, val retryAfterSeconds: Long? = null) : ConnectOutcome
}

/**
 * Pairs this phone with a server: checks the input, exchanges the one-time code for a device
 * token (`POST /auth/pair`) and stores it through [save]. Nothing is stored unless the server
 * accepted the code.
 */
class DevicePairing(
    private val api: PairingApi,
    private val isOnline: suspend () -> Boolean,
    private val save: suspend (convexUrl: String, device: Credential.Device) -> Unit,
) {
    suspend fun connect(address: String, code: String, deviceName: String): ConnectOutcome {
        val serverUrl = PairingInput.normalizeServerUrl(address) ?: return failed(ConnectError.BAD_ADDRESS)
        val normalizedCode = PairingInput.normalizeCode(code) ?: return failed(ConnectError.BAD_CODE)
        if (!isOnline()) return failed(ConnectError.NO_NETWORK)
        return when (val result = api.pair(serverUrl, normalizedCode, deviceLabel(deviceName))) {
            is PairResult.Paired -> {
                val device = Credential.Device(serverUrl, result.deviceId, result.deviceName, result.deviceToken)
                save(PairingInput.reachableConvexUrl(result.convexUrl, serverUrl), device)
                ConnectOutcome.Connected
            }
            PairResult.InvalidCode -> failed(ConnectError.INVALID_CODE)
            is PairResult.RateLimited -> ConnectOutcome.Failed(ConnectError.RATE_LIMITED, result.retryAfterSeconds)
            // The network may have dropped while the request was on its way.
            is PairResult.Unreachable -> failed(if (isOnline()) ConnectError.UNREACHABLE else ConnectError.NO_NETWORK)
            PairResult.NotHelm -> failed(ConnectError.NOT_HELM)
            is PairResult.ServerError -> failed(ConnectError.SERVER_ERROR)
        }
    }

    private fun failed(error: ConnectError) = ConnectOutcome.Failed(error)

    companion object {
        /** The backend accepts 1 to 100 characters (`deviceName` in docs/pairing.md). */
        private const val MAX_NAME = 100
        private const val DEFAULT_NAME = "Phone"

        fun deviceLabel(name: String): String = name.trim().take(MAX_NAME).ifEmpty { DEFAULT_NAME }
    }
}
