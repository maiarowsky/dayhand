package dev.helm.planner.ui.common

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
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
