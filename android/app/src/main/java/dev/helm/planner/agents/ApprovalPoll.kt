package dev.helm.planner.agents

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.helm.planner.HelmApplication
import java.util.concurrent.TimeUnit

/** Which pending requests are new since the last look; the ids remembered are only the ones still pending. */
object ApprovalAlerts {
    data class Outcome(val notify: List<ApprovalRequest>, val seen: Set<String>)

    fun check(pending: List<ApprovalRequest>, seen: Set<String>): Outcome {
        val waiting = pending.filter { it.status == ApprovalStatus.PENDING }
        return Outcome(waiting.filter { it.id !in seen }, waiting.map { it.id }.toSet())
    }
}

/** The ids of the requests already shown as notifications, so each is shown once. */
class SeenApprovals(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(): Set<String> = prefs.getStringSet(KEY, emptySet()).orEmpty().toSet()

    fun set(ids: Set<String>) = prefs.edit().putStringSet(KEY, ids).apply()

    private companion object {
        const val PREFS = "agent_approvals"
        const val KEY = "notified"
    }
}

/**
 * Looks for new approval requests while Dayhand is closed: the server cannot push to the phone (no Firebase in this
 * app), so WorkManager runs this every 15 minutes, its shortest period, when there is a network. A request can
 * therefore wait up to about 15 minutes (longer in Doze) before the phone shows it.
 */
class ApprovalPollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as HelmApplication).container
        val backend = container.settings.current().backend ?: return Result.success()
        val seen = SeenApprovals(applicationContext)
        when (val load = container.agentControlApi(backend).approvals(ApprovalStatus.PENDING)) {
            is Load.Loaded -> {
                val outcome = ApprovalAlerts.check(load.value, seen.get())
                container.notifier.showApprovals(outcome.notify)
                seen.set(outcome.seen)
            }
            // Signed out or an older server: nothing to show; the next run tries again.
            Load.Unauthorized, is Load.Failed -> {}
        }
        return Result.success()
    }
}

class ApprovalPollScheduler(private val context: Context) {
    /** Polls while the phone is connected to a server; a phone on its own has no agents. */
    fun update(connected: Boolean) {
        val work = WorkManager.getInstance(context)
        if (!connected) {
            work.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<ApprovalPollWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        work.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    companion object {
        const val WORK_NAME = "dayhand-approvals"

        /** WorkManager's shortest period. */
        const val PERIOD_MINUTES = 15L
    }
}
