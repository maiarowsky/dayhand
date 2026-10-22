// `hlm list` filters, applied by the CLI to the list_all result. The JSON
// keeps its shape ({"result": [...]}) with fewer tasks; like --fields this is
// a documented narrowing of the tool's structuredContent.
import { usageError } from "../core/exit.js";
import type { Task } from "../render/model.js";
import type { OptSpec, Opts, RunContext } from "./types.js";

const STATUSES = ["todo", "doing", "done"];

export const FILTER_OPTIONS: OptSpec[] = [
  { flags: "--status <statuses>", description: "Only these statuses, comma-separated: todo, doing, done (done implies --done)" },
  { flags: "--overdue", description: "Only overdue tasks" },
  { flags: "--due-before <when>", description: "Only tasks due before this day, e.g. eow, next mon, 2026-11-01" },
  { flags: "--due-after <when>", description: "Only tasks due after this day, e.g. today" },
  { flags: "--search <text>", description: "Only tasks whose title, note, resume note or labels contain the text (any case)" },
  { flags: "--limit <n>", description: "At most this many tasks", kind: "int" },
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
  ["status", "overdue", "dueBefore", "dueAfter", "search", "limit"].some((k) => opts[k] !== undefined);

export async function taskFilter(ctx: RunContext, opts: Opts): Promise<(tasks: Task[]) => Task[]> {
  const statuses = parseStatuses(opts.status);
  const [before, after] = await Promise.all(
    [opts.dueBefore, opts.dueAfter].map(async (text) => (text === undefined ? undefined : (await ctx.when(String(text))).date)),
  );
  const needle = opts.search === undefined ? undefined : String(opts.search).toLowerCase();
  const matches = (task: Task) =>
    (!statuses || statuses.includes(task.status)) &&
    (!opts.overdue || task.overdue === true) &&
    (before === undefined || (task.dueDate !== undefined && task.dueDate < before)) &&
    (after === undefined || (task.dueDate !== undefined && task.dueDate > after)) &&
    (needle === undefined || [task.title, task.note, task.resumeNote, ...task.labels].some((t) => t?.toLowerCase().includes(needle)));
  return (tasks) => {
    const kept = tasks.filter(matches);
    return opts.limit === undefined ? kept : kept.slice(0, opts.limit as number);
  };
}
