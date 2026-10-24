// list_all through MCP: search, filters and pages over the user's tasks.
// Without `limit` every match is returned, as list_all did before 0.4.0.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { isReady } from "./agentWork";
import { fail, loadSettings, toTask, type Identity } from "./core";
import { isOverdue, localDate, resolveDate } from "./dates";

type Args = ObjectType<(typeof args)["findTasks"]>;

export const MAX_PAGE = 200;
const MAX_QUERY = 200;

// Sort key: due day (undated first), timed before untimed, time, creation, id.
// The cursor is the key of the last task of a page, so pages stay stable
// when tasks are added or removed between calls.
type SortKey = [string, number, string, number, string];

const sortKey = (t: Doc<"tasks">): SortKey => [t.dueDate ?? "", t.dueTime ? 0 : 1, t.dueTime ?? "", t.createdAt, t._id];

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

function encodeCursor(key: SortKey): string {
  return btoa(JSON.stringify(key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): SortKey {
  try {
    const key = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    const types = ["string", "number", "string", "number", "string"];
    if (Array.isArray(key) && key.length === types.length && key.every((part, i) => typeof part === types[i])) {
      return key as SortKey;
    }
  } catch {
    // reported below
  }
  return fail("invalid_argument", "cursor is not valid; start again without it");
}

function checkLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    fail("invalid_argument", `limit must be a whole number from 1 to ${MAX_PAGE}`);
  }
  return limit;
}

function checkDay(field: "dueBefore" | "dueAfter", value: string | undefined, today: string): string | undefined {
  if (value === undefined) return undefined;
  const day = resolveDate(value, today);
  if (!day) fail("invalid_argument", `${field} must be YYYY-MM-DD, "today" or "tomorrow", got "${value}"`);
  return day;
}

function checkQuery(query: string | undefined): string | undefined {
  if (query === undefined) return undefined;
  if (query.length > MAX_QUERY) fail("invalid_argument", `query is longer than ${MAX_QUERY} characters`);
  const needle = query.trim().toLowerCase();
  return needle === "" ? undefined : needle;
}

/**
 * A predicate for the filters; `status`, when given, decides alone whether done
 * tasks count. `ready` looks the dependencies up among the user's tasks.
 */
function matcher(input: Args, today: string, byId: Map<string, Doc<"tasks">>) {
  const wanted = (input.labels ?? []).map((l) => l.trim()).filter((l) => l !== "");
  const needle = checkQuery(input.query);
  const before = checkDay("dueBefore", input.dueBefore, today);
  const after = checkDay("dueAfter", input.dueAfter, today);
  const statuses = input.status;
  return (t: Doc<"tasks">) =>
    t.deletedAt === undefined &&
    (input.includeArchived || t.archivedAt === undefined) &&
    (statuses ? statuses.includes(t.status) : input.includeDone !== false || t.status !== "done") &&
    wanted.every((label) => t.labels.includes(label)) &&
    (input.overdue === undefined || isOverdue(t, today) === input.overdue) &&
    (input.ready === undefined || isReady(t, byId) === input.ready) &&
    (before === undefined || (t.dueDate !== undefined && t.dueDate < before)) &&
    (after === undefined || (t.dueDate !== undefined && t.dueDate > after)) &&
    (needle === undefined ||
      [t.title, t.note, t.resumeNote, ...t.labels].some((text) => text?.toLowerCase().includes(needle)));
}

/** One page of matching tasks, oldest due first; `total` counts every match. */
export async function findTasks(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const today = localDate(at, (await loadSettings(ctx, identity.userId)).timezone);
  const limit = checkLimit(input.limit);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const matches = matcher(input, today, new Map(tasks.map((t) => [t._id as string, t])));
  const found = tasks
    .filter(matches)
    .map((t) => ({ task: t, key: sortKey(t) }))
    .sort((a, b) => compareKeys(a.key, b.key));
  const rest = after === undefined ? found : found.filter((f) => compareKeys(f.key, after) > 0);
  const page = limit === undefined ? rest : rest.slice(0, limit);
  const more = page.length < rest.length;
  return {
    result: page.map(({ task }) => ({ ...toTask(task), overdue: isOverdue(task, today) })),
    nextCursor: more ? encodeCursor(page[page.length - 1]!.key) : null,
    total: found.length,
  };
}
