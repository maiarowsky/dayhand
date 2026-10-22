// Task mutations. Every function takes the acting identity explicitly,
// records history signed with the actor and is idempotent by clientId.
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { args } from "./args";
import {
  appliedOperation,
  checkClientId,
  checkDueDate,
  checkDueTime,
  checkLabels,
  checkLinks,
  checkRepeat,
  checkSchedule,
  checkText,
  checkTitle,
  fail,
  loadTask,
  nextTaskRef,
  patchTask,
  recordEvent,
  toTask,
  todayFor,
  type Identity,
} from "./core";
import { nextOccurrence } from "./repeat";
import type { Status } from "./validators";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

/** Current state of the task touched by an already applied operation. */
async function replay(ctx: MutationCtx, userId: string, clientId?: string) {
  const event = await appliedOperation(ctx, userId, checkClientId(clientId));
  if (!event) return null;
  const task = event.taskId ? await ctx.db.get(event.taskId) : null;
  if (!task) fail("not_found", "Task of this operation no longer exists");
  return task;
}

function activeTask(task: Doc<"tasks">) {
  if (task.deletedAt !== undefined) fail("invalid_argument", "Task is in the trash; restore it first");
  return task;
}

export async function addTask(ctx: MutationCtx, identity: Identity, input: Args<"add">) {
  const clientId = checkClientId(input.clientId);
  if (clientId !== undefined) {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", clientId))
      .first();
    if (existing) return toTask(existing);
  }
  const today = await todayFor(ctx, identity.userId, Date.now());
  const dueDate = input.dueDate === undefined ? undefined : checkDueDate(input.dueDate, today);
  const dueTime = input.dueTime === undefined ? undefined : checkDueTime(input.dueTime);
  checkSchedule(dueDate, dueTime);
  const now = Date.now();
  const fields = {
    title: checkTitle(input.title),
    note: input.note === undefined ? undefined : checkText("note", input.note),
    dueDate,
    dueTime,
    status: input.status ?? ("todo" as Status),
    isNow: false,
    resumeNote: input.resumeNote === undefined ? undefined : checkText("resumeNote", input.resumeNote),
    repeat: input.repeat === undefined ? undefined : checkRepeat(input.repeat),
    labels: checkLabels(input.labels ?? []),
    links: checkLinks(input.links ?? []),
    createdAt: now,
    updatedAt: now,
    clientId,
  };
  const ref = await nextTaskRef(ctx, identity.userId);
  const taskId = await ctx.db.insert("tasks", { userId: identity.userId, ref, ...fields });
  const { createdAt, updatedAt, ...snapshot } = fields;
  await recordEvent(ctx, identity, { taskId, action: "create", after: snapshot, clientId });
  return toTask((await ctx.db.get(taskId))!);
}

export async function updateTask(ctx: MutationCtx, identity: Identity, input: Args<"update">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = activeTask(await loadTask(ctx, identity.userId, input.taskId));
  const today = await todayFor(ctx, identity.userId, Date.now());
  const patch: Partial<Doc<"tasks">> = {};
  if (input.title !== undefined) patch.title = checkTitle(input.title);
  if (input.note !== undefined) patch.note = input.note === null ? undefined : checkText("note", input.note);
  if (input.resumeNote !== undefined) {
    patch.resumeNote = input.resumeNote === null ? undefined : checkText("resumeNote", input.resumeNote);
  }
  if (input.dueDate !== undefined) {
    patch.dueDate = input.dueDate === null ? undefined : checkDueDate(input.dueDate, today);
    if (input.dueDate === null) patch.dueTime = undefined;
  }
  if (input.dueTime !== undefined) patch.dueTime = input.dueTime === null ? undefined : checkDueTime(input.dueTime);
  if (input.repeat !== undefined) patch.repeat = input.repeat === null ? undefined : checkRepeat(input.repeat);
  if (input.labels !== undefined) patch.labels = checkLabels(input.labels);
  if (input.links !== undefined) patch.links = checkLinks(input.links);
  checkSchedule(
    "dueDate" in patch ? patch.dueDate : task.dueDate,
    "dueTime" in patch ? patch.dueTime : task.dueTime,
  );
  return toTask(await patchTask(ctx, identity, task, "update", patch, input.clientId));
}

export async function rescheduleTask(ctx: MutationCtx, identity: Identity, input: Args<"reschedule">) {
  const { taskId, dueDate, dueTime, clientId } = input;
  return updateTask(ctx, identity, { taskId, dueDate, dueTime: dueDate === null ? undefined : dueTime, clientId });
}

async function clearNow(ctx: MutationCtx, identity: Identity, exceptId?: Id<"tasks">) {
  const current = await ctx.db
    .query("tasks")
    .withIndex("by_user_isNow", (q) => q.eq("userId", identity.userId).eq("isNow", true))
    .collect();
  for (const task of current) {
    if (task._id !== exceptId) await patchTask(ctx, identity, task, "setNow", { isNow: false });
  }
}

/** Marks a task done; a repeating task gets its next occurrence. */
export async function completeTask(ctx: MutationCtx, identity: Identity, input: Args<"complete">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) {
    const events = await ctx.db
      .query("taskEvents")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", input.clientId))
      .collect();
    const spawned = events.find((e) => e.action === "repeat")?.taskId;
    const next = spawned ? await ctx.db.get(spawned) : null;
    return { task: toTask(replayed), next: next ? toTask(next) : null };
  }
  const task = activeTask(await loadTask(ctx, identity.userId, input.taskId));
  if (task.status === "done") return { task: toTask(task), next: null };
  const done = await patchTask(
    ctx,
    identity,
    task,
    "complete",
    { status: "done", isNow: false, completedAt: Date.now() },
    input.clientId,
  );
  if (!task.repeat) return { task: toTask(done), next: null };

  const today = await todayFor(ctx, identity.userId, Date.now());
  const now = Date.now();
  const nextFields = {
    title: task.title,
    note: task.note,
    dueDate: nextOccurrence(task.repeat, task.dueDate, today),
    dueTime: task.dueTime,
    status: "todo" as Status,
    isNow: false,
    repeat: task.repeat,
    labels: task.labels,
    links: task.links,
    createdAt: now,
    updatedAt: now,
  };
  const nextId = await ctx.db.insert("tasks", {
    userId: identity.userId,
    ref: await nextTaskRef(ctx, identity.userId),
    ...nextFields,
  });
  await recordEvent(ctx, identity, {
    taskId: nextId,
    action: "repeat",
    after: { dueDate: nextFields.dueDate, repeatedFrom: task._id },
    clientId: input.clientId,
  });
  return { task: toTask(done), next: toTask((await ctx.db.get(nextId))!) };
}

export async function setStatus(ctx: MutationCtx, identity: Identity, input: Args<"setStatus">) {
  if (input.status === "done") {
    return (await completeTask(ctx, identity, { taskId: input.taskId, clientId: input.clientId })).task;
  }
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = activeTask(await loadTask(ctx, identity.userId, input.taskId));
  const patch: Partial<Doc<"tasks">> = { status: input.status, completedAt: undefined };
  // Only a task in progress can be the "now" task.
  if (input.status !== "doing") patch.isNow = false;
  return toTask(await patchTask(ctx, identity, task, "setStatus", patch, input.clientId));
}

/** Makes one task the single "now" task (status doing); null clears it. */
export async function setNow(ctx: MutationCtx, identity: Identity, input: Args<"setNow">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  if (input.taskId === null) {
    await clearNow(ctx, identity);
    return null;
  }
  const task = activeTask(await loadTask(ctx, identity.userId, input.taskId));
  if (task.archivedAt !== undefined) fail("invalid_argument", "Task is archived; restore it first");
  await clearNow(ctx, identity, task._id);
  const patch: Partial<Doc<"tasks">> = { isNow: true, status: "doing", completedAt: undefined };
  if (input.resumeNote !== undefined) patch.resumeNote = checkText("resumeNote", input.resumeNote);
  return toTask(await patchTask(ctx, identity, task, "setNow", patch, input.clientId));
}

export async function archiveTask(ctx: MutationCtx, identity: Identity, input: Args<"archive">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = activeTask(await loadTask(ctx, identity.userId, input.taskId));
  if (task.archivedAt !== undefined) return toTask(task);
  return toTask(
    await patchTask(ctx, identity, task, "archive", { archivedAt: Date.now(), isNow: false }, input.clientId),
  );
}

/** Moves a task to the trash; it is purged after 30 days unless restored. */
export async function softDeleteTask(ctx: MutationCtx, identity: Identity, input: Args<"softDelete">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = await loadTask(ctx, identity.userId, input.taskId);
  if (task.deletedAt !== undefined) return toTask(task);
  return toTask(
    await patchTask(ctx, identity, task, "delete", { deletedAt: Date.now(), isNow: false }, input.clientId),
  );
}

/** Brings a task back from the trash, or from the archive when not in the trash. */
export async function restoreTask(ctx: MutationCtx, identity: Identity, input: Args<"restore">) {
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = await loadTask(ctx, identity.userId, input.taskId);
  const patch: Partial<Doc<"tasks">> =
    task.deletedAt !== undefined ? { deletedAt: undefined } : { archivedAt: undefined };
  return toTask(await patchTask(ctx, identity, task, "restore", patch, input.clientId));
}

const PURGE_BATCH = 200;

/** Permanently removes tasks (and their history) that sat in the trash for 30 days. */
export async function purgeExpiredTrash(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("tasks")
    .withIndex("by_deletedAt", (q) => q.gte("deletedAt", 0).lt("deletedAt", now - TRASH_RETENTION_MS))
    .take(PURGE_BATCH);
  for (const task of expired) {
    const events = await ctx.db
      .query("taskEvents")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    await ctx.db.delete(task._id);
  }
  return { purged: expired.length, more: expired.length === PURGE_BATCH };
}
