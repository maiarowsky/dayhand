package dev.helm.planner.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.helm.planner.HelmApplication
import java.util.concurrent.TimeUnit

/**
 * Sends the outbox when there is a network. WorkManager keeps the request across the app
 * being killed and the phone restarting; a change leaves Room only after the server answered.
 */
class OutboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as HelmApplication).container
        val settings = container.settings.current()
        // Without a server (on this phone only) the changes wait; pairing schedules again.
        val backend = settings.backend ?: return Result.success()
        val processor = OutboxProcessor(container.outboxStore, container.mutationSender(backend))
        return when (processor.drain()) {
            DrainResult.DONE -> Result.success()
            DrainResult.MORE_LEFT -> {
                container.outboxScheduler.schedule()
                Result.success()
            }
            DrainResult.RETRY_LATER, DrainResult.UNAUTHORIZED -> Result.retry()
        }
    }
}

class OutboxScheduler(private val context: Context) {
    /**
     * After a local change: queue a run behind any run in progress, so a change made while the
     * worker is finishing is never missed.
     */
    fun schedule() = enqueue(ExistingWorkPolicy.APPEND_OR_REPLACE)

    /** At start and after a settings change: start over now instead of waiting out a back-off. */
    fun restart() = enqueue(ExistingWorkPolicy.REPLACE)

    private fun enqueue(policy: ExistingWorkPolicy) {
        val request = OneTimeWorkRequestBuilder<OutboxWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, policy, request)
    }

    companion object {
        const val WORK_NAME = "helm-outbox"
        private const val BACKOFF_SECONDS = 15L
    }
}
