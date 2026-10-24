// Shared building blocks of the domain layer: identity, errors, history,
// idempotency, settings and the public shape of a task.
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isValidDate, isValidTime, localDate, resolveDate } from "./dates";
import { validateRepeat } from "./repeat";
import { RRuleError, parseRRule, toRRule } from "./rrule";
import { queueTaskEvents } from "./webhookEvents";
import type { Actor, ChecklistInput, ChecklistItem, Link, Reminder, RepeatInput, RepeatRule } from "./validators";

/**
 * Who is acting. Thin layers (app, MCP) establish it; the domain trusts it.
 * Changes made with an API key also carry the key's id and name; changes made
 * through an OAuth connection carry the connection's id and the client's name.
 */
export type Identity = {
  userId: string;
  actor: Actor;
  keyId?: Id<"apiKeys">;
  connectionId?: Id<"oauthGrants">;
  actorName?: string;
};

/** The identity part of an internal function's arguments. */
export function identityOf({ userId, actor, keyId, connectionId, actorName }: Identity): Identity {
  return { userId, actor, keyId, connectionId, actorName };
}

/** How history shows who made a change: "app", "cli", "agent" or "agent: <key or client name>". */
export function actorLabel(event: { actor: Actor; actorName?: string }): string {
  return event.actor === "agent" && event.actorName ? `agent: ${event.actorName}` : event.actor;
}

// conflict (since 0.10.0): another agent holds the task's claim (claim_task).
export type ErrorCode = "invalid_argument" | "not_found" | "unauthenticated" | "precondition_failed" | "conflict";

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

export const DEFAULT_SETTINGS = {
  timezone: "Europe/London",
  summaryTime: "05:00",
  defaultReminderMinutes: [0],
};

export type Settings = typeof DEFAULT_SETTINGS;

export async function loadSettings(ctx: QueryCtx, userId: string): Promise<Settings> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    timezone: row.timezone,
    summaryTime: row.summaryTime,
    defaultReminderMinutes: row.defaultReminderMinutes,
  };
}

export async function todayFor(ctx: QueryCtx, userId: string, at: number): Promise<string> {
  const { timezone } = await loadSettings(ctx, userId);
  return localDate(at, timezone);
}

/**
 * A task as returned to clients: stable `id` and `ref`, no internal fields.
 * A repeating task also carries its rule as an RFC 5545 RRULE (`rrule`).
 */
export function toTask(doc: Doc<"tasks">) {
  const { _id, _creationTime, userId, ...fields } = doc;
  return fields.repeat ? { id: _id, ...fields, rrule: toRRule(fields.repeat, fields.dueDate) } : { id: _id, ...fields };
}
export type TaskView = ReturnType<typeof toTask>;

/**
 * The version of a stored task as an HTTP entity tag (RFC 9110): it changes
 * with every change to the task. Derived fields such as `overdue` are not part of it.
 */
export const versionTag = (task: { updatedAt: number }) => `"${task.updatedAt}"`;

const TASK_REF = /^#(\d{1,15})$/;

/** Loads one of the user's tasks by its id or by its number written as "#42". */
export async function loadTask(ctx: QueryCtx, userId: string, taskId: string) {
  const ref = TASK_REF.exec(taskId);
  if (ref) {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_user_ref", (q) => q.eq("userId", userId).eq("ref", Number(ref[1])))
      .first();
    if (!task) fail("not_found", `Task #${Number(ref[1])} not found`);
    return task;
  }
  const id = ctx.db.normalizeId("tasks", taskId);
  if (!id) fail("invalid_argument", `Invalid arguments: taskId must be a task id or "#<number>", got "${taskId}"`);
  const task = await ctx.db.get(id);
  if (!task || task.userId !== userId) fail("not_found", `Task ${taskId} not found`);
  return task;
}

/** Gives the user's next task number. Numbers start at 1 and are never given twice. */
export async function nextTaskRef(ctx: MutationCtx, userId: string): Promise<number> {
  const counter = await ctx.db
    .query("taskCounters")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const ref = (counter?.lastRef ?? 0) + 1;
  if (counter) await ctx.db.patch(counter._id, { lastRef: ref });
  else await ctx.db.insert("taskCounters", { userId, lastRef: ref });
  return ref;
}

/**
 * The next position in the user's activity log (taskEvents.seq). It starts
 * from the change's time in microseconds and grows by one past the last
 * position, so it follows the order changes commit even when two changes
 * share a millisecond: every task change reads and writes the counter, and
 * Convex runs such mutations one after the other.
 */
async function nextEventSeq(ctx: MutationCtx, userId: string, at: number): Promise<number> {
  const counter = await ctx.db
    .query("eventCounters")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const seq = Math.max((counter?.lastSeq ?? 0) + 1, at * 1000);
  if (counter) await ctx.db.patch(counter._id, { lastSeq: seq });
  else await ctx.db.insert("eventCounters", { userId, lastSeq: seq });
  return seq;
}

export async function recordEvent(
  ctx: MutationCtx,
  identity: Identity,
  event: {
    taskId?: Id<"tasks">;
    action: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    clientId?: string;
  },
) {
  const at = Date.now();
  const eventId = await ctx.db.insert("taskEvents", {
    userId: identity.userId,
    actor: identity.actor,
    keyId: identity.keyId,
    connectionId: identity.connectionId,
    actorName: identity.actorName,
    at,
    // Only changes of a task enter the activity log (list_events).
    seq: event.taskId ? await nextEventSeq(ctx, identity.userId, at) : undefined,
    ...event,
  });
  // A change of a task is also an event for the user's webhooks (lib/webhookEvents.ts).
  if (event.taskId) {
    const { taskId, action, before, after } = event;
    const { userId, actor, actorName } = identity;
    await queueTaskEvents(ctx, { userId, eventId, taskId, action, at, actor, actorName, before, after }, toTask);
  }
}

/** Changed fields of `patch` relative to `doc`, as before/after maps. */
export function diff<T extends Record<string, unknown>>(doc: T, patch: Partial<T>) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "updatedAt") continue;
    if (JSON.stringify(doc[key]) !== JSON.stringify(value)) {
      before[key] = doc[key] ?? null;
      after[key] = value ?? null;
    }
  }
  return { before, after, changed: Object.keys(after).length > 0 };
}

/** Applies a patch to a task and records it in history when anything changed. */
export async function patchTask(
  ctx: MutationCtx,
  identity: Identity,
  task: Doc<"tasks">,
  action: string,
  patch: Partial<Doc<"tasks">>,
  clientId?: string,
) {
  const { before, after, changed } = diff(task, patch);
  if (!changed) return task;
  await ctx.db.patch(task._id, { ...patch, updatedAt: Date.now() });
  await recordEvent(ctx, identity, { taskId: task._id, action, before, after, clientId });
  return (await ctx.db.get(task._id))!;
}

/** The event of an operation already applied with this clientId, if any. */
export async function appliedOperation(ctx: QueryCtx, userId: string, clientId?: string) {
  if (clientId === undefined) return null;
  return ctx.db
    .query("taskEvents")
    .withIndex("by_user_clientId", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .first();
}

/** Current state of the task touched by an already applied operation, or null. */
export async function replay(ctx: MutationCtx, userId: string, clientId?: string) {
  const event = await appliedOperation(ctx, userId, checkClientId(clientId));
  if (!event) return null;
  const task = event.taskId ? await ctx.db.get(event.taskId) : null;
  if (!task) fail("not_found", "Task of this operation no longer exists");
  return task;
}

// ---- Input checks shared by all operations ----

const LIMITS = {
  title: 500,
  note: 20_000,
  resumeNote: 2_000,
  label: 50,
  labels: 20,
  links: 20,
  url: 2_048,
  clientId: 128,
  checklist: 100,
  checklistId: 64,
  reminders: 5,
  reminderMinutes: 7 * 24 * 60,
  reminderDays: 30,
};

export function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) fail("invalid_argument", "title must not be empty");
  if (trimmed.length > LIMITS.title) fail("invalid_argument", `title is longer than ${LIMITS.title} characters`);
  return trimmed;
}

export function checkText(field: "note" | "resumeNote", value: string): string | undefined {
  if (value.length > LIMITS[field]) fail("invalid_argument", `${field} is longer than ${LIMITS[field]} characters`);
  return value.trim() === "" ? undefined : value;
}

export function checkDueDate(value: string, today: string): string {
  const resolved = resolveDate(value, today);
  if (!resolved) fail("invalid_argument", `dueDate must be YYYY-MM-DD, "today" or "tomorrow", got "${value}"`);
  return resolved;
}

export function checkDueTime(value: string): string {
  if (!isValidTime(value)) fail("invalid_argument", `dueTime must be HH:MM (24h), got "${value}"`);
  return value;
}

export function checkLabels(labels: string[]): string[] {
  const cleaned = [...new Set(labels.map((l) => l.trim()).filter((l) => l !== ""))];
  if (cleaned.length > LIMITS.labels) fail("invalid_argument", `at most ${LIMITS.labels} labels`);
  if (cleaned.some((l) => l.length > LIMITS.label)) fail("invalid_argument", `labels are at most ${LIMITS.label} characters`);
  return cleaned;
}

export function checkLinks(links: Link[]): Link[] {
  if (links.length > LIMITS.links) fail("invalid_argument", `at most ${LIMITS.links} links`);
  return links.map((link) => {
    let parsed: URL;
    try {
      parsed = new URL(link.url);
    } catch {
      fail("invalid_argument", `invalid link URL "${link.url}"`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || link.url.length > LIMITS.url) {
      fail("invalid_argument", `links must be http(s) URLs up to ${LIMITS.url} characters`);
    }
    const title = link.title?.trim();
    return title ? { url: link.url, title } : { url: link.url };
  });
}

/** A rule object, or an RFC 5545 RRULE string read in the user's time zone. */
export function checkRepeat(input: RepeatInput, timezone: string): RepeatRule {
  if (typeof input === "string") {
    try {
      return parseRRule(input, timezone);
    } catch (error) {
      if (error instanceof RRuleError) fail("invalid_argument", `repeat: ${error.message}`);
      throw error;
    }
  }
  const error = validateRepeat(input);
  if (error) fail("invalid_argument", error);
  return input;
}

/**
 * The checklist as stored: trimmed titles in the given order, `done` false
 * unless set, and an id for every item. New items get the next free `c<n>`.
 * An empty list is no checklist.
 */
export function checkChecklist(items: ChecklistInput[]): ChecklistItem[] | undefined {
  if (items.length > LIMITS.checklist) fail("invalid_argument", `at most ${LIMITS.checklist} checklist items`);
  const given = items.map((item) => item.id).filter((id): id is string => id !== undefined);
  if (given.some((id) => id.trim() === "" || id.length > LIMITS.checklistId)) {
    fail("invalid_argument", `checklist item ids must be 1 to ${LIMITS.checklistId} characters`);
  }
  if (new Set(given).size !== given.length) fail("invalid_argument", "checklist item ids must be distinct");
  const used = new Set(given);
  let next = 1;
  const freeId = () => {
    while (used.has(`c${next}`)) next++;
    used.add(`c${next}`);
    return `c${next}`;
  };
  const checked = items.map((item) => {
    const title = item.title.trim();
    if (!title) fail("invalid_argument", "checklist items need a title");
    if (title.length > LIMITS.title) fail("invalid_argument", `checklist items are at most ${LIMITS.title} characters`);
    return { id: item.id ?? "", title, done: item.done ?? false };
  });
  const result = checked.map((item) => (item.id ? item : { ...item, id: freeId() }));
  return result.length > 0 ? result : undefined;
}

/** Reminders as stored: checked, without duplicates, `daysBefore` only when not 0. Empty = none. */
export function checkReminders(reminders: Reminder[]): Reminder[] {
  if (reminders.length > LIMITS.reminders) fail("invalid_argument", `at most ${LIMITS.reminders} reminders per task`);
  const seen = new Set<string>();
  const result: Reminder[] = [];
  for (const reminder of reminders) {
    let clean: Reminder;
    if ("minutesBefore" in reminder) {
      const m = reminder.minutesBefore;
      if (!Number.isInteger(m) || m < 0 || m > LIMITS.reminderMinutes) {
        fail("invalid_argument", `reminders: minutesBefore must be whole minutes from 0 to ${LIMITS.reminderMinutes}`);
      }
      clean = { minutesBefore: m };
    } else {
      if (!isValidTime(reminder.time)) fail("invalid_argument", `reminders: time must be HH:MM (24h), got "${reminder.time}"`);
      const days = reminder.daysBefore ?? 0;
      if (!Number.isInteger(days) || days < 0 || days > LIMITS.reminderDays) {
        fail("invalid_argument", `reminders: daysBefore must be a whole number from 0 to ${LIMITS.reminderDays}`);
      }
      clean = days === 0 ? { time: reminder.time } : { time: reminder.time, daysBefore: days };
    }
    const key = JSON.stringify(clean);
    if (!seen.has(key)) result.push(clean);
    seen.add(key);
  }
  return result;
}

export function checkClientId(clientId?: string): string | undefined {
  if (clientId !== undefined && (clientId === "" || clientId.length > LIMITS.clientId)) {
    fail("invalid_argument", `clientId must be 1 to ${LIMITS.clientId} characters`);
  }
  return clientId;
}

export function checkSchedule(dueDate: string | undefined, dueTime: string | undefined) {
  if (dueTime !== undefined && dueDate === undefined) {
    fail("invalid_argument", "dueTime needs a dueDate");
  }
  if (dueDate !== undefined && !isValidDate(dueDate)) {
    fail("invalid_argument", `invalid dueDate "${dueDate}"`);
  }
}
