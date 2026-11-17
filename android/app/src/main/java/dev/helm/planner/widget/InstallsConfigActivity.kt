package dev.helm.planner.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.security.NetworkSecurityPolicy
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import dev.helm.planner.R
import dev.helm.planner.ui.theme.HelmTheme
import kotlinx.coroutines.launch

/**
 * The installs widget's address: shown when the widget is placed (and from its settings on Android 12+, or a tap
 * before an address is set). Saving fetches the file at once.
 */
class InstallsConfigActivity : ComponentActivity() {
    private val widgetId by lazy {
        intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Leaving without saving does not place the widget.
        setResult(RESULT_CANCELED, result())
        val store = InstallsStore(this)
        setContent {
            HelmTheme {
                val saved by produceState<String?>(null) { value = store.current().url.orEmpty() }
                saved?.let { InstallsConfigScreen(it, ::save) }
            }
        }
    }

    private fun save(url: String) {
        lifecycleScope.launch {
            InstallsStore(this@InstallsConfigActivity).setUrl(url)
            InstallsScheduler.start(applicationContext)
            InstallsScheduler.refreshNow(applicationContext)
            setResult(RESULT_OK, result())
            finish()
        }
    }

    private fun result() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
}

object InstallsConfigTags {
    const val URL = "installs_config_url"
    const val SAVE = "installs_config_save"
    const val ERROR = "installs_config_error"
}

@Composable
private fun InstallsConfigScreen(saved: String, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(saved) }
    var error by rememberSaveable { mutableStateOf<Int?>(null) }
    val save = {
        when (val check = checkInstallsUrl(text) { NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(it) }) {
            is UrlCheck.Valid -> onSave(check.url)
            UrlCheck.NotHttp -> error = R.string.installs_config_invalid_url
            UrlCheck.CleartextRefused -> error = R.string.installs_config_cleartext
        }
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.installs_config_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.installs_config_help), style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    error = null
                },
                label = { Text(stringResource(R.string.installs_config_url)) },
                singleLine = true,
                isError = error != null,
                supportingText = error?.let { { Text(stringResource(it), Modifier.testTag(InstallsConfigTags.ERROR)) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth().testTag(InstallsConfigTags.URL),
            )
            Button(onClick = save, modifier = Modifier.testTag(InstallsConfigTags.SAVE)) {
                Text(stringResource(R.string.installs_config_save))
            }
        }
    }
}
