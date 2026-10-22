package dev.helm.planner

import android.app.Application
import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.remote.ConvexTaskFeed
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.TaskFeed
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.sync.OutboxScheduler
import dev.helm.planner.sync.RoomOutboxStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class HelmApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Changes left from an earlier run (killed app, reboot) go out as soon as there is a network.
        container.outboxScheduler.restart()
        ProcessLifecycleOwner.get().lifecycleScope.launch {
            ProcessLifecycleOwner.get().repeatOnLifecycle(Lifecycle.State.STARTED) {
                container.liveSync.run()
            }
        }
    }
}

/** The app's objects, created once per process. */
class AppContainer(context: Context) {
    val database = HelmDatabase.open(context)
    val settings = SettingsStore(context)
    val network = NetworkMonitor(context)
    val outboxScheduler = OutboxScheduler(context)
    val outboxStore = RoomOutboxStore(database)
    val repository = TaskRepository(database, onOutboxChanged = outboxScheduler::schedule)
    val liveSync = LiveSync(settings, repository, ::feedFor)

    /** The outbox talks plain HTTP: clear timeouts and no WebSocket in the background. */
    fun mutationSender(backend: BackendConfig): MutationSender = HttpTaskRemote(backend.url, backend.token)

    /** Live Convex subscription; polling over HTTP if the native client cannot load on this device. */
    private fun feedFor(backend: BackendConfig, scope: CoroutineScope): TaskFeed = try {
        ConvexTaskFeed(backend.url, backend.token, scope)
    } catch (_: LinkageError) {
        HttpTaskRemote(backend.url, backend.token)
    }
}
