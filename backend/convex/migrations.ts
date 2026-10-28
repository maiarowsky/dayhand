// Data migrations, run by the deployment admin after a deploy that needs them
// (steps in docs/deploy.md). Each is idempotent: it only fills what is missing,
// or (dropLabels) only takes away what is still there.
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

/**
 * 0.10.0: gives every task change from before 0.10.0 its position in the
 * user's activity log (list_events), so the log covers the whole history.
 * Old changes are numbered in the order of their time, from that time in
 * microseconds as new ones are, and so come before every change made since.
 * Walks the history user by user in batches and schedules itself; `last` carries
 * the previous change's user and position across batches.
 */
export const backfillEventSeqs = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    last: v.optional(v.object({ userId: v.string(), seq: v.number() })),
  },
  handler: async (ctx, { cursor, last }) => {
    const page = await ctx.db
      .query("taskEvents")
      .withIndex("by_user")
      .paginate({ numItems: BATCH, cursor: cursor ?? null });
    let previous = last ?? null;
    let numbered = 0;
    for (const event of page.page) {
      if (event.taskId === undefined || event.seq !== undefined) continue;
      const floor = previous?.userId === event.userId ? previous.seq + 1 : 0;
      const seq = Math.max(floor, event.at * 1000);
      await ctx.db.patch(event._id, { seq });
      previous = { userId: event.userId, seq };
      numbered++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillEventSeqs, { cursor: page.continueCursor, ...(previous ? { last: previous } : {}) });
    }
    return { numbered, done: page.isDone };
  },
});

// ---- 0.14.0: labels are gone (docs/deploy.md#upgrading-to-0140) ----

const cursorArg = v.optional(v.union(v.string(), v.null()));

/**
 * 0.14.0, before dropLabels: one page of the stored labels, for the backup that
 * scripts/labels-backup.mjs writes. Only tasks with at least one label.
 */
export const exportLabels = internalQuery({
  args: { cursor: cursorArg },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("tasks").paginate({ numItems: BATCH, cursor: cursor ?? null });
    const items = page.page
      .filter((task) => (task.labels ?? []).length > 0)
      .map((task) => ({ taskId: task._id, userId: task.userId, ref: task.ref ?? null, labels: task.labels! }));
    return { items, cursor: page.continueCursor, done: page.isDone };
  },
});

/** A history entry's before or after without `labels`; undefined when nothing else was in it. */
function withoutLabels(change: Record<string, unknown> | undefined) {
  if (change === undefined || !("labels" in change)) return { value: change, changed: false };
  const { labels, ...rest } = change;
  return { value: Object.keys(rest).length > 0 ? rest : undefined, changed: true };
}

/**
 * 0.14.0: removes the stored labels. First every task loses its `labels` field
 * (its updatedAt stays, as nothing a client shows changes), then (`events`)
 * every history entry loses `labels` from its before and after; an entry that
 * recorded only a label change is deleted. Nothing enters the history. Runs in
 * batches and schedules itself until both parts are done.
 */
export const dropLabels = internalMutation({
  args: { cursor: cursorArg, events: v.optional(v.boolean()) },
  handler: async (ctx, { cursor, events }) => {
    if (!events) {
      const page = await ctx.db.query("tasks").paginate({ numItems: BATCH, cursor: cursor ?? null });
      let tasksCleared = 0;
      for (const task of page.page) {
        if (task.labels === undefined) continue;
        await ctx.db.patch(task._id, { labels: undefined });
        tasksCleared++;
      }
      const next = page.isDone ? { events: true } : { cursor: page.continueCursor };
      await ctx.scheduler.runAfter(0, internal.migrations.dropLabels, next);
      return { tasksCleared, eventsCleared: 0, eventsDeleted: 0, done: false };
    }
    const page = await ctx.db.query("taskEvents").paginate({ numItems: BATCH, cursor: cursor ?? null });
    let eventsCleared = 0;
    let eventsDeleted = 0;
    for (const event of page.page) {
      const before = withoutLabels(event.before);
      const after = withoutLabels(event.after);
      if (!before.changed && !after.changed) continue;
      if (before.value === undefined && after.value === undefined) {
        await ctx.db.delete(event._id);
        eventsDeleted++;
        continue;
      }
      await ctx.db.patch(event._id, { before: before.value, after: after.value });
      eventsCleared++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.dropLabels, { cursor: page.continueCursor, events: true });
    return { tasksCleared: 0, eventsCleared, eventsDeleted, done: page.isDone };
  },
});

/**
 * Rolling 0.14.0 back (docs/deploy.md#upgrading-to-0140): puts the labels from
 * the backup back on their tasks, at most BATCH at a time
 * (scripts/labels-backup.mjs restore). A task no longer there is counted in missing.
 */
export const restoreLabels = internalMutation({
  args: { items: v.array(v.object({ taskId: v.string(), labels: v.array(v.string()) })) },
  handler: async (ctx, { items }) => {
    if (items.length > BATCH) throw new Error(`at most ${BATCH} items at a time`);
    let restored = 0;
    let missing = 0;
    for (const item of items) {
      const id = ctx.db.normalizeId("tasks", item.taskId);
      const task = id ? await ctx.db.get(id) : null;
      if (!task) {
        missing++;
        continue;
      }
      await ctx.db.patch(task._id, { labels: item.labels });
      restored++;
    }
    return { restored, missing };
  },
});

/**
 * Rolling back to 0.13.x, after restoreLabels: 0.13.x requires `labels` on every
 * task, so each task without the field gets an empty list. Batches, schedules itself.
 */
export const fillEmptyLabels = internalMutation({
  args: { cursor: cursorArg },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("tasks").paginate({ numItems: BATCH, cursor: cursor ?? null });
    let filled = 0;
    for (const task of page.page) {
      if (task.labels !== undefined) continue;
      await ctx.db.patch(task._id, { labels: [] });
      filled++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.fillEmptyLabels, { cursor: page.continueCursor });
    return { filled, done: page.isDone };
  },
});

/**
 * Backfill counts reach 0 when complete; tasksWithProject and projects instead
 * count live project data. tasksWithLabels and taskEventsWithLabels reach 0 when
 * dropLabels is complete, tasksWithoutLabels when fillEmptyLabels is
 * (docs/deploy.md#upgrading-to-0140).
 */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    let tasksWithoutRef = 0;
    let tasksWithProject = 0;
    let tasksWithLabels = 0;
    let tasksWithoutLabels = 0;
    for await (const task of ctx.db.query("tasks")) {
      if (task.ref === undefined) tasksWithoutRef++;
      if (task.projectId !== undefined) tasksWithProject++;
      if (task.labels === undefined) tasksWithoutLabels++;
      else tasksWithLabels++;
    }
    const keysWithoutKind = (await ctx.db.query("apiKeys").collect()).filter((k) => k.kind === undefined).length;
    let taskEventsWithoutSeq = 0;
    let taskEventsWithLabels = 0;
    for await (const event of ctx.db.query("taskEvents")) {
      if (event.taskId !== undefined && event.seq === undefined) taskEventsWithoutSeq++;
      if ((event.before !== undefined && "labels" in event.before) || (event.after !== undefined && "labels" in event.after)) taskEventsWithLabels++;
    }
    const projects = (await ctx.db.query("projects").collect()).length;
    return { tasksWithoutRef, keysWithoutKind, taskEventsWithoutSeq, tasksWithProject, projects, tasksWithLabels, tasksWithoutLabels, taskEventsWithLabels };
  },
});
