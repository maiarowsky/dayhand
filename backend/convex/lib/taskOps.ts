// Task mutations. Every function takes the acting identity explicitly,
// records history signed with the actor and is idempotent by clientId.
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { args } from "./args";
import {
  checkChecklist,
  checkClientId,
  checkDueDate,
  checkDueTime,
  checkLinks,
  checkReminders,
  checkRepeat,
  checkSchedule,
  checkText,
  checkTitle,
  fail,
  loadSettings,
  loadTask,
  nextTaskRef,
  patchTask,
  recordEvent,
  replay,
  toTask,
  todayFor,
  type Identity,
} from "./core";
import { checkAcceptance, checkClaim, checkCompletion, checkDependsOn, checkLongText, checkProof } from "./agentWork";
import { isValidDate, localDate } from "./dates";
import { projectTarget } from "./projectOps";
import { confirmOfflineRepeat, type OfflineRepeat } from "./offlineRepeat";
import { addSource, checkRequestedBy, checkReturnTo, checkSource, notProposal, sendReturn, taskOfSource } from "./proposals";
import { advance } from "./repeat";
import type { Status } from "./validators";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

function activeTask(task: Doc<"tasks">) {
  if (task.deletedAt !== undefined) fail("invalid_argument", "Task is in the trash; restore it first");
  return task;
}

/** A task the caller may change: another agent's live claim refuses it (lib/agentWork.ts). */
function writable(task: Doc<"tasks">, identity: Identity) {
  checkClaim(task, identity);
  return task;
}

export async function addTask(ctx: MutationCtx, identity: Identity, input: Args<"add">, offlineRepeat?: OfflineRepeat) {
  const clientId = checkClientId(input.clientId);
  if (clientId !== undefined) {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", clientId))
      .first();
    if (existing) return toTask(existing);
  }
  // One source, one task: the same alert again returns the task it made the first time.
  const source = input.source === undefined ? undefined : checkSource(input.source);
  if (source) {
    const existing = await taskOfSource(ctx, identity.userId, source);
    if (existing) return toTask(existing);
  }
  const { timezone } = await loadSettings(ctx, identity.userId);
  const today = localDate(Date.now(), timezone);
  const dueDate = input.dueDate === undefined ? undefined : checkDueDate(input.dueDate, today);
  const dueTime = input.dueTime === undefined ? undefined : checkDueTime(input.dueTime);
  checkSchedule(dueDate, dueTime);
  const repeat = input.repeat === undefined ? undefined : checkRepeat(input.repeat, timezone);
  const projectId = offlineRepeat
    ? await confirmOfflineRepeat(ctx, identity, offlineRepeat, { ...input, clientId, dueDate, repeat })
    : input.projectId === undefined ? undefined : await projectTarget(ctx, identity.userId, input.projectId);
  const now = Date.now();
  const fields = {
    title: checkTitle(input.title),
    note: input.note === undefined ? undefined : checkText("note", input.note),
    dueDate,
    dueTime,
    status: input.status ?? ("todo" as Status),
    isNow: false,
    resumeNote: input.resumeNote === undefined ? undefined : checkText("resumeNote", input.resumeNote),
    repeat,
    links: checkLinks(input.links ?? []),
    checklist: input.checklist === undefined ? undefined : checkChecklist(input.checklist),
    reminders: input.reminders === undefined ? undefined : checkReminders(input.reminders),
    acceptance: input.acceptance === undefined ? undefined : checkAcceptance(input.acceptance),
    plan: input.plan === undefined ? undefined : checkLongText("plan", input.plan),
    dependsOn: input.dependsOn === undefined ? undefined : await checkDependsOn(ctx, identity.userId, null, input.dependsOn),
    blockedReason: input.blockedReason === undefined ? undefined : checkLongText("blockedReason", input.blockedReason),
    proposedAt: input.proposal ? now : undefined,
    source,
    requestedBy: checkRequestedBy(identity, input.requestedBy, input.proposal === true),
    returnTo: input.returnTo === undefined ? undefined : await checkReturnTo(ctx, identity.userId, input.returnTo),
    projectId,
    createdAt: now,
    updatedAt: now,
    clientId,
  };
  if (fields.proposedAt !== undefined && fields.status !== "todo") fail("invalid_argument", "A proposal starts in todo; it can be worked on once accepted");
  const ref = await nextTaskRef(ctx, identity.userId);
  const taskId = await ctx.db.insert("tasks", { userId: identity.userId, ref, ...fields });
  if (source) await addSource(ctx, identity.userId, source, taskId);
  const { createdAt, updatedAt, ...snapshot } = fields;
  // The same repeat history shape as server-side completion also reserves this completion's one successor.
  await recordEvent(ctx, identity, {
    taskId,
    action: offlineRepeat ? "repeat" : "create",
    after: offlineRepeat ? { ...snapshot, repeatedFrom: offlineRepeat.taskId } : snapshot,
    clientId: offlineRepeat?.completedBy ?? clientId,
  });
  return toTask((await ctx.db.get(taskId))!);
}

export async function updateTask(ctx: MutationCtx, identity: Identity, input: Args<"update">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = writable(activeTask(await loadTask(ctx, identity.userId, input.taskId)), identity);
  const { timezone } = await loadSettings(ctx, identity.userId);
  const today = localDate(Date.now(), timezone);
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
  if (input.repeat !== undefined) patch.repeat = input.repeat === null ? undefined : checkRepeat(input.repeat, timezone);
  if (input.links !== undefined) patch.links = checkLinks(input.links);
  if (input.checklist !== undefined) patch.checklist = input.checklist === null ? undefined : checkChecklist(input.checklist);
  if (input.reminders !== undefined) patch.reminders = input.reminders === null ? undefined : checkReminders(input.reminders);
  if (input.acceptance !== undefined) patch.acceptance = input.acceptance === null ? undefined : checkAcceptance(input.acceptance);
  if (input.plan !== undefined) patch.plan = input.plan === null ? undefined : checkLongText("plan", input.plan);
  if (input.dependsOn !== undefined) patch.dependsOn = await checkDependsOn(ctx, identity.userId, task._id, input.dependsOn);
  if (input.blockedReason !== undefined) {
    patch.blockedReason = input.blockedReason === null ? undefined : checkLongText("blockedReason", input.blockedReason);
  }
  if (input.projectId !== undefined) {
    patch.projectId = input.projectId === null ? undefined : await projectTarget(ctx, identity.userId, input.projectId, task.projectId);
  }
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

/**
 * Marks a task done, keeping the proof it was given and ending its claim. An
 * agent completing a task with acceptance criteria needs them all met and a
 * proof summary (lib/agentWork.ts). A repeating task gets its next
 * occurrence, unless its series has ended (`until`, `count`): same title,
 * note, links, reminders, plan and project, the checklist and the
 * criteria unticked, counted on per the rule (lib/repeat.ts). [completedOn] is the
 * app's local day of an offline completion: the next date counts from it, never
 * from a day after today.
 */
export async function completeTask(ctx: MutationCtx, identity: Identity, input: Args<"complete">, completedOn?: string) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) {
    const events = await ctx.db
      .query("taskEvents")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", input.clientId))
      .collect();
    const spawned = events.find((e) => e.action === "repeat")?.taskId;
    const next = spawned ? await ctx.db.get(spawned) : null;
    return { task: toTask(replayed), next: next ? toTask(next) : null };
  }
  const task = notProposal(writable(activeTask(await loadTask(ctx, identity.userId, input.taskId)), identity));
  if (task.status === "done") {
    // It still keeps its clientId, so a retry after a lost answer cannot end a claim taken since it was reopened.
    if (input.clientId !== undefined) await recordEvent(ctx, identity, { action: "complete", clientId: input.clientId });
    return { task: toTask(task), next: null };
  }
  const proof = input.proof === undefined ? undefined : checkProof(input.proof);
  checkCompletion(task, identity, proof);
  const patch: Partial<Doc<"tasks">> = { status: "done", isNow: false, completedAt: Date.now(), claimedBy: undefined, claimExpiresAt: undefined };
  if (proof) patch.proof = proof;
  const done = await patchTask(ctx, identity, task, "complete", patch, input.clientId);
  // Whoever asked for the task through a return webhook hears it is done, with the proof (since 0.11.0).
  await sendReturn(ctx, identity, done, "completed");
  if (!task.repeat) return { task: toTask(done), next: null };

  const today = await todayFor(ctx, identity.userId, Date.now());
  const day = completedOn !== undefined && isValidDate(completedOn) && completedOn < today ? completedOn : today;
  const occurrence = advance(task.repeat, task.dueDate, day);
  if (!occurrence) return { task: toTask(done), next: null };
  const now = Date.now();
  const nextFields = {
    title: task.title,
    note: task.note,
    dueDate: occurrence.dueDate,
    dueTime: task.dueTime,
    status: "todo" as Status,
    isNow: false,
    repeat: occurrence.repeat,
    links: task.links,
    checklist: task.checklist?.map((item) => ({ ...item, done: false })),
    reminders: task.reminders,
    acceptance: task.acceptance?.map((item) => ({ ...item, met: false })),
    plan: task.plan,
    projectId: task.projectId,
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
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = notProposal(writable(activeTask(await loadTask(ctx, identity.userId, input.taskId)), identity));
  const patch: Partial<Doc<"tasks">> = { status: input.status, completedAt: undefined };
  // Only a task in progress can be the "now" task.
  if (input.status !== "doing") patch.isNow = false;
  return toTask(await patchTask(ctx, identity, task, "setStatus", patch, input.clientId));
}

/** Makes one task the single "now" task (status doing); null clears it. */
export async function setNow(ctx: MutationCtx, identity: Identity, input: Args<"setNow">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId ?? undefined);
  if (replayed) return toTask(replayed);
  if (input.taskId === null) {
    await clearNow(ctx, identity);
    return null;
  }
  const task = notProposal(writable(activeTask(await loadTask(ctx, identity.userId, input.taskId)), identity));
  if (task.archivedAt !== undefined) fail("invalid_argument", "Task is archived; restore it first");
  await clearNow(ctx, identity, task._id);
  const patch: Partial<Doc<"tasks">> = { isNow: true, status: "doing", completedAt: undefined };
  if (input.resumeNote !== undefined) patch.resumeNote = checkText("resumeNote", input.resumeNote);
  return toTask(await patchTask(ctx, identity, task, "setNow", patch, input.clientId));
}

export async function archiveTask(ctx: MutationCtx, identity: Identity, input: Args<"archive">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = writable(activeTask(await loadTask(ctx, identity.userId, input.taskId)), identity);
  if (task.archivedAt !== undefined) return toTask(task);
  return toTask(
    await patchTask(ctx, identity, task, "archive", { archivedAt: Date.now(), isNow: false }, input.clientId),
  );
}

/** Moves a task to the trash; it is purged after 30 days unless restored. */
export async function softDeleteTask(ctx: MutationCtx, identity: Identity, input: Args<"softDelete">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = writable(await loadTask(ctx, identity.userId, input.taskId), identity);
  if (task.deletedAt !== undefined) return toTask(task);
  return toTask(
    await patchTask(ctx, identity, task, "delete", { deletedAt: Date.now(), isNow: false }, input.clientId),
  );
}

/** Brings a task back from the trash, or from the archive when not in the trash. */
export async function restoreTask(ctx: MutationCtx, identity: Identity, input: Args<"restore">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = writable(await loadTask(ctx, identity.userId, input.taskId), identity);
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
    // Its sources may make a task again once it is gone for good.
    const sources = await ctx.db
      .query("taskSources")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .collect();
    for (const source of sources) await ctx.db.delete(source._id);
    await ctx.db.delete(task._id);
  }
  return { purged: expired.length, more: expired.length === PURGE_BATCH };
}
