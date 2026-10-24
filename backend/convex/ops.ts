// Domain operations as internal functions. Each takes the acting identity
// (userId, actor) explicitly; the app layer (app.ts) and the MCP endpoint
// (mcp.ts) only establish who is calling and then run the same code.
import { ConvexError, v, type ObjectType, type PropertyValidators } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { listEvents as listEventsOp } from "./lib/activity";
import { gateAgentWrite, getAgentControls as getAgentControlsOp, setAgentsPaused, setToolPolicy as setToolPolicyOp } from "./lib/agentControls";
import { claimTask, releaseTask, renewClaim as renewClaimOp } from "./lib/agentWork";
import {
  decideApproval as decideApprovalOp,
  getApproval as getApprovalOp,
  listApprovals as listApprovalsOp,
  requestApproval as requestApprovalOp,
  requestForPolicy as requestForPolicyOp,
} from "./lib/approvals";
import { approvalArgs, args, DRY_RUN_CODE, dryRunArgs } from "./lib/args";
import { exportBacklog as exportBacklogOp, importBacklog as importBacklogOp } from "./lib/backlogOps";
import { agentBrief as agentBriefOp } from "./lib/brief";
import { appliedOperation, fail, identityOf as who, loadTask, versionTag, type Identity } from "./lib/core";
import { exportPlan as exportPlanOp } from "./lib/exportPlan";
import { findTasks as findTasksOp } from "./lib/findTasks";
import { planHealth as planHealthOp } from "./lib/health";
import { importArgs, importTasks as importTasksOp } from "./lib/importOps";
import { acceptProposal as acceptProposalOp, mergeProposal as mergeProposalOp, rejectProposal as rejectProposalOp } from "./lib/proposals";
import { getSettings as getSettingsOp, updateSettings as updateSettingsOp } from "./lib/settingsOps";
import {
  addTask,
  archiveTask,
  completeTask,
  purgeExpiredTrash,
  rescheduleTask,
  restoreTask,
  setNow as setNowOp,
  setStatus as setStatusOp,
  softDeleteTask,
  updateTask,
} from "./lib/taskOps";
import { TOOLS } from "./lib/mcpTools";
import { identityFields as identity } from "./lib/validators";
import {
  board as boardOp,
  getTask as getTaskOp,
  listAll as listAllOp,
  listToday as listTodayOp,
  listTrash as listTrashOp,
} from "./lib/views";

// Only the REST API sends a precondition (If-Match, docs/api.md): the task's
// version tags the change may apply to; "*" means any.
const preconditionArgs = { ifMatch: v.optional(v.array(v.string())) };

// The MCP endpoint and the REST API name the tool a change runs as, for the
// owner's tool policies (lib/agentControls.ts). Set by the server, never by the caller.
const gateArgs = { tool: v.optional(v.string()), ...approvalArgs };

/**
 * Refuses a change of a task that is no longer at a version the caller saw.
 * A change already applied with the same clientId is a retry and passes, so
 * it returns its result as before.
 */
async function checkPrecondition(ctx: MutationCtx, userId: string, input: { taskId?: unknown; clientId?: unknown }, tags: string[]) {
  if (typeof input.taskId !== "string" || tags.includes("*")) return;
  if (typeof input.clientId === "string" && (await appliedOperation(ctx, userId, input.clientId))) return;
  const current = versionTag(await loadTask(ctx, userId, input.taskId));
  if (!tags.includes(current)) fail("precondition_failed", `The task has changed since that version (it is now ${current}); read it again`);
}

/**
 * A change as an internal mutation. An agent's change first passes the owner's
 * controls (paused agents, tool policies). With `dryRun` the change runs, every
 * check included, and is then rolled back by throwing its result: nothing is
 * saved and nothing enters the history.
 */
function change<F extends PropertyValidators>(
  fields: F,
  apply: (ctx: MutationCtx, identity: Identity, input: ObjectType<F>) => Promise<unknown>,
) {
  return internalMutation({
    args: { ...identity, ...fields, ...dryRunArgs, ...preconditionArgs, ...gateArgs },
    handler: async (ctx, a) => {
      await gateAgentWrite(ctx, who(a), { tool: a.tool, approvalId: a.approvalId, dryRun: a.dryRun, input: a as Record<string, unknown> });
      if (a.ifMatch !== undefined) await checkPrecondition(ctx, a.userId, a as { taskId?: unknown; clientId?: unknown }, a.ifMatch);
      const result = await apply(ctx, who(a), a as ObjectType<F>);
      if (a.dryRun) throw new ConvexError({ code: DRY_RUN_CODE, result: JSON.parse(JSON.stringify(result ?? null)) });
      return result;
    },
  });
}

export const add = change(args.add, addTask);
export const update = change(args.update, updateTask);
export const setStatus = change(args.setStatus, setStatusOp);
export const setNow = change(args.setNow, setNowOp);
export const complete = change(args.complete, completeTask);
export const reschedule = change(args.reschedule, rescheduleTask);
export const archive = change(args.archive, archiveTask);
export const softDelete = change(args.softDelete, softDeleteTask);
export const restore = change(args.restore, restoreTask);
export const updateSettings = change(args.updateSettings, updateSettingsOp);
export const importTasks = change(importArgs, importTasksOp);
export const claim = change(args.claim, claimTask);
export const renewClaim = change(args.renewClaim, renewClaimOp);
export const release = change(args.release, releaseTask);
export const requestApproval = change(args.requestApproval, requestApprovalOp);
export const decideApproval = change(args.decideApproval, decideApprovalOp);
export const pauseAgents = change(args.pauseAgents, setAgentsPaused);
export const setToolPolicy = change(args.setToolPolicy, (ctx, identity, input) =>
  setToolPolicyOp(ctx, identity, input, TOOLS.filter((t) => t.kind === "write" && !t.ownerOnly).map((t) => t.name)),
);
export const acceptProposal = change(args.acceptProposal, acceptProposalOp);
export const mergeProposal = change(args.mergeProposal, mergeProposalOp);
export const rejectProposal = change(args.rejectProposal, rejectProposalOp);
export const importBacklog = change(args.importBacklog, importBacklogOp);

/**
 * The approval request behind a call that a policy "ask" refused (mcp.ts,
 * rest.ts): a waiting request for the same call, or a new one. It runs on its
 * own because the refused change rolls back everything it wrote.
 */
export const requestForPolicy = internalMutation({
  args: { ...identity, tool: v.string(), arguments: v.any() },
  handler: async (ctx, a) => {
    const tool = TOOLS.find((t) => t.name === a.tool);
    if (!tool) throw new ConvexError({ code: "invalid_argument", message: `Unknown tool ${a.tool}` });
    return requestForPolicyOp(ctx, who(a), a.tool, a.arguments as Record<string, unknown>, !tool.annotations.destructiveHint);
  },
});

export const listToday = internalQuery({
  args: { ...identity, ...args.listToday },
  handler: (ctx, a) => listTodayOp(ctx, who(a), a),
});
export const listAll = internalQuery({
  args: { ...identity, ...args.listAll },
  handler: (ctx, a) => listAllOp(ctx, who(a), a),
});
export const findTasks = internalQuery({
  args: { ...identity, ...args.findTasks },
  handler: (ctx, a) => findTasksOp(ctx, who(a), a),
});
export const listTrash = internalQuery({
  args: { ...identity, ...args.listTrash },
  handler: (ctx, a) => listTrashOp(ctx, who(a)),
});
export const board = internalQuery({
  args: { ...identity, ...args.board },
  handler: (ctx, a) => boardOp(ctx, who(a), a),
});
export const getTask = internalQuery({
  args: { ...identity, ...args.getTask },
  handler: (ctx, a) => getTaskOp(ctx, who(a), a),
});
export const exportPlan = internalQuery({
  args: { ...identity, ...args.exportPlan },
  handler: (ctx, a) => exportPlanOp(ctx, who(a), a),
});
export const listEvents = internalQuery({
  args: { ...identity, ...args.listEvents },
  handler: (ctx, a) => listEventsOp(ctx, who(a), a),
});
export const getApproval = internalQuery({
  args: { ...identity, ...args.getApproval },
  handler: (ctx, a) => getApprovalOp(ctx, who(a), a),
});
export const listApprovals = internalQuery({
  args: { ...identity, ...args.listApprovals },
  handler: (ctx, a) => listApprovalsOp(ctx, who(a), a),
});
export const getAgentControls = internalQuery({
  args: { ...identity, ...args.getAgentControls },
  handler: (ctx, a) => getAgentControlsOp(ctx, who(a)),
});
export const planHealth = internalQuery({
  args: { ...identity, ...args.planHealth },
  handler: (ctx, a) => planHealthOp(ctx, who(a), a),
});
export const agentBrief = internalQuery({
  args: { ...identity, ...args.agentBrief },
  handler: (ctx, a) => agentBriefOp(ctx, who(a), a),
});
export const exportBacklog = internalQuery({
  args: { ...identity, ...args.exportBacklog },
  handler: (ctx, a) => exportBacklogOp(ctx, who(a), a),
});
/** Whether agents are paused, for the REST API's account routes (rest.ts). */
export const agentsPaused = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, a) => (await getAgentControlsOp(ctx, { userId: a.userId, actor: "app" })).paused,
});
export const getSettings = internalQuery({
  args: { ...identity, ...args.getSettings },
  handler: (ctx, a) => getSettingsOp(ctx, who(a)),
});

/** Run daily by the cron; `now` is only for tests. Continues in batches. */
export const purgeTrash = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const at = now ?? Date.now();
    const result = await purgeExpiredTrash(ctx, at);
    if (result.more) await ctx.scheduler.runAfter(0, internal.ops.purgeTrash, { now: at });
    return result;
  },
});
