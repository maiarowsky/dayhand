package dev.helm.planner.sync

import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.data.remote.TaskFeed
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** What the server connection is doing, for the status line on the Today screen. */
enum class FeedState { NOT_CONFIGURED, CONNECTING, SYNCED, UNAUTHORIZED, ERROR }

/**
 * While the app is in the foreground, keeps one feed per backend configuration open and writes
 * every snapshot to Room. The Convex client reconnects by itself after a network loss, so the
 * feed is not restarted when the network comes and goes.
 */
class LiveSync(
    private val settings: SettingsStore,
    private val repository: TaskRepository,
    private val feedFor: (BackendConfig, CoroutineScope) -> TaskFeed,
) {
    private val _state = MutableStateFlow(FeedState.CONNECTING)
    val state: StateFlow<FeedState> = _state.asStateFlow()

    suspend fun run() {
        settings.settings
            .map { it.backend }
            .distinctUntilChanged()
            .collectLatest { backend ->
                if (backend == null) _state.value = FeedState.NOT_CONFIGURED else follow(backend)
            }
    }

    private suspend fun follow(backend: BackendConfig) = coroutineScope {
        _state.value = FeedState.CONNECTING
        feedFor(backend, this).events().collect { event ->
            when (event) {
                is RemoteEvent.Snapshot -> {
                    repository.applySnapshot(event)
                    settings.applyServer(event, keepLocalChanges = repository.hasPendingSettingsChange())
                    _state.value = FeedState.SYNCED
                }
                RemoteEvent.Unauthorized -> _state.value = FeedState.UNAUTHORIZED
                is RemoteEvent.Failed -> _state.value = FeedState.ERROR
            }
        }
    }
}
