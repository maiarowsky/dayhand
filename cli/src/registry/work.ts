// Agent work (docs/agent-work.md, backend 0.10.0): the activity log, claims,
// acceptance criteria and proof of completion. One MCP tool per command, as elsewhere.
import { usageError } from "../core/exit.js";
import { describeChange, formatTimestamp, refOf } from "../render/format.js";
import type { Detail, Link, Task } from "../render/model.js";
import { instantOf } from "../when/calendar.js";
import { itemIndexes } from "./model.js";
import { tool, userTimezone } from "./ops.js";
import { parseLink, resolveRef } from "./parse.js";
import type { CommandSpec, OptSpec, Opts, RunContext } from "./types.js";

const REF = { name: "ref", description: "Task: #42 or 42 (its number), now, or its id", required: true };

export type Criterion = { id?: string; text: string; met?: boolean };
type Check = { name: string; result: "pass" | "fail"; url?: string };
export type EventEntry = {
  id: string;
  at: number;
  taskId: string | null;
  ref: number | null;
  title: string | null;
  action: string;
  by: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
type EventList = { events: EventEntry[]; nextCursor: string; hasMore: boolean };

// ---- dayhand log ----

const AGO = /^(\d{1,6})\s*(m|min|h|d)$/i;
const AGO_MS: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * --since as list_events takes it: a cursor ("c…"), Unix milliseconds and ISO
 * times pass through; "30m", "2h", "3d" mean that long ago; anything else is a
 * date phrase (yesterday, mon 09:00) read in the user's time zone.
 */
export async function sinceArg(ctx: RunContext, text: string, now = Date.now()): Promise<string> {
  const value = text.trim();
  if (/^c\d+$/.test(value) || /^\d+$/.test(value) || /^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const ago = AGO.exec(value);
  if (ago) return String(now - Number(ago[1]) * AGO_MS[ago[2]!.toLowerCase()]!);
  const when = await ctx.when(value);
  return String(instantOf({ date: when.date, time: when.time ?? "00:00" }, await ctx.zone()));
}

/** One line per change, and how to continue from here. */
export function logText(log: EventList, timezone?: string): string {
  const lines = log.events.map((e) => {
    const task = e.ref !== null ? `#${e.ref}` : (e.taskId ?? "");
    const change = e.after ? `  ${describeChange(e.before, e.after)}` : "";
    return `${formatTimestamp(e.at, timezone)}  ${task} ${e.title ?? ""}  ${e.action} by ${e.by}${change}`;
  });
  if (lines.length === 0) lines.push("(no changes)");
  lines.push(log.hasMore ? `more: dayhand log --since ${log.nextCursor}` : `next time: dayhand log --since ${log.nextCursor}`);
  return lines.join("\n");
}

const log: CommandSpec = {
  name: "log",
  schema: "event-list.schema.json",
  summary: "The activity log: task changes after a cursor or a time, oldest first (who changed what)",
  description:
    "Without --since: the newest changes. Keep nextCursor and pass it as --since next time to see only what changed meanwhile; hasMore says there are more already.",
  options: [
    { flags: "--since <from>", description: "nextCursor of an earlier log (c…), a time ago (30m, 2h, 3d), a date phrase (yesterday, mon 09:00) or an ISO time" },
    { flags: "--by <actor>", description: 'Only changes by app, cli, agent (any agent) or "agent: <name>"' },
    { flags: "--task <ref>", description: "Only changes of this task" },
    { flags: "--limit <n>", description: "At most this many changes, 1 to 500 (default 100)", kind: "int" },
  ],
  tools: ["list_events"],
  examples: ["dayhand log", "dayhand log --since 2h --by cli", "dayhand log --since c1793011200000123 --json", 'dayhand log --task 42 --by "agent: claude-code"'],
  run: async (ctx, _args, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.since !== undefined) input.since = await sinceArg(ctx, String(opts.since));
    if (opts.by !== undefined) input.by = opts.by;
    if (opts.task !== undefined) input.taskId = await resolveRef(ctx, String(opts.task));
    if (opts.limit !== undefined) input.limit = opts.limit;
    const [value, timezone] = await Promise.all([tool<EventList>(ctx, "list_events", input), userTimezone(ctx)]);
    return { value, view: { kind: "text", text: logText(value, timezone) } };
  },
};

// ---- Claims ----

const MINUTES: OptSpec = { flags: "--minutes <n>", description: "Length of the claim in minutes from now, 1 to 1440 (default 120)", kind: "int" };

/** "Claimed until 14:30" in the user's time zone. */
async function claimVerb(ctx: RunContext, verb: string, task: Task): Promise<string> {
  const until = task.claimExpiresAt;
  if (typeof until !== "number") return verb;
  return `${verb} until ${formatTimestamp(until, await userTimezone(ctx))}`;
}

const claimCommands: CommandSpec[] = [
  {
    name: "claim",
    schema: "task.schema.json",
    summary: "Claim a task for a while (default 120 minutes) so other agents leave it alone",
    description: "While the claim lasts another agent's changes and claims of the task fail with conflict (exit 6). Claiming it again extends your claim.",
    args: [REF],
    options: [MINUTES],
    tools: ["claim_task"],
    fields: "task",
    examples: ["dayhand claim 42", "dayhand claim 42 --minutes 30 --json"],
    run: async (ctx, args, opts) => {
      const input: Record<string, unknown> = { taskId: await resolveRef(ctx, args.ref as string), clientId: ctx.clientId() };
      if (opts.minutes !== undefined) input.minutes = opts.minutes;
      const task = await tool<Task>(ctx, "claim_task", input);
      return { value: task, view: { kind: "task", verb: await claimVerb(ctx, "Claimed", task), task } };
    },
  },
  {
    name: "renew",
    schema: "task.schema.json",
    summary: "Extend your claim of a task by --minutes from now (default 120)",
    args: [REF],
    options: [MINUTES],
    tools: ["renew_claim"],
    fields: "task",
    examples: ["dayhand renew 42", "dayhand renew 42 --minutes 60"],
    run: async (ctx, args, opts) => {
      const input: Record<string, unknown> = { taskId: await resolveRef(ctx, args.ref as string), clientId: ctx.clientId() };
      if (opts.minutes !== undefined) input.minutes = opts.minutes;
      const task = await tool<Task>(ctx, "renew_claim", input);
      return { value: task, view: { kind: "task", verb: await claimVerb(ctx, "Claim renewed", task), task } };
    },
  },
  {
    name: "release",
    schema: "task.schema.json",
    summary: "End your claim of a task, optionally leaving a checkpoint as its resume note",
    args: [REF],
    options: [{ flags: "--note <text>", description: "Checkpoint: where you stopped and the next step (saved as the resume note)" }],
    tools: ["release_task"],
    fields: "task",
    examples: ["dayhand release 42", 'dayhand release 42 --note "tables migrated; indexes next"'],
    run: async (ctx, args, opts) => {
      const input: Record<string, unknown> = { taskId: await resolveRef(ctx, args.ref as string), clientId: ctx.clientId() };
      if (opts.note !== undefined) input.note = opts.note;
      const task = await tool<Task>(ctx, "release_task", input);
      return { value: task, view: { kind: "task", verb: "Released", task } };
    },
  },
];

// ---- Acceptance criteria ----

/** "#42 Ship (1/2)" and the numbered criteria, as `dayhand criteria` prints them. */
export function criteriaText(task: Task): string {
  const items = (task.acceptance as Criterion[] | undefined) ?? [];
  if (items.length === 0) return `${refOf(task)} ${task.title}: (no acceptance criteria)`;
  const met = items.filter((item) => item.met).length;
  return [`${refOf(task)} ${task.title} (${met}/${items.length} met)`, ...items.map((item, i) => `  ${i + 1}. ${item.met ? "[x]" : "[ ]"} ${item.text}`)].join("\n");
}

/** Applies `dayhand criteria` options in a fixed order: met, unmet, remove, then add. Ids are kept. */
export function editCriteria(items: Criterion[], opts: Opts): Criterion[] {
  const mark = (texts: unknown, met: boolean, list: Criterion[]) => {
    const picked = new Set(itemIndexes(texts as string[], list.length, "acceptance criteria"));
    return list.map((item, i) => (picked.has(i) ? { ...item, met } : item));
  };
  let result = mark(opts.unmet, false, mark(opts.met, true, items));
  const removed = new Set(itemIndexes(opts.rm as string[], result.length, "acceptance criteria"));
  result = result.filter((_, i) => !removed.has(i));
  return [...result, ...criteriaOf(opts.add as string[])];
}

/** --accept texts as new criteria. */
export const criteriaOf = (texts: string[]): Criterion[] => texts.map((text) => ({ text }));

const criteria: CommandSpec = {
  name: "criteria",
  schema: ["task-detail.schema.json", "task.schema.json"],
  summary: "Print a task's acceptance criteria, or mark them met, unmet, remove and add them",
  description: "Criteria are numbered from 1 as printed. Changes apply in this order: --met, --unmet, --rm, then --add. An agent can complete a task only when every criterion is met.",
  args: [REF],
  options: [
    { flags: "--add <text>", description: "Add a criterion at the end (repeatable)", kind: "list" },
    { flags: "--met <n>", description: "Mark criteria met: 2, 1,3 or all (repeatable)", kind: "list" },
    { flags: "--unmet <n>", description: "Mark criteria not met (repeatable)", kind: "list" },
    { flags: "--rm <n>", description: "Remove criteria (repeatable)", kind: "list" },
    { flags: "--clear", description: "Remove all criteria" },
  ],
  tools: ["get_task", "update_task"],
  fields: "task",
  examples: ["dayhand criteria 42", 'dayhand criteria 42 --add "Tests pass" --add "Docs updated"', "dayhand criteria 42 --met 1,2"],
  run: async (ctx, args, opts) => {
    const taskId = await resolveRef(ctx, args.ref as string);
    const detail = await tool<Detail>(ctx, "get_task", { taskId });
    const edits = ["add", "met", "unmet", "rm"].some((name) => (opts[name] as string[]).length > 0);
    if (!edits && !opts.clear) return { value: detail, view: { kind: "text", text: criteriaText(detail.task) } };
    if (edits && opts.clear) throw usageError("--clear cannot be combined with other changes");
    const acceptance = opts.clear ? null : editCriteria((detail.task.acceptance as Criterion[] | undefined) ?? [], opts);
    const task = await tool<Task>(ctx, "update_task", { taskId, acceptance, clientId: ctx.clientId() });
    return { value: task, view: { kind: "text", text: criteriaText(task) } };
  },
};

// ---- Proof of completion (dayhand done) ----

export const PROOF_OPTIONS: OptSpec[] = [
  { flags: "--summary <text>", description: "Proof: what was done (an agent needs it for a task with acceptance criteria)" },
  { flags: "--check <check>", description: 'Proof: a check and its result, "<name>=pass" or "<name>=fail", optionally followed by a URL (repeatable)', kind: "list" },
  { flags: "--proof-link <url>", description: 'Proof: where to see the result, "https://… Title" (repeatable)', kind: "list" },
];

const CHECK = /^(.+?)=(pass|fail)(?:\s+(\S+))?$/i;

export function parseCheck(text: string): Check {
  const match = CHECK.exec(text.trim());
  if (!match) throw usageError(`--check takes <name>=pass or <name>=fail, optionally followed by a URL, got "${text}"`);
  const check: Check = { name: match[1]!.trim(), result: match[2]!.toLowerCase() as Check["result"] };
  return match[3] ? { ...check, url: match[3] } : check;
}

/** The proof of `dayhand done`, or undefined when no proof option was given. */
export function proofInput(opts: Opts): { summary?: string; links?: Link[]; checks?: Check[] } | undefined {
  const checks = ((opts.check as string[] | undefined) ?? []).map(parseCheck);
  const links = ((opts.proofLink as string[] | undefined) ?? []).map(parseLink);
  if (opts.summary === undefined && checks.length === 0 && links.length === 0) return undefined;
  return {
    ...(opts.summary !== undefined ? { summary: String(opts.summary) } : {}),
    ...(links.length ? { links } : {}),
    ...(checks.length ? { checks } : {}),
  };
}

export const workCommands: CommandSpec[] = [log, ...claimCommands, criteria];
