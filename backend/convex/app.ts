// Thin layer for the Dayhand app: the caller is the authenticated user and
// the actor is "app". Every function delegates to the domain layer.
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { listKeys, type CreatedKey } from "./apiKeys";
import { getFeed, revokeFeed, type CalendarFeed } from "./calendarFeeds";
import {
  decideRequest,
  listConnections as listConnectionsOp,
  lookupRequest,
  revokeConnection as revokeConnectionOp,
} from "./oauthOwner";
import { args } from "./lib/args";
import { offlineRepeatValidator } from "./lib/offlineRepeat";
import { fail, type Identity } from "./lib/core";
import { exportPlan as exportPlanOp } from "./lib/exportPlan";
import { scopeValidator } from "./lib/oauthConfig";
import { getSettings as getSettingsOp, updateSettings as updateSettingsOp } from "./lib/settingsOps";
import { releaseTask } from "./lib/agentWork";
import { getAgentControls as getAgentControlsOp, setAgentsPaused, setToolPolicy as setToolPolicyOp } from "./lib/agentControls";
import { decideApproval as decideApprovalOp, listApprovals as listApprovalsOp } from "./lib/approvals";
import { planHealth as planHealthOp } from "./lib/health";
import { TOOLS } from "./lib/mcpTools";
import { addProject as addProjectOp, allProjects, deleteProject as deleteProjectOp, toProject, updateProject as updateProjectOp } from "./lib/projectOps";
import {
  acceptProposal as acceptProposalOp,
  listProposals as listProposalsOp,
  mergeProposal as mergeProposalOp,
  rejectProposal as rejectProposalOp,
} from "./lib/proposals";
import {
  addTask,
  archiveTask,
  completeTask,
  rescheduleTask,
  restoreTask,
  setNow as setNowOp,
  setStatus as setStatusOp,
  softDeleteTask,
  updateTask,
} from "./lib/taskOps";
import {
  board as boardOp,
  getTask as getTaskOp,
  listAll as listAllOp,
  listToday as listTodayOp,
  listTrash as listTrashOp,
} from "./lib/views";

type AuthCtx = { auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> } };

async function appUser(ctx: AuthCtx): Promise<Identity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthenticated", "Sign in required");
  return { userId: identity.tokenIdentifier, actor: "app" };
}

// 0.13.2: app-only proof for a locally calculated occurrence; not part of add_task or REST POST /tasks.
export const add = mutation({
  args: { ...args.add, repeatedFrom: v.optional(offlineRepeatValidator) },
  handler: async (ctx, { repeatedFrom, ...a }) => addTask(ctx, await appUser(ctx), a, repeatedFrom),
});
export const update = mutation({
  args: args.update,
  handler: async (ctx, a) => updateTask(ctx, await appUser(ctx), a),
});
export const setStatus = mutation({
  args: args.setStatus,
  handler: async (ctx, a) => setStatusOp(ctx, await appUser(ctx), a),
});
export const setNow = mutation({ args: args.setNow, handler: async (ctx, a) => setNowOp(ctx, await appUser(ctx), a) });
// 0.14.1: the app's local completion day, so an offline completion repeats from that day; not part of complete_task.
export const complete = mutation({
  args: { ...args.complete, completedOn: v.optional(v.string()) },
  handler: async (ctx, { completedOn, ...a }) => completeTask(ctx, await appUser(ctx), a, completedOn),
});
export const reschedule = mutation({
  args: args.reschedule,
  handler: async (ctx, a) => rescheduleTask(ctx, await appUser(ctx), a),
});
export const archive = mutation({
  args: args.archive,
  handler: async (ctx, a) => archiveTask(ctx, await appUser(ctx), a),
});
export const softDelete = mutation({
  args: args.softDelete,
  handler: async (ctx, a) => softDeleteTask(ctx, await appUser(ctx), a),
});
export const restore = mutation({
  args: args.restore,
  handler: async (ctx, a) => restoreTask(ctx, await appUser(ctx), a),
});
// The owner takes a task over from an agent: the claim ends at once (owner wins).
export const release = mutation({
  args: args.release,
  handler: async (ctx, a) => releaseTask(ctx, await appUser(ctx), a),
});
export const updateSettings = mutation({
  args: args.updateSettings,
  handler: async (ctx, a) => updateSettingsOp(ctx, await appUser(ctx), a),
});

// Approval requests (docs/agent-work.md#5-approval-requests): the phone lists them and decides.
export const listApprovals = query({
  args: args.listApprovals,
  handler: async (ctx, a) => listApprovalsOp(ctx, await appUser(ctx), a),
});
export const decideApproval = mutation({
  args: args.decideApproval,
  handler: async (ctx, a) => decideApprovalOp(ctx, await appUser(ctx), a),
});

// The agent switch and tool policies (docs/agent-work.md#6-pausing-agents-and-tool-policies).
export const getAgentControls = query({ args: {}, handler: async (ctx) => getAgentControlsOp(ctx, await appUser(ctx)) });
export const pauseAgents = mutation({
  args: args.pauseAgents,
  handler: async (ctx, a) => setAgentsPaused(ctx, await appUser(ctx), a),
});
export const setToolPolicy = mutation({
  args: args.setToolPolicy,
  handler: async (ctx, a) =>
    setToolPolicyOp(ctx, await appUser(ctx), a, TOOLS.filter((t) => t.kind === "write" && !t.ownerOnly).map((t) => t.name)),
});

// The proposal inbox (docs/agent-work.md#7-the-proposal-inbox).
export const listProposals = query({ args: {}, handler: async (ctx) => listProposalsOp(ctx, await appUser(ctx)) });
export const acceptProposal = mutation({
  args: args.acceptProposal,
  handler: async (ctx, a) => acceptProposalOp(ctx, await appUser(ctx), a),
});
export const mergeProposal = mutation({
  args: args.mergeProposal,
  handler: async (ctx, a) => mergeProposalOp(ctx, await appUser(ctx), a),
});
export const rejectProposal = mutation({
  args: args.rejectProposal,
  handler: async (ctx, a) => rejectProposalOp(ctx, await appUser(ctx), a),
});

// Projects (since 0.13.0, lib/projectOps.ts). The app gets every project, archived
// ones included, without counts: it counts its tasks itself, also offline.
export const listProjects = query({
  args: {},
  handler: async (ctx) => (await allProjects(ctx, (await appUser(ctx)).userId)).map(toProject),
});
export const addProject = mutation({
  args: args.addProject,
  handler: async (ctx, a) => addProjectOp(ctx, await appUser(ctx), a),
});
export const updateProject = mutation({
  args: args.updateProject,
  handler: async (ctx, a) => updateProjectOp(ctx, await appUser(ctx), a),
});
export const deleteProject = mutation({
  args: args.deleteProject,
  handler: async (ctx, a) => deleteProjectOp(ctx, await appUser(ctx), a),
});

// The plan health report (docs/agent-work.md#8-the-plan-health-report).
export const planHealth = query({ args: args.planHealth, handler: async (ctx, a) => planHealthOp(ctx, await appUser(ctx), a) });

export const listToday = query({
  args: args.listToday,
  handler: async (ctx, a) => listTodayOp(ctx, await appUser(ctx), a),
});
export const listAll = query({ args: args.listAll, handler: async (ctx, a) => listAllOp(ctx, await appUser(ctx), a) });
export const listTrash = query({ args: args.listTrash, handler: async (ctx) => listTrashOp(ctx, await appUser(ctx)) });
export const board = query({ args: args.board, handler: async (ctx, a) => boardOp(ctx, await appUser(ctx), a) });
export const getTask = query({ args: args.getTask, handler: async (ctx, a) => getTaskOp(ctx, await appUser(ctx), a) });
export const exportPlan = query({
  args: args.exportPlan,
  handler: async (ctx, a) => exportPlanOp(ctx, await appUser(ctx), a),
});
export const getSettings = query({ args: args.getSettings, handler: async (ctx) => getSettingsOp(ctx, await appUser(ctx)) });

export const createApiKey = action({
  args: args.createApiKey,
  handler: async (ctx, a): Promise<CreatedKey> => ctx.runAction(internal.apiKeys.create, { ...(await appUser(ctx)), ...a }),
});
export const revokeApiKey = mutation({
  args: args.revokeApiKey,
  handler: async (ctx, a): Promise<{ id: Id<"apiKeys">; revokedAt: number }> =>
    ctx.runMutation(internal.apiKeys.revoke, { ...(await appUser(ctx)), ...a }),
});
export const listApiKeys = query({
  args: args.listApiKeys,
  handler: async (ctx) => listKeys(ctx, (await appUser(ctx)).userId),
});

// The calendar feed (calendarFeeds.ts): its addresses, turning it on, a new address, off.
export const getCalendarFeed = query({
  args: {},
  handler: async (ctx): Promise<CalendarFeed | null> => getFeed(ctx, await appUser(ctx)),
});
export const createCalendarFeed = action({
  args: { replace: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<CalendarFeed> => ctx.runAction(internal.calendarFeeds.create, { ...(await appUser(ctx)), ...a }),
});
export const revokeCalendarFeed = mutation({
  args: {},
  handler: async (ctx): Promise<{ revoked: boolean }> => revokeFeed(ctx, await appUser(ctx)),
});

// Agent connections (OAuth, docs/oauth.md): the phone approves a connection by the
// code its browser page shows, and lists and revokes connections.
export const lookupConnectionRequest = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => lookupRequest(ctx, await appUser(ctx), code),
});
export const decideConnectionRequest = mutation({
  args: { code: v.string(), approve: v.boolean(), scopes: v.optional(v.array(scopeValidator)) },
  handler: async (ctx, a) => decideRequest(ctx, await appUser(ctx), a),
});
export const listConnections = query({
  args: {},
  handler: async (ctx) => listConnectionsOp(ctx, (await appUser(ctx)).userId),
});
export const revokeConnection = mutation({
  args: { connectionId: v.string() },
  handler: async (ctx, { connectionId }) => revokeConnectionOp(ctx, await appUser(ctx), connectionId),
});
