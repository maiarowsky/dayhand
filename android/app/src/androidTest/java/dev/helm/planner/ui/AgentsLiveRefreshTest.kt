package dev.helm.planner.ui

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.MainActivity
import dev.helm.planner.agents.PolicyRule
import dev.helm.planner.ui.agents.AgentsPage
import dev.helm.planner.ui.agents.AgentsTags
import dev.helm.planner.ui.agents.AgentsViewModel
import dev.helm.planner.ui.agents.Section
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in live checks, launched by scripts/e2e-agents-refresh.py on a disposable paired emulator.
 * MainActivity, its actual ViewModel, HTTP transport, pairing and backend are all real. The external
 * proxy only delays genuine answers or injects a transport failure; it never fabricates controls.
 */
@RunWith(AndroidJUnit4::class)
class AgentsLiveRefreshTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private lateinit var proxyUrl: String
    private lateinit var keyName: String
    private lateinit var vm: AgentsViewModel
    private val policyTitle get() = "Key $keyName: complete_task"

    @Before
    fun openPairedAgents() {
        val url = InstrumentationRegistry.getArguments().getString("liveProxyUrl")
        assumeTrue("Run with e2e-agents-refresh.py and a disposable paired backend", !url.isNullOrBlank())
        proxyUrl = url!!
        keyName = control("reset")["keyName"]!!.jsonPrimitive.content
        compose.runOnUiThread {
            compose.activity.startActivity(
                Intent(compose.activity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_AGENTS),
            )
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag(AgentsTags.PAUSE).fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { vm = ViewModelProvider(compose.activity)[AgentsViewModel::class.java] }
        awaitReady(PolicyRule.ASK)
    }

    @Test
    fun policyDenyThenAllowIsSerializedThroughRefresh() {
        openRule()
        arm("deny-refresh", "app:listApprovals")
        choose(PolicyRule.DENY)
        awaitHold("deny-refresh")
        assertTrue("Save remains busy while approvals/proposals refresh", vm.ui.value.busy)
        openRule()
        compose.onNodeWithTag(AgentsTags.RULE + "allow").assertIsNotEnabled().performTouchInput { click() }
        assertEquals("Disabled tap must not send an Allow mutation", 1, mutations("app:setToolPolicy"))
        shot("policy-disabled-until-refresh")
        release("deny-refresh")
        awaitReady(PolicyRule.DENY)
        compose.onNodeWithTag(AgentsTags.RULE + "deny").assertIsSelected()
        compose.onNodeWithTag(AgentsTags.RULE + "allow").assertIsEnabled().performClick()
        awaitReady(PolicyRule.ALLOW)
        assertServer(rule = PolicyRule.ALLOW, paused = false)
        shot("policy-allow-list")
        openRule()
        compose.onNodeWithTag(AgentsTags.RULE + "allow").assertIsSelected()
        shot("policy-allow-selected")
        println("LIVE: Ask -> Deny; immediate Allow blocked until refresh; retry Allow selected and server=allow")
    }

    @Test
    fun stalePolicyReloadCannotReplaceNewerAllow() {
        openRule()
        choose(PolicyRule.DENY)
        awaitReady(PolicyRule.DENY)
        arm("old-deny", "app:getAgentControls")
        // reload() is the route's public refresh interface. Inject overlap without replacing its API or state.
        compose.runOnIdle { vm.reload() }
        awaitHold("old-deny")
        openRule()
        choose(PolicyRule.ALLOW)
        awaitReady(PolicyRule.ALLOW)
        val proposalsBefore = calls("app:listProposals")
        release("old-deny")
        awaitOldRefresh(proposalsBefore)
        assertServer(rule = PolicyRule.ALLOW, paused = false)
        openRule()
        shot("stale-deny-response-does-not-replace-allow")
        assertEquals(PolicyRule.ALLOW, shownRule())
        compose.onNodeWithTag(AgentsTags.RULE + "allow").assertIsSelected()
        println("LIVE: delayed real Deny controls delivered after Allow refresh; page and server remain Allow")
    }

    @Test
    fun pauseIgnoresOldReadsDuringMutationAndAfterResume() {
        arm("old-running", "app:getAgentControls")
        compose.runOnIdle { vm.reload() }
        awaitHold("old-running")
        arm("pause-send", "app:pauseAgents", phase = "request")
        compose.onNodeWithTag(AgentsTags.PAUSE).performClick()
        awaitHold("pause-send")
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOn().assertIsNotEnabled()
        val proposalsBefore = calls("app:listProposals")
        release("old-running")
        awaitOldRefresh(proposalsBefore)
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOn().assertIsNotEnabled()
        release("pause-send")
        compose.waitUntil(10_000) { !vm.ui.value.busy }
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOn().assertIsEnabled()
        assertServer(rule = PolicyRule.ASK, paused = true)
        shot("pause-on-after-old-running-response")

        arm("old-paused", "app:getAgentControls")
        compose.runOnIdle { vm.reload() }
        awaitHold("old-paused")
        arm("resume-refresh", "app:listApprovals")
        compose.onNodeWithTag(AgentsTags.PAUSE).performClick()
        awaitHold("resume-refresh")
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOff().assertIsNotEnabled().performTouchInput { click() }
        assertEquals("Disabled second flip must not mutate", 2, mutations("app:pauseAgents"))
        release("resume-refresh")
        compose.waitUntil(10_000) { !vm.ui.value.busy }
        val beforeOldResume = calls("app:listProposals")
        release("old-paused")
        awaitOldRefresh(beforeOldResume)
        compose.onNodeWithTag(AgentsTags.PAUSE).assertIsOff().assertIsEnabled()
        assertServer(rule = PolicyRule.ASK, paused = false)
        shot("pause-off-after-old-paused-response")
        println("LIVE: old running response cannot undo optimistic pause; old paused response cannot undo completed resume")
    }

    @Test
    fun failedPolicySendCanBeRetriedWithoutStickingBusy() {
        openRule()
        arm("unavailable", "app:setToolPolicy", status = 503)
        choose(PolicyRule.DENY)
        compose.waitUntil(10_000) { !vm.ui.value.busy && vm.ui.value.message != null }
        assertTrue(vm.ui.value.page is AgentsPage.Policy)
        compose.onNodeWithText("No connection to the server. Try again.").performScrollTo()
        compose.onNodeWithTag(AgentsTags.RULE + "ask").assertIsSelected()
        compose.onNodeWithTag(AgentsTags.RULE + "deny").assertIsEnabled()
        assertServer(rule = PolicyRule.ASK, paused = false)
        shot("policy-send-failed-retry-enabled")
        choose(PolicyRule.DENY)
        awaitReady(PolicyRule.DENY)
        assertFalse(vm.ui.value.busy)
        assertServer(rule = PolicyRule.DENY, paused = false)
        openRule()
        compose.onNodeWithTag(AgentsTags.RULE + "deny").assertIsSelected()
        shot("policy-retry-saved-deny")
        println("LIVE: HTTP 503 retains Ask on policy page, clears busy, and retry saves Deny to real server")
    }

    private fun openRule() {
        compose.onNodeWithText(policyTitle).performScrollTo().performClick()
        compose.onNodeWithTag(AgentsTags.POLICY_PAGE).assertExists()
    }

    private fun choose(rule: PolicyRule) = compose.onNodeWithTag(AgentsTags.RULE + rule.wire).performScrollTo().performClick()

    private fun shownRule() = (vm.ui.value.controls as? Section.Loaded)?.value?.policies
        ?.singleOrNull { it.keyName == keyName && it.tool == "complete_task" }?.rule

    private fun awaitReady(rule: PolicyRule) = compose.waitUntil(10_000) { !vm.ui.value.busy && shownRule() == rule }

    private fun arm(id: String, path: String, phase: String = "response", status: Int? = null) {
        val fields = mutableMapOf("id" to JsonPrimitive(id), "path" to JsonPrimitive(path), "phase" to JsonPrimitive(phase))
        status?.let { fields["status"] = JsonPrimitive(it) }
        control("arm", JsonObject(fields))
    }

    private fun release(id: String) { control("release", JsonObject(mapOf("id" to JsonPrimitive(id)))) }

    private fun awaitHold(id: String) = compose.waitUntil(5_000) {
        control("state")["holds"]!!.jsonObject[id]?.jsonObject?.get("waiting")?.jsonPrimitive?.boolean == true
    }

    private fun calls(path: String): Int = (control("state")["calls"] as JsonArray)
        .count { it.jsonObject["path"]!!.jsonPrimitive.content == path }

    private fun mutations(path: String) = calls(path)

    private fun awaitOldRefresh(before: Int) {
        compose.waitUntil(5_000) { calls("app:listProposals") > before }
        // The proxy has delivered the final section; allow the real HTTP coroutine to publish on Main.
        Thread.sleep(300)
        compose.waitForIdle()
    }

    private fun assertServer(rule: PolicyRule, paused: Boolean) {
        val controls = control("controls")
        assertEquals(paused, controls["paused"]!!.jsonPrimitive.boolean)
        val policy = (controls["policies"] as JsonArray).single {
            it.jsonObject["keyName"]!!.jsonPrimitive.content == keyName &&
                it.jsonObject["tool"]!!.jsonPrimitive.content == "complete_task"
        }
        assertEquals(rule.wire, policy.jsonObject["rule"]!!.jsonPrimitive.content)
        println("REAL SERVER: ${rule.wire}, paused=$paused")
    }

    private fun control(path: String, data: JsonObject = JsonObject(emptyMap())): JsonObject {
        val connection = URL("$proxyUrl/_test/$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(data.toString().toByteArray()) }
            Json.parseToJsonElement(connection.inputStream.bufferedReader().use { it.readText() }).jsonObject
        } finally {
            connection.disconnect()
        }
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = instrumentation.targetContext.filesDir.resolve("live-evidence").apply { mkdirs() }
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        directory.resolve("$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        println("SCREENSHOT: $name.png")
    }
}
