package dev.helm.planner.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.performClick

/** Observe a visible, enabled target at the same position repeatedly before issuing the physical tap. */
internal fun SemanticsNodeInteraction.clickWhenStable(compose: ComposeTestRule) {
    var previous: Rect? = null
    var unchanged = 0
    compose.waitUntil(5_000) {
        runCatching {
            assertIsDisplayed().assertIsEnabled()
            val bounds = fetchSemanticsNode().boundsInWindow
            unchanged = if (bounds == previous) unchanged + 1 else 0
            previous = bounds
            unchanged >= 2
        }.getOrDefault(false)
    }
    performClick()
}
