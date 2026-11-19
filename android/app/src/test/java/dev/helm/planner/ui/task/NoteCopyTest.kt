package dev.helm.planner.ui.task

import android.app.Application
import android.content.ClipboardManager
import android.widget.Magnifier
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuItem
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuKeys
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuSession
import androidx.compose.foundation.text.contextmenu.provider.LocalTextContextMenuToolbarProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuDataProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuProvider
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.Task
import dev.helm.planner.sync.HistoryState
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.HelmTheme
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/** A note with commands to paste into a terminal: a long press on it offers Copy, and the copy is the note as written. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h780dp", shadows = [NoteCopyTest.SilentMagnifier::class])
class NoteCopyTest {
    @get:Rule val compose = createComposeRule()

    private val note = "dayhand login --server https://example.test\n\ndayhand whoami\ndayhand ls --json"
    private val menu = RecordingMenu()

    private fun show() {
        val task = Task("task", title = "Log in on the desk", note = note, createdAt = 0, updatedAt = 0)
        val state = TaskDetailUiState.Ready(task, "2026-11-19", "UTC", emptyList(), HistoryState.FRESH, 0, listOf(0))
        compose.setContent {
            CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides menu) {
                HelmTheme(Appearance()) { TaskDetailScreen(state, object : TaskDetailActions {}) }
            }
        }
    }

    private fun clipboardText(): String? {
        val clipboard = ApplicationProvider.getApplicationContext<Application>().getSystemService(ClipboardManager::class.java)
        return clipboard.primaryClip?.getItemAt(0)?.text?.toString()
    }

    @Test fun longPressOnTheNoteOffersCopy() {
        show()
        compose.onNode(hasText(note)).performTouchInput { longClick() }
        compose.waitForIdle()
        assertNotNull("a long press on the note shows no Copy", menu.item(TextContextMenuKeys.CopyKey))
        menu.tap(TextContextMenuKeys.SelectAllKey)
        compose.waitForIdle()
        menu.tap(TextContextMenuKeys.CopyKey)
        compose.waitForIdle()
        assertEquals(note, clipboardText())
    }

    @Test fun copyNoteTakesTheWholeNoteAndSaysSo() {
        show()
        compose.onNodeWithTag(TaskDetailTags.NOTE_COPY).performScrollTo().assertTextEquals("Copy note").performClick()
        compose.waitForIdle()
        assertEquals(note, clipboardText())
        compose.onNodeWithTag(TaskDetailTags.NOTE_COPY).assertTextEquals("Note copied")
    }

    /** Stands in for the phone's floating text toolbar and keeps what it was asked to show. */
    private class RecordingMenu : TextContextMenuProvider {
        private var shown: TextContextMenuDataProvider? = null

        override suspend fun showTextContextMenu(dataProvider: TextContextMenuDataProvider) {
            shown = dataProvider
            try {
                awaitCancellation()
            } finally {
                shown = null
            }
        }

        fun item(key: Any): TextContextMenuItem? =
            shown?.data()?.components?.filterIsInstance<TextContextMenuItem>()?.firstOrNull { it.key == key }

        fun tap(key: Any) = checkNotNull(item(key)) { "the menu has no $key" }.onClick(Session)

        private object Session : TextContextMenuSession {
            override fun close() = Unit
        }
    }

    /** Robolectric gives the selection magnifier no surface, so dismissing it would crash; the test does not need it. */
    @Implements(Magnifier::class)
    class SilentMagnifier {
        @Implementation fun show(sourceCenterX: Float, sourceCenterY: Float) = Unit
        @Implementation fun show(sourceCenterX: Float, sourceCenterY: Float, magnifierCenterX: Float, magnifierCenterY: Float) = Unit
        @Implementation fun update() = Unit
        @Implementation fun dismiss() = Unit
    }
}
