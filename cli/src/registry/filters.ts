// `dayhand list` filters. The backend applies them (list_all's query, status,
// dueBefore/dueAfter, overdue, limit and cursor, backend 0.4.0); against an
// older backend dayhand falls back to filtering the full list_all result itself.
// The JSON keeps list_all's shape ({"result": [...]}, plus total and
// nextCursor from a 0.4 backend).
import { CliError, usageError } from "../core/exit.js";
import type { Task } from "../render/model.js";
import { tool } from "./ops.js";
import type { OptSpec, Opts, RunContext } from "./types.js";

const STATUSES = ["todo", "doing", "done"];
/** The backend's largest page. */
const MAX_PAGE = 200;

export const FILTER_OPTIONS: OptSpec[] = [
  { flags: "--status <statuses>", description: "Only these statuses, comma-separated: todo, doing, done (done implies --done)" },
  { flags: "--overdue", description: "Only overdue tasks" },
  { flags: "--ready", description: "Only tasks ready to work on: not done, not blocked, every dependency done (backend 0.10.0)" },
  { flags: "--due-before <when>", description: "Only tasks due before this day, e.g. eow, next mon, 2026-11-01" },
  { flags: "--due-after <when>", description: "Only tasks due after this day, e.g. today" },
  { flags: "--search <text>", description: "Only tasks whose title, note, resume note or labels contain the text (any case)" },
  { flags: "--limit <n>", description: "At most this many tasks; the JSON's nextCursor continues the list", kind: "int" },
  { flags: "--cursor <cursor>", description: "Continue a list cut by --limit: the nextCursor of the previous page" },
];

export function parseStatuses(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  const statuses = String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (statuses.length === 0 || statuses.some((s) => !STATUSES.includes(s))) {
    throw usageError("--status takes todo, doing and/or done, comma-separated", { valid: STATUSES });
  }
  return statuses;
}

export const hasFilters = (opts: Opts) =>
  ["project", "status", "overdue", "ready", "dueBefore", "dueAfter", "search", "limit", "cursor"].some((k) => opts[k] !== undefined);

export type TaskList = { result: Task[]; total?: number; nextCursor?: string | null };

type Filters = { statuses?: string[]; before?: string; after?: string; needle?: string; limit?: number };

async function readFilters(ctx: RunContext, opts: Opts): Promise<Filters> {
  const [before, after] = await Promise.all(
    [opts.dueBefore, opts.dueAfter].map(async (text) => (text === undefined ? undefined : (await ctx.when(String(text))).date)),
  );
  const limit = opts.limit as number | undefined;
  if (limit !== undefined && limit < 1) throw usageError("--limit must be 1 or more");
  const needle = opts.search === undefined ? undefined : String(opts.search);
  return { statuses: parseStatuses(opts.status), before, after, needle, limit };
}

/** A 0.3 backend rejects list_all arguments it does not know. */
const oldBackend = (error: unknown) =>
  error instanceof CliError && error.code === "invalid_argument" && /extra field `(query|status|dueBefore|dueAfter|overdue|ready|limit|cursor)`/.test(error.message);

/** list_all with the filters applied by the backend; pages are fetched until --limit is reached. */
async function serverList(ctx: RunContext, base: Record<string, unknown>, filters: Filters, cursor?: string): Promise<TaskList> {
  const input: Record<string, unknown> = { ...base };
  if (filters.statuses) input.status = filters.statuses;
  if (filters.before !== undefined) input.dueBefore = filters.before;
  if (filters.after !== undefined) input.dueAfter = filters.after;
  if (filters.needle !== undefined) input.query = filters.needle;
  if (filters.limit === undefined) return tool<TaskList>(ctx, "list_all", cursor === undefined ? input : { ...input, cursor });
  const tasks: Task[] = [];
  let page: TaskList;
  let next = cursor;
  do {
    const limit = Math.min(filters.limit - tasks.length, MAX_PAGE);
    page = await tool<TaskList>(ctx, "list_all", { ...input, limit, ...(next === undefined ? {} : { cursor: next }) });
    tasks.push(...page.result);
    next = page.nextCursor ?? undefined;
  } while (next !== undefined && tasks.length < filters.limit);
  return { ...page, result: tasks };
}

/** The same filters applied here, to the full list of a backend older than 0.4.0. */
function localFilter(filters: Filters, opts: Opts): (tasks: Task[]) => Task[] {
  const needle = filters.needle?.toLowerCase();
  const matches = (task: Task) =>
    (!filters.statuses || filters.statuses.includes(task.status)) &&
    (!opts.overdue || task.overdue === true) &&
    (filters.before === undefined || (task.dueDate !== undefined && task.dueDate < filters.before)) &&
    (filters.after === undefined || (task.dueDate !== undefined && task.dueDate > filters.after)) &&
    (needle === undefined || [task.title, task.note, task.resumeNote, ...task.labels].some((t) => t?.toLowerCase().includes(needle)));
  return (tasks) => {
    const kept = tasks.filter(matches);
    return filters.limit === undefined ? kept : kept.slice(0, filters.limit);
  };
}

/** `dayhand list`: list_all narrowed by the filter options. */
export async function listTasks(ctx: RunContext, base: Record<string, unknown>, opts: Opts): Promise<TaskList> {
  if (!hasFilters(opts)) return tool<TaskList>(ctx, "list_all", base);
  const filters = await readFilters(ctx, opts);
  const cursor = opts.cursor === undefined ? undefined : String(opts.cursor);
  const server = { ...base, ...(opts.overdue ? { overdue: true } : {}), ...(opts.ready ? { ready: true } : {}) };
  try {
    return await serverList(ctx, server, filters, cursor);
  } catch (error) {
    if (!oldBackend(error)) throw error;
    if (cursor !== undefined) throw usageError("--cursor needs backend 0.4.0 or later (dayhand version)");
    if (opts.ready) throw usageError("--ready needs backend 0.10.0 or later (dayhand version)");
    const listed = await tool<TaskList>(ctx, "list_all", base);
    return { ...listed, result: localFilter(filters, opts)(listed.result ?? []) };
  }
}
