// Domain operations as internal functions. Each takes the acting identity
// (userId, actor) explicitly; the app layer (app.ts) and the MCP endpoint
// (mcp.ts) only establish who is calling and then run the same code.
import { ConvexError, v, type ObjectType, type PropertyValidators } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { args, DRY_RUN_CODE, dryRunArgs } from "./lib/args";
import { appliedOperation, fail, identityOf as who, loadTask, versionTag, type Identity } from "./lib/core";
import { exportPlan as exportPlanOp } from "./lib/exportPlan";
import { findTasks as findTasksOp } from "./lib/findTasks";
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
 * A change as an internal mutation. With `dryRun` the change runs, every check
 * included, and is then rolled back by throwing its result: nothing is saved
 * and nothing enters the history.
 */
function change<F extends PropertyValidators>(
  fields: F,
  apply: (ctx: MutationCtx, identity: Identity, input: ObjectType<F>) => Promise<unknown>,
) {
  return internalMutation({
    args: { ...identity, ...fields, ...dryRunArgs, ...preconditionArgs },
    handler: async (ctx, a) => {
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
