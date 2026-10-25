// Data migrations, run by the deployment admin after a deploy that needs them
// (steps in docs/deploy.md). Each is idempotent: it only fills what is missing,
// or (projectsToLabels) only takes away what is still there.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { nextTaskRef } from "./lib/core";

const BATCH = 200;
const MAX_LABELS = 20;

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

/**
 * 0.13.0, before rolling back to 0.12.x (docs/deploy.md): projects become labels
 * again. Every task in a project gets a label with the project's name, when it
 * has room for one more (20 at most; the others are listed in noRoom), and
 * loses its projectId; once no task has one, the projects are deleted. Nothing
 * enters the history. Runs in batches and schedules itself; `projects` marks
 * the last part, when only projects are left to delete.
 */
export const projectsToLabels = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), projects: v.optional(v.boolean()) },
  handler: async (ctx, { cursor, projects }) => {
    let relabeled = 0;
    let cleared = 0;
    const noRoom: { taskId: Id<"tasks">; ref: number | null; project: string }[] = [];
    if (!projects) {
      const page = await ctx.db.query("tasks").paginate({ numItems: BATCH, cursor: cursor ?? null });
      const names = new Map<string, string | null>();
      for (const task of page.page) {
        if (task.projectId === undefined) continue;
        if (!names.has(task.projectId)) names.set(task.projectId, (await ctx.db.get(task.projectId))?.name ?? null);
        const name = names.get(task.projectId) ?? null;
        const wanted = name !== null && !task.labels.includes(name);
        const room = task.labels.length < MAX_LABELS;
        if (wanted && !room) {
          noRoom.push({ taskId: task._id, ref: task.ref ?? null, project: name });
          // Batches after the first run on their own: the deployment's logs keep what they could not carry over.
          console.warn(`Task #${task.ref ?? task._id} already has ${MAX_LABELS} labels; project "${name}" was not added as a label`);
        }
        await ctx.db.patch(task._id, { projectId: undefined, ...(wanted && room ? { labels: [...task.labels, name] } : {}) });
        if (wanted && room) relabeled++;
        cleared++;
      }
      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.migrations.projectsToLabels, { cursor: page.continueCursor });
        return { relabeled, cleared, noRoom, projectsDeleted: 0, done: false };
      }
    }
    const batch = await ctx.db.query("projects").take(BATCH);
    for (const project of batch) await ctx.db.delete(project._id);
    const done = batch.length < BATCH;
    if (!done) await ctx.scheduler.runAfter(0, internal.migrations.projectsToLabels, { projects: true });
    return { relabeled, cleared, noRoom, projectsDeleted: batch.length, done };
  },
});

/**
 * What the migrations still have to do; every number is 0 when they are complete.
 * tasksWithProject and projects (since 0.13.0) are what projectsToLabels still
 * has to do: both must be 0 before a rollback to 0.12.x, and are not otherwise.
 */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    let tasksWithoutRef = 0;
    let tasksWithProject = 0;
    for await (const task of ctx.db.query("tasks")) {
      if (task.ref === undefined) tasksWithoutRef++;
      if (task.projectId !== undefined) tasksWithProject++;
    }
    const keysWithoutKind = (await ctx.db.query("apiKeys").collect()).filter((k) => k.kind === undefined).length;
    let taskEventsWithoutSeq = 0;
    for await (const event of ctx.db.query("taskEvents")) if (event.taskId !== undefined && event.seq === undefined) taskEventsWithoutSeq++;
    const projects = (await ctx.db.query("projects").collect()).length;
    return { tasksWithoutRef, keysWithoutKind, taskEventsWithoutSeq, tasksWithProject, projects };
  },
});
