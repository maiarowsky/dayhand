package dev.helm.planner.ui

import android.accessibilityservice.AccessibilityServiceInfo
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.HelmApplication
import dev.helm.planner.MainActivity
import dev.helm.planner.R
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.ui.calendar.CalendarTags
import dev.helm.planner.ui.settings.SettingsTags
import dev.helm.planner.ui.task.EditorTags
import dev.helm.planner.ui.task.TaskDetailTags
import dev.helm.planner.ui.theme.Appearance
import dev.helm.planner.ui.theme.ThemeMode
import dev.helm.planner.ui.today.QuickAddTags
import dev.helm.planner.ui.today.TodayTags
import dev.helm.planner.tour.TourConfig
import dev.helm.planner.tour.shoot
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.runner.RunWith

/** Opt-in acceptance path through MainActivity, its real view models and on-disk Room database. */
@RunWith(AndroidJUnit4::class)
class PlannerAppFlowTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as HelmApplication).container
    private val today = LocalDate.now()
    private val week = today.minusDays(today.dayOfWeek.value.toLong() - 1)
    private val config = TourConfig.fromArguments()
    private val prefix = "sample-planner-proof-"

    @get:Rule(order = 0)
    val localPlan = object : ExternalResource() {
        override fun before() = runBlocking {
            assumeTrue(InstrumentationRegistry.getArguments().getString("plannerLocalProof") == "true")
            check(container.settings.current().isLocal) { "This proof requires an unpaired test installation" }
            val arguments = InstrumentationRegistry.getArguments()
            if (arguments.getString("plannerVerifyRestart") == "true" || arguments.getString("plannerSettingsProof") == "true") return@runBlocking
            container.settings.setConnectPromptDone()
            container.appearance.save(Appearance(mode = if (config.dark) ThemeMode.Dark else ThemeMode.Light))
            val fixtures = (0L..6L).flatMap { offset ->
                val date = week.plusDays(offset).toString()
                listOf(
                    fixture("plan-$offset", "Weekly planning", date, "09:00", if (date < today.toString()) TaskStatus.DONE else TaskStatus.TODO),
                    fixture("review-$offset", "Design review", date, "10:00", if (date < today.toString()) TaskStatus.DONE else TaskStatus.DOING),
                )
            } + listOf(
                fixture("untimed", "Book the studio", today.toString()),
                fixture("overlap", "Review a very long proposal with the whole design team", today.toString(), "10:15"),
                fixture("late", "Return the library books", today.minusDays(1).toString()),
                fixture("undated", "Ideas for next month", null),
                fixture("repeat", "Stretch break", today.toString(), "12:00").copy(repeat = RepeatRule(RepeatEvery.DAY)),
            )
            container.database.tasks().upsert(fixtures)
        }
    }

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    private fun fixture(id: String, title: String, date: String?, time: String? = null, status: TaskStatus = TaskStatus.TODO) =
        Task(localId = prefix + id, title = title, dueDate = date, dueTime = time, status = status, createdAt = 0, updatedAt = 0)

    private fun task(id: String) = runBlocking { container.database.tasks().byLocalId(id)!! }
    private fun waitForTask(id: String, predicate: (Task) -> Boolean) = compose.waitUntil(5_000) { predicate(task(id)) }
    private fun tab(text: String) = compose.onNode(hasText(text) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)).performClick()
    private fun shot(name: String) {
        compose.waitForIdle()
        shoot(compose.activity, config, name)
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val info = checkNotNull(automation.serviceInfo)
        val previousFlags = info.flags
        try {
            info.flags = previousFlags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            automation.serviceInfo = info
            val roots = automation.windows.mapNotNull { it.root } + listOfNotNull(automation.rootInActiveWindow)
            check(roots.isNotEmpty()) { "Cannot inspect visible windows at $name" }
            // This opt-in flow uses the English test profile; inspect system windows as well as the app.
            val anrVisible = roots.any { root ->
                listOf("isn't responding", "isn’t responding", "not responding").any { text ->
                    root.findAccessibilityNodeInfosByText(text).any { it.isVisibleToUser }
                }
            }
            assertTrue("Visible ANR dialog at $name; screenshot retained", !anrVisible)
        } finally {
            info.flags = previousFlags
            automation.serviceInfo = info
        }
    }

    @Test
    fun localServerValueIsReadableInSettings() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("plannerSettingsProof") == "true")
        compose.onNodeWithContentDescription(context.getString(R.string.open_settings)).performClick()
        assertEquals("Server", context.getString(R.string.settings_backend))
        assertEquals("On this phone only", context.getString(R.string.local_title))
        assertSettingsRow(SettingsTags.LANGUAGE_ROW, "Language", "Phone language", "11-settings-language")
        assertSettingsRow(SettingsTags.ROW_NOTIFICATIONS, "Notifications and alarms", "Off", "12-settings-notifications")
        assertSettingsRow(SettingsTags.ROW_SUMMARY, "Morning summary", "05:00", "13-settings-summary")
        assertSettingsRow(SettingsTags.ROW_REMINDERS, "Default reminders", "At the due time", "14-settings-reminders")
        assertSettingsRow(SettingsTags.ROW_SERVER, "Server", "On this phone only", "10-settings-server")
    }

    private fun assertSettingsRow(tag: String, expectedTitle: String, expectedValue: String, checkpoint: String) {
        compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
        shot(checkpoint)
        val titleMatcher = hasText(expectedTitle) and hasAnyAncestor(hasTestTag(tag))
        val valueMatcher = hasTestTag("$tag-value")
        val title = compose.onNode(titleMatcher, useUnmergedTree = true)
        val value = compose.onNode(valueMatcher, useUnmergedTree = true)
        // Record both concrete Text results before either readability assertion can fail.
        val proofs = listOf(textLayoutProof(expectedTitle, titleMatcher), textLayoutProof(expectedValue, valueMatcher))
        val directory = File(compose.activity.getExternalFilesDir(null), "tour/${config.variant}").apply { mkdirs() }
        val safeBounds = safeWindowBounds()
        File(directory, "$checkpoint-layout.txt").writeText("safeWindowBounds=$safeBounds\n" + proofs.joinToString("\n\n") { it.second })
        title.assertIsDisplayed().assertTextEquals(expectedTitle)
        value.assertIsDisplayed().assertTextEquals(expectedValue)
        val titleBounds = title.fetchSemanticsNode().boundsInRoot
        val valueBounds = value.fetchSemanticsNode().boundsInRoot
        if (tag == SettingsTags.ROW_SERVER) {
            assertTrue("Server label and value need visible separation", valueBounds.top > titleBounds.bottom)
        } else {
            assertTrue("$expectedTitle and value need visible separation",
                valueBounds.top > titleBounds.bottom || valueBounds.left > titleBounds.right)
        }
        assertReadableText(title, expectedTitle, proofs[0])
        assertReadableText(value, expectedValue, proofs[1])
        for (text in listOf(title, value)) {
            val bounds = text.fetchSemanticsNode().boundsInWindow
            assertTrue("$expectedTitle: text $bounds must stay inside system-safe window $safeBounds",
                bounds.left >= safeBounds.left && bounds.right <= safeBounds.right &&
                    bounds.top >= safeBounds.top && bounds.bottom <= safeBounds.bottom)
        }
    }

    private fun safeWindowBounds(): Rect = compose.runOnUiThread {
        val decor = compose.activity.window.decorView
        val insets = checkNotNull(ViewCompat.getRootWindowInsets(decor))
            .getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        Rect(insets.left.toFloat(), insets.top.toFloat(),
            (decor.width - insets.right).toFloat(), (decor.height - insets.bottom).toFloat())
    }

    private fun assertReadableText(interaction: SemanticsNodeInteraction, expected: String, proof: Pair<List<TextLayoutResult>, String>) {
        val (layouts, details) = proof
        val message = "The whole text must remain readable: $expected\n$details"
        val node = interaction.fetchSemanticsNode()
        assertEquals(message, listOf(expected), node.config[SemanticsProperties.Text].map { it.text })
        assertTrue(message, node.children.isEmpty() && !node.config.isMergingSemanticsOfDescendants)
        assertTrue(message, layouts.isNotEmpty())
        val origin = node.positionInRoot
        val bounds = node.boundsInRoot
        // GetTextLayoutResult reconstructs a wider MultiParagraph for simple Text. Check the
        // complete lines against the actual clipped Text bounds instead of its paragraph width.
        for (layout in layouts) {
            assertEquals(message, expected, layout.layoutInput.text.text)
            assertEquals(message, node.size, layout.size)
            assertTrue(message, layout.lineCount > 0 && !layout.multiParagraph.didExceedMaxLines)
            var nextOffset = 0
            repeat(layout.lineCount) { line ->
                val start = layout.getLineStart(line)
                val end = layout.getLineEnd(line, visibleEnd = false)
                assertEquals(message, nextOffset, start)
                assertTrue(message, end > start && end <= expected.length && !layout.isLineEllipsized(line))
                nextOffset = end
                val left = origin.x + layout.getLineLeft(line)
                val right = origin.x + layout.getLineRight(line)
                val top = origin.y + layout.getLineTop(line)
                val bottom = origin.y + layout.getLineBottom(line)
                assertTrue("$message\nline[$line] in root=($left,$top)-($right,$bottom); bounds=$bounds",
                    left >= bounds.left && right <= bounds.right && right >= left &&
                        top >= bounds.top && bottom <= bounds.bottom && bottom > top)
            }
            assertEquals(message, expected.length, nextOffset)
        }
    }

    private fun textLayoutProof(expected: String, matcher: SemanticsMatcher): Pair<List<TextLayoutResult>, String> {
        val matches = compose.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes()
        val layouts = mutableListOf<TextLayoutResult>()
        var actionResult: Boolean? = null
        if (matches.size == 1) {
            compose.onNode(matcher, useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { actionResult = it(layouts) }
        }
        val details = buildString {
            appendLine("expected=$expected; useUnmergedTree=true; matches=${matches.size}")
            matches.forEach { node ->
                appendLine("node=${node.id}; text=${node.config.getOrNull(SemanticsProperties.Text)}; tag=${node.config.getOrNull(SemanticsProperties.TestTag)}")
                appendLine("origin=${node.positionInRoot}; bounds=${node.boundsInRoot}; windowBounds=${node.boundsInWindow}; size=${node.size}; mergesDescendants=${node.config.isMergingSemanticsOfDescendants}; children=${node.children.map { it.id }}; parent=${node.parent?.id}")
            }
            appendLine("actionResult=$actionResult; layouts=${layouts.size}")
            layouts.forEachIndexed { index, layout ->
                appendLine("layout[$index].text=${layout.layoutInput.text.text}")
                appendLine("constraints=${layout.layoutInput.constraints}; size=${layout.size}; lineCount=${layout.lineCount}")
                appendLine("didOverflowWidth=${layout.didOverflowWidth}; didOverflowHeight=${layout.didOverflowHeight}; hasVisualOverflow=${layout.hasVisualOverflow}")
                appendLine("paragraphWidth=${layout.multiParagraph.width}; paragraphHeight=${layout.multiParagraph.height}; didExceedMaxLines=${layout.multiParagraph.didExceedMaxLines}")
                appendLine("fontSize=${layout.layoutInput.style.fontSize}; lineHeight=${layout.layoutInput.style.lineHeight}; density=${layout.layoutInput.density}; overflow=${layout.layoutInput.overflow}")
                repeat(layout.lineCount) { line ->
                    appendLine("line[$line]: start=${layout.getLineStart(line)}; end=${layout.getLineEnd(line)}; ellipsized=${layout.isLineEllipsized(line)}; left=${layout.getLineLeft(line)}; right=${layout.getLineRight(line)}; top=${layout.getLineTop(line)}; bottom=${layout.getLineBottom(line)}")
                }
            }
        }
        return layouts.toList() to details
    }

    @Test
    fun calendarAndTaskChangesSurviveViewChangesAndRecreation() {
        shot("01-today")
        tab("Calendar")
        compose.onNodeWithTag(CalendarTags.TODAY).performClick()
        compose.onNodeWithTag(CalendarTags.MODE_WEEK).performClick()
        compose.onNodeWithTag(CalendarTags.NEXT).performClick()
        compose.onNodeWithTag(CalendarTags.dayHeader(week.plusDays(7).toString())).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.PREVIOUS).performClick()
        compose.onNodeWithTag(CalendarTags.PREVIOUS).performClick()
        compose.onNodeWithTag(CalendarTags.TODAY).performClick()
        compose.onNodeWithTag(CalendarTags.dayHeader(week.plusDays(6).toString())).assertIsDisplayed()
        compose.onNodeWithTag(CalendarTags.entry("${prefix}plan-${today.dayOfWeek.value - 1}@$today")).performScrollTo()
        shot("02-week")
        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        compose.onNodeWithTag(CalendarTags.entry("${prefix}untimed@$today")).performScrollTo().assertIsDisplayed()
        shot("03-day")
        compose.onNodeWithTag(CalendarTags.entry("${prefix}review-${today.dayOfWeek.value - 1}@$today")).performScrollTo()
        val morning = compose.onNodeWithTag(CalendarTags.entry("${prefix}plan-${today.dayOfWeek.value - 1}@$today")).fetchSemanticsNode().boundsInRoot
        val viewport = compose.onNodeWithTag(CalendarTags.DAY).fetchSemanticsNode().boundsInRoot
        val inset = 16 * context.resources.displayMetrics.density
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange) and hasAnyAncestor(hasTestTag(CalendarTags.DAY)))
            .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, morning.top - viewport.top - inset) }
        shot("03b-day-hours")

        // The same real task moves to Saturday through the calendar sheet, then Undo restores its day.
        compose.onNodeWithTag(CalendarTags.entry("${prefix}untimed@$today")).performScrollTo().performTouchInput { longClick() }
        val saturday = week.plusDays(5).toString()
        compose.onNodeWithTag(CalendarTags.moveDay(saturday)).performClick()
        compose.onNodeWithTag(CalendarTags.MOVE_CONFIRM).performClick()
        waitForTask(prefix + "untimed") { it.dueDate == saturday && it.dueTime == null }
        compose.onNode(hasText(context.getString(R.string.calendar_undo)) and hasClickAction()).performClick()
        waitForTask(prefix + "untimed") { it.dueDate == today.toString() }

        tab("Today")
        compose.onNodeWithTag(TodayTags.FAB).performClick()
        val title = "Studio rehearsal ${config.variant}"
        compose.onNodeWithTag(QuickAddTags.TITLE).performTextReplacement(title)
        compose.onNodeWithTag(QuickAddTags.SAVE).performScrollTo().clickWhenStable(compose)
        compose.waitUntil(5_000) { runBlocking { container.database.tasks().all().any { it.title == title } } }
        val created = runBlocking { container.database.tasks().all().single { it.title == title } }
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasTestTag(TodayTags.row(created.localId)))
        compose.onNodeWithTag(TodayTags.row(created.localId)).performClick()
        compose.onNodeWithTag(TaskDetailTags.TITLE).performClick()
        compose.onNodeWithTag(EditorTags.FIELD).performTextReplacement("$title edited")
        compose.onNodeWithTag(EditorTags.SAVE).performClick()
        waitForTask(created.localId) { it.title == "$title edited" }
        shot("04-details")
        compose.onNodeWithTag(TaskDetailTags.STATUS).performClick()
        compose.onNodeWithTag(TaskDetailTags.status(TaskStatus.DONE)).performClick()
        waitForTask(created.localId) { it.status == TaskStatus.DONE }
        compose.onNodeWithTag("back").performClick()
        tab("Board")
        shot("05-board")
        tab("Projects")
        shot("06-projects")
        tab("Today")
        compose.onNodeWithContentDescription(context.getString(R.string.open_settings)).performClick()
        shot("07-settings")
        compose.onNodeWithTag("back").performClick()
        tab("Calendar")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag(CalendarTags.SCREEN).assertIsDisplayed()
        assertEquals("$title edited", task(created.localId).title)
        assertEquals(TaskStatus.DONE, task(created.localId).status)
        assertEquals(today.toString(), task(prefix + "untimed").dueDate)
        assertTrue(task(prefix + "undated").dueDate == null)
        shot("08-recreated")
    }

    /** Invoked in a separate instrumentation run after am force-stop, without reseeding the database. */
    @Test
    fun reopenSavedTaskAfterProcessRestart() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("plannerVerifyRestart") == "true")
        val title = "Studio rehearsal ${config.variant} edited"
        val saved = runBlocking { container.database.tasks().all().single { it.title == title } }
        assertEquals(TaskStatus.DONE, saved.status)
        assertEquals(today.toString(), task(prefix + "untimed").dueDate)
        tab("Calendar")
        compose.onNodeWithTag(CalendarTags.MODE_DAY).performClick()
        compose.onNodeWithTag(CalendarTags.entry("${saved.localId}@$today")).performScrollTo().performClick()
        compose.onNodeWithTag(TaskDetailTags.TITLE).assertIsDisplayed()
        shot("09-process-restart")
    }
}
