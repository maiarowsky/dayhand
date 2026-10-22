// Domain operations as internal functions. Each takes the acting identity
// (userId, actor) explicitly; the app layer (app.ts) and the MCP endpoint
// (mcp.ts) only establish who is calling and then run the same code.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { args } from "./lib/args";
import { exportPlan as exportPlanOp } from "./lib/exportPlan";
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
import { actorValidator } from "./lib/validators";
import {
  board as boardOp,
  getTask as getTaskOp,
  listAll as listAllOp,
  listToday as listTodayOp,
  listTrash as listTrashOp,
} from "./lib/views";

const identity = { userId: v.string(), actor: actorValidator };
const who = ({ userId, actor }: { userId: string; actor: "app" | "agent" }) => ({ userId, actor });

export const add = internalMutation({
  args: { ...identity, ...args.add },
  handler: (ctx, a) => addTask(ctx, who(a), a),
});
export const update = internalMutation({
  args: { ...identity, ...args.update },
  handler: (ctx, a) => updateTask(ctx, who(a), a),
});
export const setStatus = internalMutation({
  args: { ...identity, ...args.setStatus },
  handler: (ctx, a) => setStatusOp(ctx, who(a), a),
});
export const setNow = internalMutation({
  args: { ...identity, ...args.setNow },
  handler: (ctx, a) => setNowOp(ctx, who(a), a),
});
export const complete = internalMutation({
  args: { ...identity, ...args.complete },
  handler: (ctx, a) => completeTask(ctx, who(a), a),
});
export const reschedule = internalMutation({
  args: { ...identity, ...args.reschedule },
  handler: (ctx, a) => rescheduleTask(ctx, who(a), a),
});
export const archive = internalMutation({
  args: { ...identity, ...args.archive },
  handler: (ctx, a) => archiveTask(ctx, who(a), a),
});
export const softDelete = internalMutation({
  args: { ...identity, ...args.softDelete },
  handler: (ctx, a) => softDeleteTask(ctx, who(a), a),
});
export const restore = internalMutation({
  args: { ...identity, ...args.restore },
  handler: (ctx, a) => restoreTask(ctx, who(a), a),
});
export const updateSettings = internalMutation({
  args: { ...identity, ...args.updateSettings },
  handler: (ctx, a) => updateSettingsOp(ctx, who(a), a),
});

export const listToday = internalQuery({
  args: { ...identity, ...args.listToday },
  handler: (ctx, a) => listTodayOp(ctx, who(a), a),
});
export const listAll = internalQuery({
  args: { ...identity, ...args.listAll },
  handler: (ctx, a) => listAllOp(ctx, who(a), a),
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
