package dev.helm.planner.ui.common

import dev.helm.planner.settings.AppSettings
import dev.helm.planner.sync.FeedState
import dev.helm.planner.ui.today.ConnectionStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow

private const val MINUTE_MS = 60_000L

/** The current time, once a minute on the minute, so screens move on at local midnight. */
fun minuteTicks(clock: () -> Long): Flow<Long> = flow {
    while (true) {
        val now = clock()
        emit(now)
        delay(MINUTE_MS - now % MINUTE_MS)
    }
}

/** What the status line of Today and the board says about the server connection. */
fun connectionStatus(settings: Flow<AppSettings>, online: Flow<Boolean>, feed: Flow<FeedState>): Flow<ConnectionStatus> =
    combine(settings, online, feed) { s, isOnline, state ->
        when {
            s.backend == null -> ConnectionStatus.NOT_CONFIGURED
            s.offlineMode -> ConnectionStatus.OFFLINE_MODE
            !isOnline -> ConnectionStatus.OFFLINE
            state == FeedState.UNAUTHORIZED -> ConnectionStatus.UNAUTHORIZED
            state == FeedState.ERROR -> ConnectionStatus.ERROR
            state == FeedState.SYNCED -> ConnectionStatus.SYNCED
            else -> ConnectionStatus.CONNECTING
        }
    }
