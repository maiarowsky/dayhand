// The MCP tool catalog: one tool per domain operation, with its input schema
// (from the operation's validators), its output schema (from docs/schemas)
// and its behaviour hints. The order of TOOLS is the order of tools/list.
import type { PropertyValidators } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import { args, dryRunArgs } from "./args";
import { objectSchema } from "./jsonSchema";
import { SCOPES, type Scope } from "./oauthConfig";
import { SCHEMA_DEFS } from "./outputSchemas";

const FIELD_DOCS: Record<string, string> = {
  taskId: 'Task id (the `id` field returned by other tools) or the task number as "#42" (the `ref` field).',
  title: "Short task title.",
  note: "Free-text note. In update_task, null clears it.",
  dueDate: 'Due day as YYYY-MM-DD in the user\'s time zone, or "today" / "tomorrow". Null clears it.',
  dueTime: "Optional due time HH:MM (24h, local). Reminders ring only for timed tasks. Null clears it.",
  status: "todo, doing (in progress) or done.",
  resumeNote: '"Where I stopped / next step" note shown on the Today screen.',
  repeat:
    'Repeat rule: every day/week/month/year with an interval (1 = every time); weekly rules may list weekdays 1 (Mon) to 7 (Sun); monthly rules may set monthDay (1-31, -1 = last day) or weekdayOfMonth {nth: 1-5 or -1 (last), weekday: 1-7}. from: "due" (default, next date after the due date) or "completion" (counted from the day it is done). End with until (YYYY-MM-DD) or count (occurrences left, this one included). Or give an RFC 5545 RRULE string, e.g. "FREQ=MONTHLY;BYDAY=-1FR". Completing a repeating task creates the next occurrence. Null clears it.',
  checklist:
    "Checklist items in order: {title, done?, id?}. The whole list is replaced; keep the ids of existing items (new items get one). Null or [] removes the checklist.",
  reminders:
    'Reminders of this task, replacing the default ones from settings: {minutesBefore} (before the due time; only timed tasks) or {time: "HH:MM", daysBefore?} (on the due day, or that many days before). [] = no reminders; null = back to the defaults.',
  labels: "Labels (projects).",
  links: "Links attached to the task (URL and optional title). Files are not supported.",
  clientId:
    "Optional unique id of this operation (e.g. a UUID). Retrying with the same clientId does not apply the change twice.",
  dryRun:
    "true: check the change and return what it would produce, marked dryRun: true, without saving anything (no history entry either). A new task's id and number are not reserved.",
  at: "Evaluate as of this Unix time in milliseconds (default: now).",
  includeDone: "Include done tasks (default true).",
  includeArchived: "Include archived tasks (default false).",
  doneLimit: "Maximum number of tasks in the done column (default 50).",
  format: "markdown (readable) or json (full copy including history).",
  timezone: 'IANA time zone, e.g. "Europe/London". Decides what "today" and "overdue" mean.',
  summaryTime: "Time of the morning summary, HH:MM.",
  defaultReminderMinutes: "Default reminders for timed tasks, in minutes before the due time (0 = at the time).",
};

const FIND_DOCS: Record<string, string> = {
  labels: "Only tasks having all of these labels.",
  includeDone: "Include done tasks (default true). Ignored when status is given.",
  query: "Only tasks whose title, note, resume note or labels contain this text (any case).",
  status: "Only tasks with one of these statuses (todo, doing, done); done tasks are included only when listed here.",
  dueBefore: 'Only tasks due before this day: YYYY-MM-DD, "today" or "tomorrow". Tasks without a day never match.',
  dueAfter: 'Only tasks due after this day: YYYY-MM-DD, "today" or "tomorrow". Tasks without a day never match.',
  overdue: "true: only overdue tasks; false: only tasks that are not overdue.",
  limit: "Page size, 1 to 200. Without it every matching task is returned at once.",
  cursor: "nextCursor of the previous page, to get the next one.",
};

export type ToolKind = "read" | "write";

type Annotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  fields: PropertyValidators;
  docs: Record<string, string>;
  /** Name of the result's schema in docs/schemas (without .schema.json). */
  output: string;
  annotations: Annotations;
  ref: FunctionReference<"query" | "mutation", "internal">;
};

type Spec = {
  title: string;
  description: string;
  fields: PropertyValidators;
  output: string;
  ref: FunctionReference<"query" | "mutation", "internal">;
  docs?: Record<string, string>;
  /** Hints that differ from the defaults of the kind. */
  hints?: Partial<Omit<Annotations, "title" | "readOnlyHint">>;
};

// Changes keep the previous values in history and repeat safely with the same
// arguments (clientId); only moving a task to the trash and changing settings
// (which decide what "today" means) are marked destructive.
const read = (name: string, spec: Spec): Tool => define(name, "read", spec, { destructiveHint: false, idempotentHint: true });
const write = (name: string, spec: Spec): Tool =>
  define(name, "write", { ...spec, fields: { ...spec.fields, ...dryRunArgs } }, { destructiveHint: false, idempotentHint: true });

function define(name: string, kind: ToolKind, spec: Spec, defaults: Pick<Annotations, "destructiveHint" | "idempotentHint">): Tool {
  const annotations = {
    title: spec.title,
    readOnlyHint: kind === "read",
    ...defaults,
    openWorldHint: false,
    ...spec.hints,
  };
  const { title, description, fields, output, ref } = spec;
  return { name, kind, title, description, fields, output, ref, annotations, docs: { ...FIELD_DOCS, ...spec.docs } };
}

export const TOOLS: Tool[] = [
  write("add_task", {
    title: "Add task",
    description: "Add a task. Without dueDate it has no day and shows only in list_all and board.",
    fields: args.add,
    output: "task",
    ref: internal.ops.add,
    hints: { idempotentHint: false },
  }),
  write("update_task", {
    title: "Update task",
    description: "Change a task's title, note, due date/time, resume note, repeat rule, labels, links, checklist or reminders.",
    fields: args.update,
    output: "task",
    ref: internal.ops.update,
  }),
  write("set_status", {
    title: "Set task status",
    description: "Move a task between todo, doing and done (done behaves like complete_task).",
    fields: args.setStatus,
    output: "task",
    ref: internal.ops.setStatus,
  }),
  write("set_now", {
    title: "Set the now task",
    description:
      'Make a task the single "now" task (sets it to doing, clears the previous one), optionally with a resume note. taskId null clears the now task.',
    fields: args.setNow,
    output: "set-now",
    ref: internal.ops.setNow,
  }),
  write("complete_task", {
    title: "Complete task",
    description:
      "Mark a task done. A repeating task gets its next occurrence (checklist unticked), returned as `next`; null when its series has ended.",
    fields: args.complete,
    output: "complete",
    ref: internal.ops.complete,
  }),
  write("reschedule_task", {
    title: "Reschedule task",
    description: "Move a task to another day (and optionally time). dueDate null removes the date.",
    fields: args.reschedule,
    output: "task",
    ref: internal.ops.reschedule,
  }),
  write("archive_task", {
    title: "Archive task",
    description: "Archive a task: it leaves Today and the board but stays in exports. restore_task brings it back.",
    fields: args.archive,
    output: "task",
    ref: internal.ops.archive,
  }),
  write("delete_task", {
    title: "Move task to trash",
    description: "Move a task to the trash. It is purged after 30 days; restore_task undoes this.",
    fields: args.softDelete,
    output: "task",
    ref: internal.ops.softDelete,
    hints: { destructiveHint: true },
  }),
  write("restore_task", {
    title: "Restore task",
    description: "Restore a task from the trash (or, if not in the trash, from the archive).",
    fields: args.restore,
    output: "task",
    ref: internal.ops.restore,
  }),
  read("list_today", {
    title: "Today",
    description:
      "The Today screen: overdue tasks (not done, due before today in the user's time zone), today's tasks, tasks done today and the current now task.",
    fields: args.listToday,
    output: "today",
    ref: internal.ops.listToday,
  }),
  read("list_all", {
    title: "Find tasks",
    description:
      "Tasks not in the trash, oldest due first, narrowed by search text, status, labels, due day and overdue. Returns `result`, `total` (all matches) and `nextCursor`; pass limit to get pages.",
    fields: args.findTasks,
    output: "task-list",
    ref: internal.ops.findTasks,
    docs: FIND_DOCS,
  }),
  read("list_trash", {
    title: "Trash",
    description: "Tasks in the trash, newest first.",
    fields: args.listTrash,
    output: "task-list",
    ref: internal.ops.listTrash,
  }),
  read("board", {
    title: "Board",
    description: "Kanban board with three columns: todo, doing and done.",
    fields: args.board,
    output: "board",
    ref: internal.ops.board,
  }),
  read("get_task", {
    title: "Task with history",
    description: "One task with its full change history (who changed what, when, before and after).",
    fields: args.getTask,
    output: "task-detail",
    ref: internal.ops.getTask,
  }),
  read("export_plan", {
    title: "Export plan",
    description: "Export the whole plan as Markdown or JSON.",
    fields: args.exportPlan,
    output: "export",
    ref: internal.ops.exportPlan,
  }),
  read("get_settings", {
    title: "Settings",
    description: "The user's settings: time zone, morning summary time, default reminders.",
    fields: args.getSettings,
    output: "settings",
    ref: internal.ops.getSettings,
  }),
  write("update_settings", {
    title: "Update settings",
    description: "Change time zone, morning summary time or default reminders.",
    fields: args.updateSettings,
    output: "settings",
    ref: internal.ops.updateSettings,
    hints: { destructiveHint: true },
  }),
];

export const findTool = (name: unknown) => TOOLS.find((t) => t.name === name);

const TOOL_ERROR = "tool-error";

/** Names of the definitions a schema refers to, itself included. */
function closure(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const match of JSON.stringify(SCHEMA_DEFS[name]).matchAll(/"#\/\$defs\/([\w-]+)"/g)) closure(match[1]!, seen);
  return seen;
}

/**
 * A tool's result: its docs/schemas schema, or the tool error that a failed
 * call carries in structuredContent. Self-contained (local $refs only) and an
 * object at the top level, as 2025 clients require.
 */
export function outputSchema(name: string) {
  const root = SCHEMA_DEFS[name];
  if (!root) throw new Error(`No output schema "${name}"`);
  const names = [...closure(name), ...closure(TOOL_ERROR)];
  return {
    type: "object",
    title: root.title,
    description: `${root.description} A failed call has the tool error instead.`,
    anyOf: [{ $ref: `#/$defs/${name}` }, { $ref: `#/$defs/${TOOL_ERROR}` }],
    $defs: Object.fromEntries([...new Set(names)].sort().map((n) => [n, SCHEMA_DEFS[n]])),
  };
}

/** The OAuth scope a tool needs (docs/oauth.md): reading tools tasks:read, every other tool tasks:write. */
export const scopeOf = (tool: Tool): Scope => (tool.kind === "read" ? "tasks:read" : "tasks:write");

/** The tools a caller with these scopes may see and call; an API key has all scopes. */
export function listTools(scopes: readonly Scope[] = SCOPES) {
  return TOOLS.filter((t) => scopes.includes(scopeOf(t))).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: objectSchema(t.fields, t.docs),
    outputSchema: outputSchema(t.output),
    annotations: t.annotations,
  }));
}
