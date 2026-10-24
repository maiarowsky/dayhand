// The activity log (list_events, dayhand://activity, dayhand log): the user's
// task changes in the order they were committed, read from a position on, so
// an agent back from a pause gets only what changed since its own cursor.
// Positions are taskEvents.seq (lib/core.ts recordEvent); a cursor is
// "c<seq>" and means "after this change".
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { actorLabel, fail, loadTask, type Identity } from "./core";

type Args = ObjectType<(typeof args)["listEvents"]>;

export const MAX_EVENTS = 500;
const DEFAULT_EVENTS = 100;
/** Changes looked at per call when filters skip most of them; the cursor continues from there. */
const SCAN_LIMIT = 4_000;

const CURSOR = /^c(\d{1,17})$/;
const UNIX_MS = /^\d{1,15}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export const cursorOf = (seq: number) => `c${seq}`;

/**
 * The position to read after: a cursor from an earlier call, or a time (Unix
 * milliseconds or ISO 8601 with a zone) meaning the changes made from then on.
 */
function positionOf(since: string): number {
  const cursor = CURSOR.exec(since);
  if (cursor) return Number(cursor[1]);
  const at = UNIX_MS.test(since) ? Number(since) : ISO_TIME.test(since) ? Date.parse(since) : NaN;
  if (Number.isNaN(at)) {
    fail("invalid_argument", `since must be a cursor from an earlier call ("c…"), Unix milliseconds or an ISO 8601 time, got "${since}"`);
  }
  // Positions start from the change's time in microseconds (lib/core.ts).
  return at * 1000 - 1;
}

type ActorFilter = (event: Doc<"taskEvents">) => boolean;

/** "app", "cli", "agent" (any agent) or "agent: <name>" (one key or connection, as history's `by`). */
function actorFilter(by: string | undefined): ActorFilter {
  if (by === undefined) return () => true;
  const wanted = by.trim();
  if (wanted === "app" || wanted === "cli" || wanted === "agent") return (event) => event.actor === wanted;
  if (/^agent: .+/.test(wanted)) return (event) => actorLabel(event) === wanted;
  return fail("invalid_argument", `by must be app, cli, agent or "agent: <name>", got "${by}"`);
}

function checkLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_EVENTS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS) fail("invalid_argument", `limit must be a whole number from 1 to ${MAX_EVENTS}`);
  return limit;
}

async function view(ctx: QueryCtx, event: Doc<"taskEvents">) {
  const task = event.taskId ? await ctx.db.get(event.taskId) : null;
  return {
    id: event._id,
    at: event.at,
    taskId: event.taskId ?? null,
    ref: task?.ref ?? null,
    title: task?.title ?? null,
    action: event.action,
    actor: event.actor,
    actorName: event.actorName ?? null,
    by: actorLabel(event),
    before: event.before ?? null,
    after: event.after ?? null,
  };
}

/** The newest position in the user's log, or 0 before the first task change. */
async function head(ctx: QueryCtx, userId: string): Promise<number> {
  const last = await ctx.db
    .query("taskEvents")
    .withIndex("by_user_seq", (q) => q.eq("userId", userId).gt("seq", 0))
    .order("desc")
    .first();
  return last?.seq ?? 0;
}

type Page = { events: Doc<"taskEvents">[]; position: number; hasMore: boolean };

/** Changes after `after`, oldest first; stops at `limit` matches or SCAN_LIMIT looked at. */
async function forward(ctx: QueryCtx, userId: string, after: number, limit: number, matches: ActorFilter): Promise<Page> {
  const events: Doc<"taskEvents">[] = [];
  let position = after;
  let scanned = 0;
  for await (const event of ctx.db
    .query("taskEvents")
    .withIndex("by_user_seq", (q) => q.eq("userId", userId).gt("seq", after))) {
    if (events.length >= limit || scanned >= SCAN_LIMIT) return { events, position, hasMore: true };
    scanned++;
    position = event.seq!;
    if (matches(event)) events.push(event);
  }
  return { events, position, hasMore: false };
}

/** The newest `limit` matching changes, oldest first, among the last SCAN_LIMIT. */
async function latest(ctx: QueryCtx, userId: string, limit: number, matches: ActorFilter): Promise<Page> {
  const events: Doc<"taskEvents">[] = [];
  let scanned = 0;
  for await (const event of ctx.db
    .query("taskEvents")
    .withIndex("by_user_seq", (q) => q.eq("userId", userId).gt("seq", 0))
    .order("desc")) {
    if (events.length >= limit || scanned >= SCAN_LIMIT) break;
    scanned++;
    if (matches(event)) events.push(event);
  }
  return { events: events.reverse(), position: await head(ctx, userId), hasMore: false };
}

/** One task's changes: few enough to read whole, then narrowed like the user's log. */
async function ofTask(ctx: QueryCtx, userId: string, taskId: Id<"tasks">, after: number | null, limit: number, matches: ActorFilter): Promise<Page> {
  const all = (
    await ctx.db
      .query("taskEvents")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect()
  )
    .filter((e) => e.seq !== undefined && matches(e))
    .sort((a, b) => a.seq! - b.seq!);
  if (after === null) return { events: all.slice(-limit), position: await head(ctx, userId), hasMore: false };
  const rest = all.filter((e) => e.seq! > after);
  const events = rest.slice(0, limit);
  const position = events.length > 0 ? events[events.length - 1]!.seq! : Math.max(after, 0);
  return { events, position, hasMore: rest.length > events.length };
}

/**
 * Task changes after `since`, oldest first, with the cursor to pass as
 * `since` next time. Without `since`: the newest changes and the cursor of
 * the newest one, to start following the log from now.
 */
export async function listEvents(ctx: QueryCtx, identity: Identity, input: Args) {
  const limit = checkLimit(input.limit);
  const matches = actorFilter(input.by);
  const after = input.since === undefined ? null : positionOf(input.since.trim());
  let page: Page;
  if (input.taskId !== undefined) {
    const task = await loadTask(ctx, identity.userId, input.taskId);
    page = await ofTask(ctx, identity.userId, task._id, after, limit, matches);
  } else if (after === null) {
    page = await latest(ctx, identity.userId, limit, matches);
  } else {
    page = await forward(ctx, identity.userId, after, limit, matches);
  }
  const events = [];
  for (const event of page.events) events.push(await view(ctx, event));
  return { events, nextCursor: cursorOf(Math.max(page.position, 0)), hasMore: page.hasMore };
}
