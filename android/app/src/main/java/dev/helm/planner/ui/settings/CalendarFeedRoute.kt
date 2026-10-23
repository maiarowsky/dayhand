package dev.helm.planner.ui.settings

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.AppContainer
import dev.helm.planner.R
import dev.helm.planner.domain.HelmDates
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Settings → Calendar, signed in as the paired owner; the address goes to the clipboard, the browser or another device. */
@Composable
fun CalendarFeedRoute(container: AppContainer, onBack: () -> Unit) {
    val viewModel = viewModel {
        CalendarFeedViewModel(
            api = { container.settings.current().let { s -> s.backend?.takeUnless { s.offlineMode }?.let(container::calendarFeedApi) } },
            exporter = { container.settings.current().let { s -> s.backend?.takeUnless { s.offlineMode }?.let(container::exporter) } },
            today = { HelmDates.localDate(System.currentTimeMillis(), container.settings.current().timezone) },
        )
    }
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.calendar_feed_share_title)
    val actions = remember(viewModel) {
        object : CalendarFeedActions {
            override fun turnOn() = viewModel.turnOn()
            override fun rotate() = viewModel.rotate()
            override fun turnOff() = viewModel.turnOff()
            override fun export() = viewModel.export()
            override fun retry() = viewModel.reload()

            override fun copy() {
                val feed = (viewModel.ui.value.feed as? FeedView.On)?.feed ?: return
                copySecret(context, shareTitle, feed.url)
                viewModel.copied()
            }

            override fun openGoogle() {
                val feed = (viewModel.ui.value.feed as? FeedView.On)?.feed ?: return
                start(context, Intent(Intent.ACTION_VIEW, Uri.parse(feed.googleCalendarUrl)))
            }

            override fun shareApple() {
                val feed = (viewModel.ui.value.feed as? FeedView.On)?.feed ?: return
                val send = Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, shareTitle)
                    .putExtra(Intent.EXTRA_TEXT, feed.webcalUrl)
                start(context, Intent.createChooser(send, shareTitle))
            }
        }
    }
    val export = ui.export
    LaunchedEffect(export) {
        if (export is IcsExport.Ready) {
            shareFile(context, export.fileName, export.content, shareTitle)
            viewModel.exportHandled()
        }
    }
    CalendarFeedPage(ui, actions, onBack)
}

/** Copies the address, marked sensitive so Android 13+ does not show it in the clipboard preview. */
private fun copySecret(context: Context, label: String, text: String) {
    val clip = ClipData.newPlainText(label, text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    }
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)
}

/** Writes the .ics into the app's cache (the only folder the provider shares) and offers it to other apps. */
private suspend fun shareFile(context: Context, fileName: String, content: String, title: String) {
    val file = try {
        withContext(Dispatchers.IO) {
            File(context.cacheDir, "calendar").apply { mkdirs() }.resolve(fileName).apply { writeText(content) }
        }
    } catch (_: IOException) {
        return
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/calendar")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_SUBJECT, title)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    start(context, Intent.createChooser(send, title))
}

/** The browser or the share sheet; a phone without one is not a crash. */
private fun start(context: Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
    }
}
