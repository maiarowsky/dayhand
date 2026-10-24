package dev.helm.planner.agents

import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.SendResult
import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** Where an approval request is (docs/agent-work.md#5-approval-requests). */
enum class ApprovalStatus(val wire: String) {
    PENDING("pending"),
    DECIDED("decided"),
    EXPIRED("expired"),
    ;

    companion object {
        fun of(wire: String?): ApprovalStatus? = entries.firstOrNull { it.wire == wire }
    }
}

data class ApprovalOption(val id: String, val label: String, val consequence: String?)

data class ApprovalDecision(val optionId: String, val label: String, val note: String?, val decidedAt: Long)

/** A question an agent asked the owner (`app:listApprovals`). Dayhand records the answer; it does not act on it. */
data class ApprovalRequest(
    val id: String,
    val taskRef: Long?,
    val taskTitle: String?,
    val action: String,
    val detail: String?,
    val options: List<ApprovalOption>,
    val reversible: Boolean,
    val status: ApprovalStatus,
    val expiresAt: Long,
    val createdAt: Long,
    /** The API key or agent connection that asked. */
    val requestedBy: String,
    /** The tool an agent key's "ask" policy held back; null for a question the agent asked itself. */
    val policyTool: String?,
    val decision: ApprovalDecision?,
)

data class ToolPolicy(val keyName: String, val tool: String, val rule: String)

/** The switch that pauses every agent, and the rules per agent key (`app:getAgentControls`). */
data class AgentControls(val paused: Boolean, val pausedAt: Long?, val reason: String?, val policies: List<ToolPolicy>)

/** A task an agent or a person proposed, waiting in the inbox out of Today (`app:listProposals`). */
data class Proposal(
    val id: String,
    val ref: Long?,
    val title: String,
    val note: String?,
    val requestedBy: String?,
    val sourceKind: String?,
    val sourceRef: String?,
    val sourceUrl: String?,
    val proposedAt: Long,
)

/** The counts of the plan health report (`app:planHealth`); the phone shows them as a card above Today. */
data class PlanHealth(
    val agentsPaused: Boolean,
    val overdue: Int,
    val dueToday: Int,
    val inProgress: Int,
    val expiredClaims: Int,
    val blocked: Int,
    val awaitingApproval: Int,
    val pendingApprovals: Int,
    val proposals: Int,
    val completedToday: Int,
    val withoutProof: Int,
    val oldestOpenDays: Int?,
)

sealed interface Load<out T> {
    data class Loaded<T>(val value: T) : Load<T>
    data object Unauthorized : Load<Nothing>
    data class Failed(val message: String) : Load<Nothing>
}

/** What became of a change the owner made. */
sealed interface Change {
    data object Done : Change

    /** The server refused it for good: decided elsewhere, expired, the task gone. */
    data class Refused(val message: String) : Change
    data object Unauthorized : Change
    data class Failed(val message: String) : Change
}

/** The app layer's answers about agents, read without trusting their shape. */
object AgentControlJson {
    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
        ?: (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.toLong()
    private fun JsonObject.bool(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false
    private fun JsonObject.count(key: String): Int = ((this[key] as? JsonObject)?.long("count") ?: 0).toInt()

    private fun option(value: JsonElement): ApprovalOption? {
        val o = value as? JsonObject ?: return null
        return ApprovalOption(o.string("id") ?: return null, o.string("label") ?: return null, o.string("consequence"))
    }

    private fun decision(value: JsonElement?): ApprovalDecision? {
        val o = value as? JsonObject ?: return null
        val optionId = o.string("optionId") ?: return null
        return ApprovalDecision(optionId, o.string("label") ?: optionId, o.string("note"), o.long("decidedAt") ?: 0)
    }

    fun approval(value: JsonElement): ApprovalRequest? {
        val o = value as? JsonObject ?: return null
        val options = (o["options"] as? JsonArray).orEmpty().mapNotNull(::option)
        if (options.isEmpty()) return null
        return ApprovalRequest(
            id = o.string("id") ?: return null,
            taskRef = o.long("ref"),
            taskTitle = o.string("taskTitle"),
            action = o.string("action") ?: return null,
            detail = o.string("detail"),
            options = options,
            reversible = o.bool("reversible"),
            status = ApprovalStatus.of(o.string("status")) ?: return null,
            expiresAt = o.long("expiresAt") ?: 0,
            createdAt = o.long("createdAt") ?: 0,
            requestedBy = (o["requestedBy"] as? JsonObject)?.string("name").orEmpty(),
            policyTool = o.string("tool").takeIf { o.string("source") == "policy" },
            decision = decision(o["decision"]),
        )
    }

    /** `{approvals: [...]}`; null when the answer has another shape. */
    fun approvals(value: JsonElement): List<ApprovalRequest>? =
        ((value as? JsonObject)?.get("approvals") as? JsonArray)?.mapNotNull(::approval)

    fun controls(value: JsonElement): AgentControls? {
        val o = value as? JsonObject ?: return null
        val policies = (o["policies"] as? JsonArray).orEmpty().mapNotNull { item ->
            val p = item as? JsonObject ?: return@mapNotNull null
            ToolPolicy(p.string("keyName") ?: return@mapNotNull null, p.string("tool") ?: return@mapNotNull null, p.string("rule") ?: return@mapNotNull null)
        }
        return AgentControls(o.bool("paused"), o.long("pausedAt"), o.string("reason"), policies)
    }

    fun proposals(value: JsonElement): List<Proposal>? = (value as? JsonArray)?.mapNotNull { item ->
        val o = item as? JsonObject ?: return@mapNotNull null
        val source = o["source"] as? JsonObject
        Proposal(
            id = o.string("id") ?: return@mapNotNull null,
            ref = o.long("ref"),
            title = o.string("title") ?: return@mapNotNull null,
            note = o.string("note"),
            requestedBy = o.string("requestedBy"),
            sourceKind = source?.string("kind"),
            sourceRef = source?.string("ref"),
            sourceUrl = source?.string("url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
            proposedAt = o.long("proposedAt") ?: return@mapNotNull null,
        )
    }

    fun health(value: JsonElement): PlanHealth? {
        val o = value as? JsonObject ?: return null
        if (o["overdue"] !is JsonObject) return null
        val approvals = o["awaitingApproval"] as? JsonObject
        val done = o["completedToday"] as? JsonObject
        return PlanHealth(
            agentsPaused = o.bool("agentsPaused"),
            overdue = o.count("overdue"),
            dueToday = o.count("dueToday"),
            inProgress = o.count("inProgress"),
            expiredClaims = o.count("expiredClaims"),
            blocked = o.count("blocked"),
            awaitingApproval = o.count("awaitingApproval"),
            pendingApprovals = (approvals?.long("pendingApprovals") ?: 0).toInt(),
            proposals = o.count("proposals"),
            completedToday = o.count("completedToday"),
            withoutProof = (done?.long("withoutProof") ?: 0).toInt(),
            oldestOpenDays = (o["oldestOpen"] as? JsonObject)?.long("ageDays")?.toInt(),
        )
    }
}

/**
 * The owner's side of agent work through the app layer, signed in as the paired owner: approval requests, the
 * agent switch and the tool policies, the proposal inbox and the plan health report (docs/agent-work.md).
 */
class AgentControlApi(
    private val queries: QueryRunner,
    private val mutations: MutationSender,
    private val newClientId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun approvals(status: ApprovalStatus? = null): Load<List<ApprovalRequest>> =
        read(LIST_APPROVALS, buildJsonObject { status?.let { put("status", it.wire) } }, AgentControlJson::approvals)

    suspend fun decide(approvalId: String, optionId: String, note: String?): Change = change(DECIDE_APPROVAL, buildJsonObject {
        put("approvalId", approvalId)
        put("optionId", optionId)
        note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
    })

    suspend fun controls(): Load<AgentControls> = read(GET_CONTROLS, JsonObject(emptyMap()), AgentControlJson::controls)

    suspend fun pause(paused: Boolean): Change = change(PAUSE, buildJsonObject { put("paused", paused) })

    suspend fun proposals(): Load<List<Proposal>> = read(LIST_PROPOSALS, JsonObject(emptyMap()), AgentControlJson::proposals)

    suspend fun accept(taskId: String): Change = change(ACCEPT, buildJsonObject {
        put("taskId", taskId)
        put("clientId", newClientId())
    })

    suspend fun merge(taskId: String, intoTaskId: String): Change = change(MERGE, buildJsonObject {
        put("taskId", taskId)
        put("intoTaskId", intoTaskId)
        put("clientId", newClientId())
    })

    suspend fun reject(taskId: String, reason: String?): Change = change(REJECT, buildJsonObject {
        put("taskId", taskId)
        reason?.trim()?.takeIf { it.isNotEmpty() }?.let { put("reason", it) }
        put("clientId", newClientId())
    })

    suspend fun health(at: Long): Load<PlanHealth> = read(HEALTH, buildJsonObject { put("at", at) }, AgentControlJson::health)

    private suspend fun <T> read(path: String, args: JsonObject, parse: (JsonElement) -> T?): Load<T> =
        when (val result = queries.query(path, args)) {
            is SendResult.Applied -> parse(result.value)?.let { Load.Loaded(it) } ?: Load.Failed("unexpected answer")
            SendResult.Unauthorized -> Load.Unauthorized
            is SendResult.Rejected -> Load.Failed(result.message)
            is SendResult.Failed -> Load.Failed(result.message)
        }

    private suspend fun change(path: String, args: JsonObject): Change = when (val result = mutations.send(path, args)) {
        is SendResult.Applied -> Change.Done
        SendResult.Unauthorized -> Change.Unauthorized
        is SendResult.Rejected -> Change.Refused(result.message)
        is SendResult.Failed -> Change.Failed(result.message)
    }

    companion object {
        const val LIST_APPROVALS = "app:listApprovals"
        const val DECIDE_APPROVAL = "app:decideApproval"
        const val GET_CONTROLS = "app:getAgentControls"
        const val PAUSE = "app:pauseAgents"
        const val LIST_PROPOSALS = "app:listProposals"
        const val ACCEPT = "app:acceptProposal"
        const val MERGE = "app:mergeProposal"
        const val REJECT = "app:rejectProposal"
        const val HEALTH = "app:planHealth"
    }
}
