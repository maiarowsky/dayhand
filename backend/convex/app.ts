// Thin layer for the Helm app: the caller is the authenticated user and
// the actor is "app". Every function delegates to the domain layer.
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { listKeys } from "./apiKeys";
import { args } from "./lib/args";
import { fail, type Identity } from "./lib/core";
import { exportPlan as exportPlanOp } from "./lib/exportPlan";
import { getSettings as getSettingsOp, updateSettings as updateSettingsOp } from "./lib/settingsOps";
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

export const add = mutation({ args: args.add, handler: async (ctx, a) => addTask(ctx, await appUser(ctx), a) });
export const update = mutation({
  args: args.update,
  handler: async (ctx, a) => updateTask(ctx, await appUser(ctx), a),
});
export const setStatus = mutation({
  args: args.setStatus,
  handler: async (ctx, a) => setStatusOp(ctx, await appUser(ctx), a),
});
export const setNow = mutation({ args: args.setNow, handler: async (ctx, a) => setNowOp(ctx, await appUser(ctx), a) });
export const complete = mutation({
  args: args.complete,
  handler: async (ctx, a) => completeTask(ctx, await appUser(ctx), a),
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
export const updateSettings = mutation({
  args: args.updateSettings,
  handler: async (ctx, a) => updateSettingsOp(ctx, await appUser(ctx), a),
});

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
  handler: async (ctx, a): Promise<{ id: Id<"apiKeys">; name: string; kind: "cli" | "agent"; key: string }> =>
    ctx.runAction(internal.apiKeys.create, { ...(await appUser(ctx)), ...a }),
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
