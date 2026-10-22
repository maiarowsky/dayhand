// Task commands: verbs at the top level, one MCP tool each (see docs/cli.md).
import { usageError } from "../core/exit.js";
import type { Board, Detail, Task, TodayView } from "../render/model.js";
import { applyDue } from "./dates.js";
import { FILTER_OPTIONS, hasFilters, parseStatuses, taskFilter } from "./filters.js";
import { eachRef, oneOrMany, tool, userTimezone } from "./ops.js";
import { parseLink, parseRepeat, resolveRef } from "./parse.js";
import type { CommandSpec, OptSpec, Opts, RunContext } from "./types.js";

const REF = { name: "ref", description: "Task: #42 or 42 (its number), now, or its id", required: true };
const REFS = { name: "refs", description: "Tasks: #42 or 42, now, or ids", required: true, variadic: true };

const SCHEDULE_OPTIONS: OptSpec[] = [
  { flags: "--due <when>", description: "Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (hlm help dates)" },
  { flags: "--time <HH:MM>", description: "Due time, 24h, in your time zone" },
  { flags: "--every <unit>", description: "Repeat every day, week, month or year", choices: ["day", "week", "month", "year"] },
  { flags: "--interval <n>", description: "Repeat interval (2 = every other)", kind: "int" },
  { flags: "--on <days>", description: "Weekly repeat days, e.g. mon,thu" },
];

type TaskPair = { task: Task; next: Task | null };

const asList = (value: { result?: unknown }) => (value.result ?? []) as Task[];

/** A command that applies one tool to each of several tasks. */
function perTask(
  spec: { name: string; aliases?: string[]; summary: string; verb: string; done: string; examples: string[] },
  call: (ctx: RunContext, taskId: string, clientId: string) => Promise<Task>,
  tools: string[],
): CommandSpec {
  return {
    name: spec.name,
    aliases: spec.aliases,
    summary: spec.summary,
    args: [REFS],
    tools,
    fields: "task",
    schema: "task.schema.json",
    examples: spec.examples,
    run: async (ctx, args) => {
      const results = await eachRef(ctx, args.refs as string[], spec.verb, (taskId, clientId) => call(ctx, taskId, clientId));
      return { value: oneOrMany(results), view: { kind: "tasks", verb: spec.done, tasks: results } };
    },
  };
}

const setStatus = (status: string) => (ctx: RunContext, taskId: string, clientId: string) =>
  tool<Task>(ctx, "set_status", { taskId, status, clientId });

export const taskCommands: CommandSpec[] = [
  {
    name: "today",
    schema: "today.schema.json",
    summary: "The Today screen: now task, overdue, today and done today (also plain `hlm`)",
    tools: ["list_today"],
    fields: "task",
    examples: ["hlm", "hlm today --json", "hlm today --plain --fields ref,title"],
    run: async (ctx) => {
      const view = await tool<TodayView>(ctx, "list_today");
      return { value: view, view: { kind: "today", view } };
    },
  },
  {
    name: "add",
    schema: "task.schema.json",
    summary: "Add a task (due today unless --due or --no-due)",
    args: [{ name: "title", description: "Task title", required: true, variadic: true }],
    options: [
      ...SCHEDULE_OPTIONS,
      { flags: "--no-due", description: "No due day: the task shows only in list and board" },
      { flags: "-l, --label <label>", description: "Label (repeatable)", kind: "list" },
      { flags: "--note <text>", description: "Note" },
      { flags: "--status <status>", description: "Initial status", choices: ["todo", "doing"] },
      { flags: "--resume-note <text>", description: "Where you stopped / next step" },
      { flags: "--link <url>", description: 'Link, optionally followed by a title: "https://… Title" (repeatable)', kind: "list" },
    ],
    tools: ["add_task"],
    fields: "task",
    examples: [
      'hlm add Call the accountant --due "fri 2pm" -l home',
      'hlm add Pay rent --due "1 nov" --dry-run',
      'hlm add "Review the plan" --time 09:00 --every week --on mon,thu',
      "hlm add Buy a present --no-due --json",
    ],
    run: async (ctx, args, opts) => {
      const input: Record<string, unknown> = { title: (args.title as string[]).join(" "), clientId: ctx.clientId() };
      copy(opts, input, { time: "dueTime", note: "note", status: "status", resumeNote: "resumeNote" });
      if (opts.due !== false) await applyDue(ctx, input, (opts.due as string | undefined) ?? "today", opts);
      if ((opts.label as string[]).length) input.labels = opts.label;
      if ((opts.link as string[]).length) input.links = (opts.link as string[]).map(parseLink);
      const repeat = parseRepeat(opts as never);
      if (repeat) input.repeat = repeat;
      const task = await tool<Task>(ctx, "add_task", input);
      return { value: task, view: { kind: "task", verb: "Added", task } };
    },
  },
  {
    name: "list",
    schema: "task-list.schema.json",
    aliases: ["ls"],
    summary: "Open tasks, oldest due first (with --done also done ones); filters narrow the list",
    options: [
      { flags: "-l, --label <label>", description: "Only tasks with this label (repeatable: all must match)", kind: "list" },
      { flags: "--done", description: "Include done tasks" },
      { flags: "--archived", description: "Include archived tasks" },
      ...FILTER_OPTIONS,
    ],
    tools: ["list_all"],
    fields: "task",
    examples: [
      "hlm list -l home --status todo,doing",
      "hlm list --overdue",
      'hlm list --due-before eow --search accountant --limit 20',
      "hlm list --done --json --fields ref,title,status",
    ],
    run: async (ctx, _args, opts) => {
      const statuses = parseStatuses(opts.status);
      const includeDone = Boolean(opts.done) || Boolean(statuses?.includes("done"));
      const input: Record<string, unknown> = { includeDone, includeArchived: Boolean(opts.archived) };
      if ((opts.label as string[]).length) input.labels = opts.label;
      const [listed, filter] = await Promise.all([tool<{ result: Task[] }>(ctx, "list_all", input), taskFilter(ctx, opts)]);
      const value = hasFilters(opts) ? { ...listed, result: filter(asList(listed)) } : listed;
      return { value, view: { kind: "tasks", tasks: asList(value), empty: hasFilters(opts) ? "no tasks match" : undefined } };
    },
  },
  {
    name: "board",
    schema: "board.schema.json",
    summary: "Kanban board: todo, doing and done columns",
    options: [{ flags: "--done-limit <n>", description: "Maximum tasks in the done column (default 50)", kind: "int" }],
    tools: ["board"],
    fields: "task",
    examples: ["hlm board", "hlm board --done-limit 5 --json"],
    run: async (ctx, _args, opts) => {
      const value = await tool<Board>(ctx, "board", opts.doneLimit === undefined ? {} : { doneLimit: opts.doneLimit });
      const section = (name: keyof Board) => ({ name, label: name.toUpperCase(), tasks: value[name], count: true, empty: "empty" });
      return { value, view: { kind: "sections", columns: true, sections: [section("todo"), section("doing"), section("done")] } };
    },
  },
  {
    name: "show",
    schema: "task-detail.schema.json",
    summary: "One task with its change history (who changed what, when)",
    args: [REF],
    tools: ["get_task"],
    fields: "task",
    examples: ["hlm show 42", "hlm show now --json"],
    run: async (ctx, args) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const [value, timezone] = await Promise.all([tool<Detail>(ctx, "get_task", { taskId }), userTimezone(ctx)]);
      return { value, view: { kind: "detail", task: value.task, history: value.history, timezone } };
    },
  },
  {
    name: "edit",
    schema: "task.schema.json",
    summary: "Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR",
    args: [REF],
    options: [
      { flags: "--title <text>", description: "New title" },
      { flags: "--note <text>", description: "Replace the note" },
      { flags: "--clear-note", description: "Remove the note" },
      ...SCHEDULE_OPTIONS,
      { flags: "--clear-due", description: "Remove the due day (and time)" },
      { flags: "--clear-time", description: "Remove the due time" },
      { flags: "--clear-repeat", description: "Stop repeating" },
      { flags: "--resume-note <text>", description: "Where you stopped / next step" },
      { flags: "--clear-resume-note", description: "Remove the resume note" },
      { flags: "-l, --label <label>", description: "Replace all labels (repeatable)", kind: "list" },
      { flags: "--add-label <label>", description: "Add a label (repeatable)", kind: "list" },
      { flags: "--rm-label <label>", description: "Remove a label (repeatable)", kind: "list" },
      { flags: "--clear-labels", description: "Remove all labels" },
      { flags: "--link <url>", description: 'Replace all links: "https://… Title" (repeatable)', kind: "list" },
      { flags: "--clear-links", description: "Remove all links" },
    ],
    tools: ["update_task"],
    fields: "task",
    examples: ['hlm edit 42 --title "Call the bank" --due "tomorrow 10:00"', "hlm edit 42 --add-label work --rm-label home", "hlm edit 42 --clear-repeat", "hlm edit 42"],
    run: async (ctx, args, opts) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const input = await editArgs(ctx, taskId, opts);
      if (Object.keys(input).length === 0 && ctx.interactive && ctx.format === "human") return editInEditor(ctx, taskId);
      if (Object.keys(input).length === 0) throw usageError("Nothing to change: give at least one option", { hint: "hlm edit --help" });
      const task = await tool<Task>(ctx, "update_task", { taskId, ...input, clientId: ctx.clientId() });
      return { value: task, view: { kind: "task", verb: "Updated", task } };
    },
  },
  {
    name: "note",
    schema: ["task-detail.schema.json", "task.schema.json"],
    summary: "Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it",
    args: [REF, { name: "text", description: "Text to append as a new line", variadic: true }],
    options: [{ flags: "--clear", description: "Remove the note" }],
    tools: ["get_task", "update_task"],
    fields: "task",
    examples: ["hlm note 42", 'hlm note 42 "Account number is in the email"', "hlm note 42 --clear"],
    run: async (ctx, args, opts) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const text = ((args.text as string[] | undefined) ?? []).join(" ").trim();
      if (!text && !opts.clear) {
        const value = await tool<Detail>(ctx, "get_task", { taskId });
        if (ctx.interactive && ctx.format === "human") return editNote(ctx, taskId, value.task);
        return { value, view: { kind: "text", text: value.task.note ?? "(no note)" } };
      }
      if (text && opts.clear) throw usageError("Give text to append or --clear, not both");
      let note: string | null = null;
      if (text) {
        const current = (await tool<Detail>(ctx, "get_task", { taskId })).task.note;
        note = current ? `${current}\n${text}` : text;
      }
      const task = await tool<Task>(ctx, "update_task", { taskId, note, clientId: ctx.clientId() });
      return { value: task, view: { kind: "task", verb: "Note updated", task } };
    },
  },
  {
    name: "move",
    schema: "task.schema.json",
    summary: "Move a task to another day, optionally with a time (none removes the date)",
    args: [REF, { name: "date", description: "When: tomorrow, fri 14:00, next mon, 2026-10-23 … or none (hlm help dates)", required: true }],
    options: [
      { flags: "--time <HH:MM>", description: "New due time" },
      { flags: "--clear-time", description: "Remove the due time" },
    ],
    tools: ["reschedule_task"],
    fields: "task",
    examples: ["hlm move 42 tomorrow --time 08:00", 'hlm move 42 "next mon 9am"', "hlm move 42 none"],
    run: async (ctx, args, opts) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const date = (args.date as string).trim();
      const input: Record<string, unknown> = { taskId };
      if (date.toLowerCase() === "none") input.dueDate = null;
      else await applyDue(ctx, input, date, opts);
      input.clientId = ctx.clientId();
      if (opts.time !== undefined) input.dueTime = opts.time;
      if (opts.clearTime) input.dueTime = null;
      const task = await tool<Task>(ctx, "reschedule_task", input);
      return { value: task, view: { kind: "task", verb: "Moved", task } };
    },
  },
  {
    name: "done",
    schema: "complete.schema.json",
    summary: "Mark tasks done; a repeating task gets its next occurrence",
    args: [REFS],
    tools: ["complete_task"],
    fields: "task",
    examples: ["hlm done 42", "hlm done 42 43 now", "hlm done 1 2 3 --yes --client-id 7f3c"],
    run: async (ctx, args) => {
      const results = await eachRef(ctx, args.refs as string[], "complete", (taskId, clientId) =>
        tool<TaskPair>(ctx, "complete_task", { taskId, clientId }),
      );
      if (results.length === 1) return { value: results[0], view: { kind: "task", verb: "Done", ...results[0]! } };
      const tasks = results.flatMap((r) => (r.next ? [r.task, r.next] : [r.task]));
      return { value: { results }, view: { kind: "tasks", verb: "Done (with next occurrences)", tasks } };
    },
  },
  perTask(
    { name: "start", summary: "Set tasks to doing", verb: "start", done: "Started", examples: ["hlm start 42"] },
    setStatus("doing"),
    ["set_status"],
  ),
  perTask(
    { name: "stop", summary: "Set tasks back to todo (from doing)", verb: "stop", done: "Stopped", examples: ["hlm stop 42"] },
    setStatus("todo"),
    ["set_status"],
  ),
  perTask(
    { name: "reopen", summary: "Set done tasks back to todo", verb: "reopen", done: "Reopened", examples: ["hlm reopen 42"] },
    setStatus("todo"),
    ["set_status"],
  ),
  {
    name: "now",
    schema: ["set-now.schema.json", "today.schema.json"],
    summary: "Show the now task, make a task the now task (--note: where you stopped), or --clear",
    args: [{ name: "ref", description: "Task to make the now task" }],
    options: [
      { flags: "--note <text>", description: "Resume note shown on Today" },
      { flags: "--clear", description: "Clear the now task" },
    ],
    tools: ["set_now", "list_today"],
    fields: "task",
    examples: ["hlm now", 'hlm now 42 --note "have the account number"', "hlm now --clear"],
    run: async (ctx, args, opts) => {
      const ref = args.ref as string | undefined;
      if (opts.clear) {
        if (ref || opts.note !== undefined) throw usageError("--clear takes no task and no --note");
        const value = await tool(ctx, "set_now", { taskId: null, clientId: ctx.clientId() });
        return { value, view: { kind: "text", text: "Now task cleared" } };
      }
      if (!ref) {
        if (opts.note !== undefined) throw usageError("--note needs a task: hlm now <ref> --note <text>");
        const value = await tool<TodayView>(ctx, "list_today");
        return { value, view: value.now ? { kind: "task", verb: "Now", task: value.now } : { kind: "text", text: "(no now task)" } };
      }
      const input: Record<string, unknown> = { taskId: await resolveRef(ctx, ref), clientId: ctx.clientId() };
      if (opts.note !== undefined) input.resumeNote = opts.note;
      const task = await tool<Task>(ctx, "set_now", input);
      return { value: task, view: { kind: "task", verb: "Now", task } };
    },
  },
  perTask(
    { name: "archive", summary: "Archive tasks: off Today and the board, kept in exports", verb: "archive", done: "Archived", examples: ["hlm archive 42"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "archive_task", { taskId, clientId }),
    ["archive_task"],
  ),
  perTask(
    { name: "rm", aliases: ["delete"], summary: "Move tasks to the trash (purged after 30 days)", verb: "delete", done: "Moved to the trash", examples: ["hlm rm 42", "hlm rm 4 5 6 --yes"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "delete_task", { taskId, clientId }),
    ["delete_task"],
  ),
  perTask(
    { name: "restore", summary: "Restore tasks from the trash (or the archive)", verb: "restore", done: "Restored", examples: ["hlm restore 42"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "restore_task", { taskId, clientId }),
    ["restore_task"],
  ),
  {
    name: "trash",
    schema: "task-list.schema.json",
    summary: "Tasks in the trash, newest first",
    tools: ["list_trash"],
    fields: "task",
    examples: ["hlm trash", "hlm trash --json"],
    run: async (ctx) => {
      const value = await tool<{ result: Task[] }>(ctx, "list_trash");
      return { value, view: { kind: "tasks", tasks: asList(value), empty: "trash is empty" } };
    },
  },
];

/** Copies defined options to tool argument names. */
function copy(opts: Opts, input: Record<string, unknown>, names: Record<string, string>) {
  for (const [from, to] of Object.entries(names)) if (opts[from] !== undefined) input[to] = opts[from];
}

async function editArgs(ctx: RunContext, taskId: string, opts: Opts): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  copy(opts, input, { title: "title", note: "note", time: "dueTime", resumeNote: "resumeNote" });
  if (opts.due !== undefined) await applyDue(ctx, input, opts.due as string, opts);
  const clears: Record<string, string> = { clearNote: "note", clearDue: "dueDate", clearTime: "dueTime", clearRepeat: "repeat", clearResumeNote: "resumeNote" };
  for (const [flag, field] of Object.entries(clears)) {
    if (!opts[flag]) continue;
    if (input[field] !== undefined) throw usageError(`--${kebab(flag)} cannot be combined with a new value for it`);
    input[field] = null;
  }
  const repeat = parseRepeat(opts as never);
  if (repeat && opts.clearRepeat) throw usageError("--clear-repeat cannot be combined with --every, --interval or --on");
  if (repeat) input.repeat = repeat;

  const set = opts.label as string[];
  const added = opts.addLabel as string[];
  const removed = opts.rmLabel as string[];
  if ([set.length > 0, added.length + removed.length > 0, Boolean(opts.clearLabels)].filter(Boolean).length > 1) {
    throw usageError("Use one of --label, --add-label/--rm-label or --clear-labels");
  }
  if (set.length) input.labels = set;
  if (opts.clearLabels) input.labels = [];
  if (added.length || removed.length) {
    const current = (await tool<Detail>(ctx, "get_task", { taskId })).task.labels;
    input.labels = [...new Set([...current, ...added])].filter((l) => !removed.includes(l));
  }
  const links = opts.link as string[];
  if (links.length && opts.clearLinks) throw usageError("--link cannot be combined with --clear-links");
  if (links.length) input.links = links.map(parseLink);
  if (opts.clearLinks) input.links = [];
  return input;
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `hlm note <ref>` on a terminal: the note in the editor; an unchanged note sends nothing. */
async function editNote(ctx: RunContext, taskId: string, task: Task) {
  const before = task.note ?? "";
  const after = ctx.edit(before ? `${before}\n` : "", `hlm-note-${task.ref ?? "task"}.md`).replace(/\s+$/, "");
  if (after === before) return { value: task, view: { kind: "text" as const, text: "Note unchanged" } };
  const updated = await tool<Task>(ctx, "update_task", { taskId, note: after === "" ? null : after, clientId: ctx.clientId() });
  return { value: updated, view: { kind: "task" as const, verb: "Note updated", task: updated } };
}

/** `hlm edit <ref>` on a terminal without options: first line the title, after a blank line the note. */
async function editInEditor(ctx: RunContext, taskId: string) {
  const { task } = await tool<Detail>(ctx, "get_task", { taskId });
  const text = ctx.edit(`${task.title}\n\n${task.note ? `${task.note}\n` : ""}`, `hlm-task-${task.ref ?? "task"}.md`);
  const [first = "", ...rest] = text.split(/\r?\n/);
  const title = first.trim();
  if (!title) throw usageError("The first line (the title) is empty; nothing was changed");
  const note = rest.join("\n").replace(/^(\s*\n)+/, "").replace(/\s+$/, "");
  const changes: Record<string, unknown> = {};
  if (title !== task.title) changes.title = title;
  if (note !== (task.note ?? "")) changes.note = note === "" ? null : note;
  if (Object.keys(changes).length === 0) return { value: task, view: { kind: "text" as const, text: "No changes" } };
  const updated = await tool<Task>(ctx, "update_task", { taskId, ...changes, clientId: ctx.clientId() });
  return { value: updated, view: { kind: "task" as const, verb: "Updated", task: updated } };
}
