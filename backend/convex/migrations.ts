// Data migrations, run by the deployment admin after a deploy that needs them
// (steps in docs/deploy.md). Each is idempotent: it only fills what is missing.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { nextTaskRef } from "./lib/core";

const BATCH = 200;

/**
 * 0.3.0: gives every task without a number the next number of its user, oldest
 * first. Runs in batches and schedules itself until all tasks are done.
 */
export const backfillTaskRefs = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("tasks").paginate({ numItems: BATCH, cursor: cursor ?? null });
    let numbered = 0;
    for (const task of page.page) {
      if (task.ref !== undefined) continue;
      await ctx.db.patch(task._id, { ref: await nextTaskRef(ctx, task.userId) });
      numbered++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillTaskRefs, { cursor: page.continueCursor });
    }
    return { numbered, done: page.isDone };
  },
});

/** 0.3.0: keys created before key kinds existed become agent keys, as they acted before. */
export const backfillKeyKinds = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const key of await ctx.db.query("apiKeys").collect()) {
      if (key.kind !== undefined) continue;
      await ctx.db.patch(key._id, { kind: "agent" });
      updated++;
    }
    return { updated };
  },
});

/** What the 0.3.0 migrations still have to do; both numbers are 0 when they are complete. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    let tasksWithoutRef = 0;
    for await (const task of ctx.db.query("tasks")) if (task.ref === undefined) tasksWithoutRef++;
    const keysWithoutKind = (await ctx.db.query("apiKeys").collect()).filter((k) => k.kind === undefined).length;
    return { tasksWithoutRef, keysWithoutKind };
  },
});
