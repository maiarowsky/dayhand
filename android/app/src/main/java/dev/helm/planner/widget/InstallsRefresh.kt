package dev.helm.planner.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URISyntaxException
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Fetches the installs file, keeps it if it parses, and redraws every placed widget. */
class InstallsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = InstallsStore(applicationContext)
        val url = store.current().url ?: return Result.success()
        store.apply(url, InstallsFetcher.fetch(url), System.currentTimeMillis())
        InstallsWidget().updateAll(applicationContext)
        // A failure is shown on the widget and retried on the next period or tap, not in a back-off loop.
        return Result.success()
    }
}

object InstallsScheduler {
    private const val PERIODIC = "installs-widget-periodic"
    private const val NOW = "installs-widget-now"
    private const val PERIOD_HOURS = 3L

    /** Every few hours while a widget is placed; the stores publish once a day, so more often gains nothing. */
    fun start(context: Context) {
        val request = PeriodicWorkRequestBuilder<InstallsWorker>(PERIOD_HOURS, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** A tap or a new address: try at once, without waiting for a network, so an offline phone says so. */
    fun refreshNow(context: Context) {
        WorkManager.getInstance(context)
            .enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<InstallsWorker>().build())
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).run {
            cancelUniqueWork(PERIODIC)
            cancelUniqueWork(NOW)
        }
    }
}

object InstallsFetcher {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    /** The file is a few hundred bytes; anything far larger is not an installs file. */
    private const val MAX_BYTES = 256 * 1024

    suspend fun fetch(url: String): FetchResult = withContext(Dispatchers.IO) {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return@withContext FetchResult.Failed(FetchFailure.Network)
        }
        try {
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) return@withContext FetchResult.Failed(FetchFailure.Http(status))
            val bytes = connection.inputStream.use { readAtMost(it, MAX_BYTES) }
                ?: return@withContext FetchResult.Failed(FetchFailure.InvalidFile)
            FetchResult.Body(bytes.toString(Charsets.UTF_8))
        } catch (_: IOException) {
            FetchResult.Failed(FetchFailure.Network)
        } finally {
            connection.disconnect()
        }
    }

    private fun readAtMost(input: InputStream, limit: Int): ByteArray? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) return out.toByteArray()
            out.write(buffer, 0, read)
            if (out.size() > limit) return null
        }
    }
}

sealed interface UrlCheck {
    data class Valid(val url: String) : UrlCheck

    data object NotHttp : UrlCheck

    /** Plain http where the network security config forbids it: everywhere in release builds. */
    data object CleartextRefused : UrlCheck
}

/** [cleartextAllowed] is Android's `NetworkSecurityPolicy.isCleartextTrafficPermitted(host)`. */
fun checkInstallsUrl(text: String, cleartextAllowed: (String) -> Boolean): UrlCheck {
    val trimmed = text.trim()
    val uri = try {
        URI(trimmed)
    } catch (_: URISyntaxException) {
        return UrlCheck.NotHttp
    }
    val host = uri.host?.takeIf { it.isNotEmpty() } ?: return UrlCheck.NotHttp
    return when (uri.scheme?.lowercase()) {
        "https" -> UrlCheck.Valid(trimmed)
        "http" -> if (cleartextAllowed(host)) UrlCheck.Valid(trimmed) else UrlCheck.CleartextRefused
        else -> UrlCheck.NotHttp
    }
}
