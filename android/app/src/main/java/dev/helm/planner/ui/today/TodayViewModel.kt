package dev.helm.planner.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.domain.todaySections
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.FeedState
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TodayViewModel(
    private val repository: TaskRepository,
    settings: SettingsStore,
    network: NetworkMonitor,
    liveSync: LiveSync,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel(), TodayActions {

    /** The current time, once a minute on the minute, so the sections move on at local midnight. */
    private val minutes: Flow<Long> = flow {
        while (true) {
            val now = clock()
            emit(now)
            delay(MINUTE_MS - now % MINUTE_MS)
        }
    }

    private val connection: Flow<ConnectionStatus> =
        combine(settings.settings, network.online, liveSync.state) { s, online, feed ->
            when {
                s.backend == null -> ConnectionStatus.NOT_CONFIGURED
                s.offlineMode -> ConnectionStatus.OFFLINE_MODE
                !online -> ConnectionStatus.OFFLINE
                feed == FeedState.UNAUTHORIZED -> ConnectionStatus.UNAUTHORIZED
                feed == FeedState.ERROR -> ConnectionStatus.ERROR
                feed == FeedState.SYNCED -> ConnectionStatus.SYNCED
                else -> ConnectionStatus.CONNECTING
            }
        }

    val state: StateFlow<TodayUiState?> =
        combine(repository.tasks, settings.settings, minutes, connection, repository.pendingChanges) { tasks, s, now, c, pending ->
            TodayUiState(todaySections(tasks, now, s.timezone), c, pending)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    override fun complete(localId: String) = launch { repository.complete(localId) }
    override fun reopen(localId: String) = launch { repository.reopen(localId) }
    override fun moveTo(localId: String, date: String) = launch { repository.reschedule(localId, date) }
    override fun archive(localId: String) = launch { repository.archive(localId) }
    override fun setNow(localId: String) = launch { repository.setNow(localId) }
    override fun clearNow() = launch { repository.clearNow() }
    override fun saveResumeNote(localId: String, note: String) = launch { repository.setResumeNote(localId, note) }
    override fun add(title: String, dueDate: String?, dueTime: String?, note: String?) =
        launch { repository.add(title, dueDate, dueTime, note) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    private companion object {
        const val MINUTE_MS = 60_000L
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
