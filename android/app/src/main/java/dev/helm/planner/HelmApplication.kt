package dev.helm.planner

import android.app.Application
import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.helm.planner.auth.AppTokens
import dev.helm.planner.auth.DeviceTokens
import dev.helm.planner.auth.PairingApi
import dev.helm.planner.auth.StaticTokens
import dev.helm.planner.data.TaskRepository
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.remote.ConvexTaskFeed
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.TaskFeed
import dev.helm.planner.domain.ReminderRules
import dev.helm.planner.export.PlanExporter
import dev.helm.planner.notify.AndroidAlarmScheduler
import dev.helm.planner.notify.AndroidNotifier
import dev.helm.planner.notify.DataStoreAlarmState
import dev.helm.planner.notify.ReminderEngine
import dev.helm.planner.settings.BackendConfig
import dev.helm.planner.settings.Credential
import dev.helm.planner.settings.SettingsStore
import dev.helm.planner.sync.LiveSync
import dev.helm.planner.sync.NetworkMonitor
import dev.helm.planner.sync.OutboxScheduler
import dev.helm.planner.sync.RoomOutboxStore
import dev.helm.planner.sync.TaskHistorySync
import dev.helm.planner.ui.theme.AppearanceStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

class HelmApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Changes left from an earlier run (killed app, reboot) go out as soon as there is a network.
        container.outboxScheduler.restart()
        container.notifier.createChannels()
        // Alarms follow every change of the timed tasks or the reminder settings, from any source.
        container.backgroundScope.launch {
            combine(container.repository.tasks, container.settings.settings) { tasks, s ->
                ReminderRules.reminders(tasks, s.reminderMinutes, s.timezone) to s.reminders
            }
                .distinctUntilChanged()
                .collect { container.reminders.reschedule() }
        }
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
    val appearance = AppearanceStore(context)
    val network = NetworkMonitor(context)
    val outboxScheduler = OutboxScheduler(context)
    val outboxStore = RoomOutboxStore(database)
    val repository = TaskRepository(database, onOutboxChanged = outboxScheduler::schedule)
    val liveSync = LiveSync(settings, repository, ::feedFor)

    /** A task's change history is read over plain HTTP when its details are open, cached in Room. */
    val historySync = TaskHistorySync(
        runner = {
            val current = settings.current()
            current.backend?.takeUnless { current.offlineMode }?.let { HttpTaskRemote(it.url, tokensFor(it)) }
        },
        save = repository::saveHistory,
    )

    /** Work that outlives a screen: alarm receivers and the reminder schedule. */
    val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val notifier = AndroidNotifier(context)
    val reminders = ReminderEngine(
        tasks = { database.tasks().all() },
        settings = { settings.current().reminders },
        state = DataStoreAlarmState(context),
        alarms = AndroidAlarmScheduler(context),
        notifier = notifier,
    )

    val pairingApi = PairingApi()
    private var tokenCache: Pair<BackendConfig, AppTokens>? = null

    /** The plan export goes over plain HTTP, like the outbox. */
    fun exporter(backend: BackendConfig) = PlanExporter(HttpTaskRemote(backend.url, tokensFor(backend)))

    /** The outbox talks plain HTTP: clear timeouts and no WebSocket in the background. */
    fun mutationSender(backend: BackendConfig): MutationSender = HttpTaskRemote(backend.url, tokensFor(backend))

    /**
     * One token source per sign-in, shared by the feed, the outbox and the export, so they reuse
     * one app JWT. A revoked device is forgotten, which shows the Connect prompt again.
     */
    @Synchronized
    fun tokensFor(backend: BackendConfig): AppTokens {
        tokenCache?.let { (config, tokens) -> if (config == backend) return tokens }
        val tokens = when (val credential = backend.credential) {
            is Credential.AppToken -> StaticTokens(credential.token)
            is Credential.Device -> DeviceTokens(
                serverUrl = credential.serverUrl,
                deviceToken = credential.deviceToken,
                api = pairingApi,
                onRevoked = { settings.forgetDevice(revoked = true) },
            )
        }
        tokenCache = backend to tokens
        return tokens
    }

    /** Live Convex subscription; polling over HTTP if the native client cannot load on this device. */
    private fun feedFor(backend: BackendConfig, scope: CoroutineScope): TaskFeed = try {
        ConvexTaskFeed(backend.url, tokensFor(backend), scope)
    } catch (_: LinkageError) {
        HttpTaskRemote(backend.url, tokensFor(backend))
    }
}
