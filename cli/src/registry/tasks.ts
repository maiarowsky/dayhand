// Task commands: verbs at the top level (see docs/cli.md).
import { usageError } from "../core/exit.js";
import { requireProjects } from "../projects.js";
import type { Board, Detail, Task, TodayView } from "../render/model.js";
import { applyDue } from "./dates.js";
import { FILTER_OPTIONS, hasFilters, listTasks, parseStatuses } from "./filters.js";
import { eachRef, oneOrMany, tool, userTimezone } from "./ops.js";
import { checklistOf, editChecklist, REMINDER_OPTIONS, remindersInput, REPEAT_OPTIONS, repeatInput } from "./model.js";
import { PROPOSAL_OPTIONS, proposalArgs } from "./owner.js";
import { parseLink, resolveRef } from "./parse.js";
import type { CommandSpec, OptSpec, Opts, RunContext } from "./types.js";
import { criteriaOf, PROOF_OPTIONS, proofInput } from "./work.js";
import { PROJECT_OPTION } from "./projects.js";

const REF = { name: "ref", description: "Task: #42 or 42 (its number), now, or its id", required: true };
const REFS = { name: "refs", description: "Tasks: #42 or 42, now, or ids", required: true, variadic: true };

const SCHEDULE_OPTIONS: OptSpec[] = [
  { flags: "--due <when>", description: "Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (dayhand help dates)" },
  { flags: "--time <HH:MM>", description: "Due time, 24h, in your time zone" },
  ...REPEAT_OPTIONS,
];

// Agent work fields (backend 0.10.0): what done means, how, and what has to happen first.
const WORK_OPTIONS: OptSpec[] = [
  { flags: "--accept <text>", description: "Acceptance criterion: what done means (repeatable, in order)", kind: "list" },
  { flags: "--plan <text>", description: "How the work will be done" },
  { flags: "--depends-on <ref>", description: "A task that must be done first (repeatable)", kind: "list" },
  { flags: "--blocked <reason>", description: "Why the task cannot go on; a blocked task is not ready" },
];

/** --accept, --plan, --depends-on and --blocked as tool arguments. */
async function workArgs(ctx: RunContext, opts: Opts, input: Record<string, unknown>) {
  if ((opts.accept as string[]).length) input.acceptance = criteriaOf(opts.accept as string[]);
  if (opts.plan !== undefined) input.plan = opts.plan;
  if (opts.blocked !== undefined) input.blockedReason = opts.blocked;
  const depends = opts.dependsOn as string[];
  if (depends.length) input.dependsOn = await Promise.all(depends.map((ref) => resolveRef(ctx, ref)));
}

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
    summary: "The Today screen: now task, overdue, today and done today (also plain `dayhand`)",
    tools: ["list_today"],
    options: [PROJECT_OPTION],
    fields: "task",
    examples: ["dayhand", "dayhand today --json", "dayhand today --plain --fields ref,title"],
    run: async (ctx, _args, opts) => {
      const view = await tool<TodayView>(ctx, "list_today", await projectArgs(ctx, opts));
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
      PROJECT_OPTION,
      { flags: "--no-due", description: "No due day: the task shows only in list and board" },
      { flags: "--note <text>", description: "Note" },
      { flags: "--status <status>", description: "Initial status", choices: ["todo", "doing"] },
      { flags: "--resume-note <text>", description: "Where you stopped / next step" },
      { flags: "--link <url>", description: 'Link, optionally followed by a title: "https://… Title" (repeatable)', kind: "list" },
      { flags: "--item <text>", description: "Checklist item (repeatable, in order)", kind: "list" },
      ...REMINDER_OPTIONS,
      ...WORK_OPTIONS,
      ...PROPOSAL_OPTIONS,
    ],
    tools: ["add_task"],
    fields: "task",
    examples: [
      'dayhand add Call the accountant --due "fri 2pm"',
      'dayhand add "Zdjęcia do galerii" --due fri -p "strona piekarni"',
      'dayhand add Pay rent --due "1 nov" --dry-run',
      'dayhand add "Review the plan" --time 09:00 --every week --on mon,thu',
      'dayhand add Payroll --due 2026-10-30 --month-weekday "last fri" --remind "09:00 -1d"',
      "dayhand add Water plants --every day --interval 3 --from-completion",
      "dayhand add Pack --due fri --item passport --item charger",
      "dayhand add Buy a present --no-due --json",
      'dayhand add "Ship the export" --no-due --accept "CSV opens in a spreadsheet" --plan "write, then test" --depends-on 41',
      'dayhand add "Checkout times out" --propose --source "sentry:CHECKOUT-42 https://sentry.example.com/issues/42"',
    ],
    run: async (ctx, args, opts) => {
      const input: Record<string, unknown> = { title: (args.title as string[]).join(" "), clientId: ctx.clientId(), ...await projectArgs(ctx, opts) };
      copy(opts, input, { time: "dueTime", note: "note", status: "status", resumeNote: "resumeNote" });
      if (opts.due !== false) await applyDue(ctx, input, (opts.due as string | undefined) ?? "today", opts);
      if ((opts.link as string[]).length) input.links = (opts.link as string[]).map(parseLink);
      const repeat = await repeatInput(ctx, opts);
      if (repeat) input.repeat = repeat;
      if ((opts.item as string[]).length) input.checklist = checklistOf(opts.item as string[]);
      const reminders = remindersInput(opts);
      if (reminders) input.reminders = reminders;
      await workArgs(ctx, opts, input);
      proposalArgs(opts, input);
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
      PROJECT_OPTION,
      { flags: "--done", description: "Include done tasks" },
      { flags: "--archived", description: "Include archived tasks" },
      ...FILTER_OPTIONS,
    ],
    tools: ["list_all"],
    fields: "task",
    examples: [
      "dayhand list -p home --status todo,doing",
      "dayhand list --overdue",
      'dayhand list --due-before eow --search accountant --limit 20',
      "dayhand list --limit 50 --cursor <nextCursor> --json",
      "dayhand list --done --json --fields ref,title,status",
      "dayhand list --ready --json",
      "dayhand list -p none --json",
    ],
    run: async (ctx, _args, opts) => {
      const statuses = parseStatuses(opts.status);
      const includeDone = Boolean(opts.done) || Boolean(statuses?.includes("done"));
      const input: Record<string, unknown> = { includeDone, includeArchived: Boolean(opts.archived), ...await projectArgs(ctx, opts) };
      const value = await listTasks(ctx, input, opts);
      return { value, view: { kind: "tasks", tasks: asList(value), empty: hasFilters(opts) ? "no tasks match" : undefined } };
    },
  },
  {
    name: "board",
    schema: "board.schema.json",
    summary: "Kanban board: todo, doing and done columns",
    options: [PROJECT_OPTION, { flags: "--done-limit <n>", description: "Maximum tasks in the done column (default 50)", kind: "int" }],
    tools: ["board"],
    fields: "task",
    examples: ["dayhand board", "dayhand board --done-limit 5 --json"],
    run: async (ctx, _args, opts) => {
      const value = await tool<Board>(ctx, "board", { ...await projectArgs(ctx, opts), ...(opts.doneLimit === undefined ? {} : { doneLimit: opts.doneLimit }) });
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
    examples: ["dayhand show 42", "dayhand show now --json"],
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
      PROJECT_OPTION,
      { flags: "--clear-project", description: "Remove the project" },
      { flags: "--note <text>", description: "Replace the note" },
      { flags: "--clear-note", description: "Remove the note" },
      ...SCHEDULE_OPTIONS,
      { flags: "--clear-due", description: "Remove the due day (and time)" },
      { flags: "--clear-time", description: "Remove the due time" },
      { flags: "--clear-repeat", description: "Stop repeating" },
      { flags: "--resume-note <text>", description: "Where you stopped / next step" },
      { flags: "--clear-resume-note", description: "Remove the resume note" },
      { flags: "--link <url>", description: 'Replace all links: "https://… Title" (repeatable)', kind: "list" },
      { flags: "--clear-links", description: "Remove all links" },
      { flags: "--item <text>", description: "Replace the checklist (repeatable; dayhand checklist edits single items)", kind: "list" },
      { flags: "--clear-checklist", description: "Remove the checklist" },
      ...REMINDER_OPTIONS,
      { flags: "--default-reminders", description: "Back to the default reminders from settings" },
      { ...WORK_OPTIONS[0]!, description: "Replace the acceptance criteria (repeatable; dayhand criteria edits single ones)" },
      { flags: "--clear-acceptance", description: "Remove the acceptance criteria" },
      WORK_OPTIONS[1]!,
      { flags: "--clear-plan", description: "Remove the plan" },
      { ...WORK_OPTIONS[2]!, description: "Replace the dependencies: a task that must be done first (repeatable)" },
      { flags: "--clear-depends", description: "Remove all dependencies" },
      WORK_OPTIONS[3]!,
      { flags: "--unblock", description: "Remove the blocked reason" },
    ],
    tools: ["update_task"],
    fields: "task",
    examples: [
      'dayhand edit 42 --title "Call the bank" --due "tomorrow 10:00"',
      'dayhand edit 42 -p home --note "call after 5"',
      "dayhand edit 42 --every month --month-day last --until 2027-06-30",
      'dayhand edit 42 --rrule "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"',
      "dayhand edit 42 --remind 15m --remind 1d",
      "dayhand edit 42 --clear-repeat",
      'dayhand edit 42 --blocked "waiting for the client\'s brief"',
      "dayhand edit 42 --depends-on 40 --depends-on 41",
      "dayhand edit 42",
    ],
    run: async (ctx, args, opts) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const input = await editArgs(ctx, taskId, opts);
      if (Object.keys(input).length === 0 && ctx.interactive && ctx.format === "human") return editInEditor(ctx, taskId);
      if (Object.keys(input).length === 0) throw usageError("Nothing to change: give at least one option", { hint: "dayhand edit --help" });
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
    examples: ["dayhand note 42", 'dayhand note 42 "Account number is in the email"', "dayhand note 42 --clear"],
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
    name: "checklist",
    schema: ["task-detail.schema.json", "task.schema.json"],
    summary: "Print a task's checklist, or tick, untick, move, remove and add items",
    description: "Items are numbered from 1 as printed. Changes apply in this order: --check, --uncheck, --move, --rm, then --add.",
    args: [REF],
    options: [
      { flags: "--add <text>", description: "Add an item at the end (repeatable)", kind: "list" },
      { flags: "--check <n>", description: "Tick items: 2, 1,3 or all (repeatable)", kind: "list" },
      { flags: "--uncheck <n>", description: "Untick items (repeatable)", kind: "list" },
      { flags: "--move <from:to>", description: "Move an item, e.g. 3:1 (repeatable)", kind: "list" },
      { flags: "--rm <n>", description: "Remove items (repeatable)", kind: "list" },
      { flags: "--clear", description: "Remove the whole checklist" },
    ],
    tools: ["get_task", "update_task"],
    fields: "task",
    examples: ["dayhand checklist 42", 'dayhand checklist 42 --add "Book the hotel" --add "Pack"', "dayhand checklist 42 --check 1,2", "dayhand checklist 42 --move 3:1 --rm 4"],
    run: async (ctx, args, opts) => {
      const taskId = await resolveRef(ctx, args.ref as string);
      const detail = await tool<Detail>(ctx, "get_task", { taskId });
      const edits = ["add", "check", "uncheck", "move", "rm"].some((name) => (opts[name] as string[]).length > 0);
      if (!edits && !opts.clear) return { value: detail, view: { kind: "text", text: checklistText(detail.task) } };
      if (edits && opts.clear) throw usageError("--clear cannot be combined with other changes");
      const checklist = opts.clear ? null : editChecklist(detail.task.checklist ?? [], opts);
      const task = await tool<Task>(ctx, "update_task", { taskId, checklist, clientId: ctx.clientId() });
      return { value: task, view: { kind: "text", text: checklistText(task) } };
    },
  },
  {
    name: "move",
    schema: "task.schema.json",
    summary: "Move a task to another day, optionally with a time (none removes the date)",
    args: [REF, { name: "date", description: "When: tomorrow, fri 14:00, next mon, 2026-10-23 … or none (dayhand help dates)", required: true }],
    options: [
      { flags: "--time <HH:MM>", description: "New due time" },
      { flags: "--clear-time", description: "Remove the due time" },
    ],
    tools: ["reschedule_task"],
    fields: "task",
    examples: ["dayhand move 42 tomorrow --time 08:00", 'dayhand move 42 "next mon 9am"', "dayhand move 42 none"],
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
    summary: "Mark tasks done, optionally with proof; a repeating task gets its next occurrence",
    description:
      "An agent completing a task with acceptance criteria needs every criterion met (dayhand criteria) and --summary; otherwise it fails with precondition_failed (exit 6).",
    args: [REFS],
    options: PROOF_OPTIONS,
    tools: ["complete_task"],
    fields: "task",
    examples: [
      "dayhand done 42",
      "dayhand done 42 43 now",
      "dayhand done 1 2 3 --yes --client-id 7f3c",
      'dayhand done 42 --summary "Export shipped" --check "unit tests=pass https://ci.example/run/7" --proof-link "https://example.com/pr/7 PR"',
    ],
    run: async (ctx, args, opts) => {
      const proof = proofInput(opts);
      const results = await eachRef(ctx, args.refs as string[], "complete", (taskId, clientId) =>
        tool<TaskPair>(ctx, "complete_task", proof ? { taskId, proof, clientId } : { taskId, clientId }),
      );
      if (results.length === 1) return { value: results[0], view: { kind: "task", verb: "Done", ...results[0]! } };
      const tasks = results.flatMap((r) => (r.next ? [r.task, r.next] : [r.task]));
      return { value: { results }, view: { kind: "tasks", verb: "Done (with next occurrences)", tasks } };
    },
  },
  perTask(
    { name: "start", summary: "Set tasks to doing", verb: "start", done: "Started", examples: ["dayhand start 42"] },
    setStatus("doing"),
    ["set_status"],
  ),
  perTask(
    { name: "stop", summary: "Set tasks back to todo (from doing)", verb: "stop", done: "Stopped", examples: ["dayhand stop 42"] },
    setStatus("todo"),
    ["set_status"],
  ),
  perTask(
    { name: "reopen", summary: "Set done tasks back to todo", verb: "reopen", done: "Reopened", examples: ["dayhand reopen 42"] },
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
    examples: ["dayhand now", 'dayhand now 42 --note "have the account number"', "dayhand now --clear"],
    run: async (ctx, args, opts) => {
      const ref = args.ref as string | undefined;
      if (opts.clear) {
        if (ref || opts.note !== undefined) throw usageError("--clear takes no task and no --note");
        const value = await tool(ctx, "set_now", { taskId: null, clientId: ctx.clientId() });
        return { value, view: { kind: "text", text: "Now task cleared" } };
      }
      if (!ref) {
        if (opts.note !== undefined) throw usageError("--note needs a task: dayhand now <ref> --note <text>");
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
    { name: "archive", summary: "Archive tasks: off Today and the board, kept in exports", verb: "archive", done: "Archived", examples: ["dayhand archive 42"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "archive_task", { taskId, clientId }),
    ["archive_task"],
  ),
  perTask(
    { name: "rm", aliases: ["delete"], summary: "Move tasks to the trash (purged after 30 days)", verb: "delete", done: "Moved to the trash", examples: ["dayhand rm 42", "dayhand rm 4 5 6 --yes"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "delete_task", { taskId, clientId }),
    ["delete_task"],
  ),
  perTask(
    { name: "restore", summary: "Restore tasks from the trash (or the archive)", verb: "restore", done: "Restored", examples: ["dayhand restore 42"] },
    (ctx, taskId, clientId) => tool<Task>(ctx, "restore_task", { taskId, clientId }),
    ["restore_task"],
  ),
  {
    name: "trash",
    schema: "task-list.schema.json",
    summary: "Tasks in the trash, newest first",
    tools: ["list_trash"],
    fields: "task",
    examples: ["dayhand trash", "dayhand trash --json"],
    run: async (ctx) => {
      const value = await tool<{ result: Task[] }>(ctx, "list_trash");
      return { value, view: { kind: "tasks", tasks: asList(value), empty: "trash is empty" } };
    },
  },
];

/** "#42 Pack (1/2)" and the numbered items, as `dayhand checklist` prints them. */
function checklistText(task: Task): string {
  const items = task.checklist ?? [];
  const ref = task.ref !== undefined ? `#${task.ref}` : task.id;
  if (items.length === 0) return `${ref} ${task.title}: (no checklist)`;
  const done = items.filter((item) => item.done).length;
  return [`${ref} ${task.title} (${done}/${items.length})`, ...items.map((item, i) => `  ${i + 1}. ${item.done ? "[x]" : "[ ]"} ${item.title}`)].join("\n");
}

/** Copies defined options to tool argument names. */
function copy(opts: Opts, input: Record<string, unknown>, names: Record<string, string>) {
  for (const [from, to] of Object.entries(names)) if (opts[from] !== undefined) input[to] = opts[from];
}

async function editArgs(ctx: RunContext, taskId: string, opts: Opts): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = { ...await projectArgs(ctx, opts) };
  copy(opts, input, { title: "title", note: "note", time: "dueTime", resumeNote: "resumeNote" });
  if (opts.due !== undefined) await applyDue(ctx, input, opts.due as string, opts);
  await workArgs(ctx, opts, input);
  const clears: Record<string, string> = {
    clearNote: "note",
    clearProject: "projectId",
    clearDue: "dueDate",
    clearTime: "dueTime",
    clearRepeat: "repeat",
    clearResumeNote: "resumeNote",
    clearAcceptance: "acceptance",
    clearPlan: "plan",
    unblock: "blockedReason",
  };
  for (const [flag, field] of Object.entries(clears)) {
    if (!opts[flag]) continue;
    if (input[field] !== undefined) throw usageError(`--${kebab(flag)} cannot be combined with a new value for it`);
    input[field] = null;
  }
  const repeat = await repeatInput(ctx, opts);
  if (repeat && opts.clearRepeat) throw usageError("--clear-repeat cannot be combined with the repeat options");
  if (repeat) input.repeat = repeat;
  const items = opts.item as string[];
  if (items.length && opts.clearChecklist) throw usageError("--item cannot be combined with --clear-checklist");
  if (items.length) input.checklist = checklistOf(items);
  if (opts.clearChecklist) input.checklist = null;
  const reminders = remindersInput(opts);
  if (reminders !== undefined) input.reminders = reminders;

  if (opts.clearDepends) {
    if (input.dependsOn !== undefined) throw usageError("--depends-on cannot be combined with --clear-depends");
    input.dependsOn = [];
  }
  const links = opts.link as string[];
  if (links.length && opts.clearLinks) throw usageError("--link cannot be combined with --clear-links");
  if (links.length) input.links = links.map(parseLink);
  if (opts.clearLinks) input.links = [];
  return input;
}

/** Project options must never silently lose their meaning on an older backend. */
async function projectArgs(ctx: RunContext, opts: Opts): Promise<Record<string, unknown>> {
  if (opts.project === undefined && !opts.clearProject) return {};
  await requireProjects(ctx);
  return opts.project === undefined ? {} : { projectId: opts.project };
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `dayhand note <ref>` on a terminal: the note in the editor; an unchanged note sends nothing. */
async function editNote(ctx: RunContext, taskId: string, task: Task) {
  const before = task.note ?? "";
  const after = ctx.edit(before ? `${before}\n` : "", `dayhand-note-${task.ref ?? "task"}.md`).replace(/\s+$/, "");
  if (after === before) return { value: task, view: { kind: "text" as const, text: "Note unchanged" } };
  const updated = await tool<Task>(ctx, "update_task", { taskId, note: after === "" ? null : after, clientId: ctx.clientId() });
  return { value: updated, view: { kind: "task" as const, verb: "Note updated", task: updated } };
}

/** `dayhand edit <ref>` on a terminal without options: first line the title, after a blank line the note. */
async function editInEditor(ctx: RunContext, taskId: string) {
  const { task } = await tool<Detail>(ctx, "get_task", { taskId });
  const text = ctx.edit(`${task.title}\n\n${task.note ? `${task.note}\n` : ""}`, `dayhand-task-${task.ref ?? "task"}.md`);
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
