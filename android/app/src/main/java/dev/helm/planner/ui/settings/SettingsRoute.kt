package dev.helm.planner.ui.settings

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helm.planner.AppContainer
import dev.helm.planner.R
import dev.helm.planner.export.ExportFormat
import dev.helm.planner.notify.AndroidAlarmScheduler
import dev.helm.planner.notify.AndroidNotifier
import dev.helm.planner.settings.AppLanguage
import dev.helm.planner.settings.AppLanguages
import dev.helm.planner.ui.connections.ConnectionsRoute
import dev.helm.planner.ui.theme.Appearance
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0"
private const val BACKUP_MIME = "application/json"

/** The cache folder of shared backups (`res/xml/shared_files.xml`). */
private const val BACKUP_DIR = "backup"

/**
 * Settings with what only the system knows: permissions, the per-app language, the save dialog. [SettingsScreen]
 * opens its own pages; Back from the list leaves Settings.
 */
@Composable
fun SettingsRoute(container: AppContainer, versionName: String, onBack: () -> Unit, onConnect: () -> Unit) {
    BackHandler(onBack = onBack)
    val appearance by container.appearance.appearance.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = LocalActivity.current
    val appContext = context.applicationContext
    val viewModel = viewModel {
        SettingsViewModel(container, writeFile = { uri, text -> writeText(appContext, uri, text) }, readFile = { uri -> readText(appContext, uri) })
    }
    val data by viewModel.state.collectAsStateWithLifecycle()

    // Permissions can change in the system settings while Helm is in the background.
    var resumes by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        resumes++
        onPauseOrDispose {}
    }
    var deniedForGood by rememberSaveable { mutableStateOf(false) }
    val notifications = remember(resumes, deniedForGood) { notificationAccess(context, deniedForGood) }
    val exactAlarms = remember(resumes) { AndroidAlarmScheduler.canScheduleExact(context) }
    val language = remember(resumes) { if (AppLanguages.supported) AppLanguages.current(context) else null }

    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        // Android shows no dialog any more after the user refused: from now on the button opens the system settings.
        if (!granted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            activity?.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) != true
        ) {
            deniedForGood = true
        }
        resumes++
    }
    val saveMarkdown = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.MARKDOWN.mimeType)) {
        viewModel.saveExport(it)
    }
    val saveJson = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.JSON.mimeType)) {
        viewModel.saveExport(it)
    }
    val saveBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(BACKUP_MIME)) { viewModel.saveBackupTo(it) }
    // Files apps label JSON differently; anything can be picked and the content decides.
    val pickBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { viewModel.restoreFrom(it) }
    val shareTitle = stringResource(R.string.backup_share_title)
    val backup = data?.backup
    LaunchedEffect(backup) {
        when (backup) {
            is BackupStatus.ReadyToSave -> if (!backup.dialogOpen) {
                viewModel.backupDialogOpened()
                saveBackup.launch(backup.fileName)
            }
            is BackupStatus.ReadyToShare -> viewModel.backupShared(shareBackup(context, backup.fileName, backup.content, shareTitle))
            else -> {}
        }
    }
    val export = data?.export
    LaunchedEffect(export) {
        if (export is ExportStatus.Ready && !export.dialogOpen) {
            viewModel.dialogOpened()
            val launcher = if (export.result.format == ExportFormat.MARKDOWN) saveMarkdown else saveJson
            launcher.launch(export.result.fileName)
        }
    }

    val actions = remember(viewModel) {
        object : SettingsActions {
            override fun openConnect() = onConnect()
            override fun disconnect() = viewModel.disconnect()
            override fun usePhoneTimezone() = viewModel.usePhoneTimezone()
            override fun saveBackup() = viewModel.saveBackup()
            override fun shareBackup() = viewModel.shareBackup()
            override fun restoreBackup() = pickBackup.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
            override fun removeSample() = viewModel.removeSample()
            override fun setSummaryTime(time: String) = viewModel.setSummaryTime(time)
            override fun setReminderMinutes(minutes: List<Int>) = viewModel.setReminderMinutes(minutes)
            override fun export(format: ExportFormat) = viewModel.export(format)
            override fun back() = onBack()

            override fun setLanguage(language: AppLanguage) {
                AppLanguages.set(context, language)
                resumes++
            }

            override fun allowNotifications() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !deniedForGood && !hasPermission(context)) {
                    askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    open(context, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                }
            }

            override fun allowExactAlarms() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    open(context, Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
                }
            }

            override fun openLicense() = open(context, Intent(Intent.ACTION_VIEW, Uri.parse(LICENSE_URL)))
            override fun setAppearance(appearance: Appearance) = container.appearance.save(appearance)
        }
    }
    data?.let {
        SettingsScreen(
            SettingsUiState(it, versionName, notifications, exactAlarms, language, appearance),
            actions,
            connections = { back -> ConnectionsRoute(container, back) },
            calendar = { back -> CalendarFeedRoute(container, back) },
        )
    } ?: SettingsLoading(onBack)
}

private fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

private fun notificationAccess(context: Context, deniedForGood: Boolean): NotificationAccess = when {
    AndroidNotifier.canPost(context) -> NotificationAccess.ALLOWED
    !hasPermission(context) && !deniedForGood -> NotificationAccess.ASK
    else -> NotificationAccess.BLOCKED
}

/** A settings page or the browser; a phone without one is not a crash. */
private fun open(context: Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
    }
}

private suspend fun writeText(context: Context, uri: Uri, text: String) = withContext(Dispatchers.IO) {
    val stream = context.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("no output stream for $uri")
    stream.use { it.write(text.toByteArray()) }
}

private suspend fun readText(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val stream = context.contentResolver.openInputStream(uri) ?: throw IOException("no input stream for $uri")
    stream.use { String(it.readBytes(), Charsets.UTF_8) }
}

/** Writes the backup into the app's cache (the folder the provider shares) and offers it to other apps; false when it could not be written. */
private suspend fun shareBackup(context: Context, fileName: String, content: String, title: String): Boolean {
    val file = try {
        withContext(Dispatchers.IO) {
            File(context.cacheDir, BACKUP_DIR).apply { mkdirs() }.resolve(fileName).apply { writeText(content) }
        }
    } catch (_: IOException) {
        return false
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND)
        .setType(BACKUP_MIME)
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_SUBJECT, title)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    open(context, Intent.createChooser(send, title))
    return true
}

/** True on Android 13+ while Helm may not post notifications yet. */
fun needsNotificationPermission(context: Context): Boolean = !hasPermission(context)
