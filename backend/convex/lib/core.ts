// Shared building blocks of the domain layer: identity, errors, history,
// idempotency, settings and the public shape of a task.
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isValidDate, isValidTime, localDate, resolveDate } from "./dates";
import { validateRepeat } from "./repeat";
import type { Actor, Link, RepeatRule } from "./validators";

/**
 * Who is acting. Thin layers (app, MCP) establish it; the domain trusts it.
 * Changes made with an API key also carry the key's id and name.
 */
export type Identity = { userId: string; actor: Actor; keyId?: Id<"apiKeys">; actorName?: string };

/** The identity part of an internal function's arguments. */
export function identityOf({ userId, actor, keyId, actorName }: Identity): Identity {
  return { userId, actor, keyId, actorName };
}

/** How history shows who made a change: "app", "cli", "agent" or "agent: <key name>". */
export function actorLabel(event: { actor: Actor; actorName?: string }): string {
  return event.actor === "agent" && event.actorName ? `agent: ${event.actorName}` : event.actor;
}

export type ErrorCode = "invalid_argument" | "not_found" | "unauthenticated";

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

/** A task as returned to clients: stable `id` and `ref`, no internal fields. */
export function toTask(doc: Doc<"tasks">) {
  const { _id, _creationTime, userId, ...fields } = doc;
  return { id: _id, ...fields };
}
export type TaskView = ReturnType<typeof toTask>;

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
  await ctx.db.insert("taskEvents", {
    userId: identity.userId,
    actor: identity.actor,
    keyId: identity.keyId,
    actorName: identity.actorName,
    at: Date.now(),
    ...event,
  });
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

// ---- Input checks shared by all operations ----

const LIMITS = { title: 500, note: 20_000, resumeNote: 2_000, label: 50, labels: 20, links: 20, url: 2_048, clientId: 128 };

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

export function checkRepeat(rule: RepeatRule): RepeatRule {
  const error = validateRepeat(rule);
  if (error) fail("invalid_argument", error);
  return rule;
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
