// Argument validators of every domain operation, shared by the internal
// domain functions, the app layer and the MCP tool schemas.
import { v } from "convex/values";
import {
  acceptanceInputValidator,
  approvalOptionInputValidator,
  checklistInputValidator,
  clearable,
  keyKindValidator,
  keyScopeValidator,
  linkValidator,
  policyRuleValidator,
  proofValidator,
  reminderValidator,
  repeatInputValidator,
  statusValidator,
  taskSourceValidator,
} from "./validators";

const clientId = v.optional(v.string());
// A task id, or the task's number written as "#42".
const taskId = v.string();
const at = v.optional(v.number());

// Agent work fields of a task (docs/agent-work.md), in add_task and update_task.
const agentWork = {
  acceptance: v.optional(v.array(acceptanceInputValidator)),
  plan: v.optional(v.string()),
  dependsOn: v.optional(v.array(taskId)),
  blockedReason: v.optional(v.string()),
};

export const args = {
  add: {
    title: v.string(),
    note: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    status: v.optional(v.union(v.literal("todo"), v.literal("doing"))),
    resumeNote: v.optional(v.string()),
    repeat: v.optional(repeatInputValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
    checklist: v.optional(v.array(checklistInputValidator)),
    reminders: v.optional(v.array(reminderValidator)),
    ...agentWork,
    // Since 0.11.0 (the proposal inbox): wait for the owner, where it came from, who asked, who hears back.
    proposal: v.optional(v.boolean()),
    source: v.optional(taskSourceValidator),
    requestedBy: v.optional(v.string()),
    returnTo: v.optional(v.string()),
    clientId,
  },
  update: {
    taskId,
    title: v.optional(v.string()),
    note: clearable(v.string()),
    dueDate: clearable(v.string()),
    dueTime: clearable(v.string()),
    resumeNote: clearable(v.string()),
    repeat: clearable(repeatInputValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
    checklist: clearable(v.array(checklistInputValidator)),
    reminders: clearable(v.array(reminderValidator)),
    acceptance: clearable(v.array(acceptanceInputValidator)),
    plan: clearable(v.string()),
    dependsOn: v.optional(v.array(taskId)),
    blockedReason: clearable(v.string()),
    clientId,
  },
  setStatus: { taskId, status: statusValidator, clientId },
  setNow: { taskId: v.union(taskId, v.null()), resumeNote: v.optional(v.string()), clientId },
  complete: { taskId, proof: v.optional(proofValidator), clientId },
  reschedule: { taskId, dueDate: v.union(v.string(), v.null()), dueTime: clearable(v.string()), clientId },
  archive: { taskId, clientId },
  softDelete: { taskId, clientId },
  restore: { taskId, clientId },
  listToday: { at },
  listAll: {
    labels: v.optional(v.array(v.string())),
    includeDone: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    at,
  },
  // list_all through MCP: listAll plus search, filters and pages.
  findTasks: {
    labels: v.optional(v.array(v.string())),
    includeDone: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    query: v.optional(v.string()),
    status: v.optional(v.array(statusValidator)),
    dueBefore: v.optional(v.string()),
    dueAfter: v.optional(v.string()),
    overdue: v.optional(v.boolean()),
    ready: v.optional(v.boolean()),
    proposed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    at,
  },
  // Time-boxed claims (claim_task, renew_claim, release_task).
  claim: { taskId, minutes: v.optional(v.number()), clientId },
  renewClaim: { taskId, minutes: v.optional(v.number()), clientId },
  release: { taskId, note: v.optional(v.string()), clientId },
  // The activity log (list_events): task changes after a position.
  listEvents: {
    since: v.optional(v.string()),
    // The actor filter: app, cli, agent or "agent: <name>"; `actor` is the caller's own identity.
    by: v.optional(v.string()),
    taskId: v.optional(taskId),
    limit: v.optional(v.number()),
  },
  // Approval requests (request_approval, get_approval, list_approvals, decide_approval).
  requestApproval: {
    taskId: v.optional(taskId),
    action: v.string(),
    detail: v.optional(v.string()),
    options: v.array(approvalOptionInputValidator),
    reversible: v.boolean(),
    expiresInMinutes: v.optional(v.number()),
    clientId,
  },
  getApproval: { approvalId: v.string() },
  listApprovals: {
    status: v.optional(v.union(v.literal("pending"), v.literal("decided"), v.literal("expired"))),
    taskId: v.optional(taskId),
    limit: v.optional(v.number()),
  },
  decideApproval: { approvalId: v.string(), optionId: v.string(), note: v.optional(v.string()) },
  // The owner's controls over agents (get_agent_controls, pause_agents, set_tool_policy).
  getAgentControls: {},
  pauseAgents: { paused: v.boolean(), reason: v.optional(v.string()) },
  // Not keyId and tool: those name the caller and the tool being called (set by the server).
  setToolPolicy: { apiKeyId: v.string(), toolName: v.string(), rule: policyRuleValidator },
  // The proposal inbox (accept_proposal, merge_proposal, reject_proposal).
  acceptProposal: { taskId, clientId },
  mergeProposal: { taskId, intoTaskId: taskId, clientId },
  rejectProposal: { taskId, reason: v.optional(v.string()), clientId },
  // The plan health report (plan_health).
  planHealth: { at },
  listTrash: {},
  board: { doneLimit: v.optional(v.number()), at },
  getTask: { taskId, at },
  exportPlan: { format: v.union(v.literal("markdown"), v.literal("json"), v.literal("ics")), at },
  getSettings: {},
  updateSettings: {
    timezone: v.optional(v.string()),
    summaryTime: v.optional(v.string()),
    defaultReminderMinutes: v.optional(v.array(v.number())),
    clientId,
  },
  revokeApiKey: { keyId: v.id("apiKeys") },
  listApiKeys: {},
  createApiKey: {
    name: v.string(),
    kind: v.optional(keyKindValidator),
    scope: v.optional(keyScopeValidator),
    expiresAt: v.optional(v.number()),
  },
};

// Only the MCP endpoint offers a dry run: the app always applies its changes.
export const dryRunArgs = { dryRun: v.optional(v.boolean()) };

// Since 0.11.0: a change an owner's policy "ask" held back runs with the approved request's id.
export const approvalArgs = { approvalId: v.optional(v.string()) };

/** Code of the error that rolls a dry run back; its data carries the result the change would have had. */
export const DRY_RUN_CODE = "dry_run";
