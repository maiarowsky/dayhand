// The MCP tool catalog: one tool per domain operation, with its input schema
// (from the operation's validators), its output schema (from docs/schemas)
// and its behaviour hints. The order of TOOLS is the order of tools/list.
import type { PropertyValidators } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import { approvalArgs, args, dryRunArgs } from "./args";
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
  acceptance:
    "Acceptance criteria, what done means: {text, met?, id?} in order. The whole list is replaced; keep the ids of existing criteria (new ones get a1, a2, ...). An agent can complete the task only when every criterion is met. Null or [] removes them.",
  plan: "How the work will be done, as free text (up to 20000 characters). Null clears it.",
  dependsOn:
    'Tasks that must be done first: ids or numbers as "#42". The whole list is replaced; [] removes all. A task with an open dependency is not ready (list_all ready).',
  blockedReason: "Why the task cannot go on now; a blocked task is not ready. Null clears it.",
  proof:
    "What shows the work is done: {summary, links?, checks?: [{name, result: pass|fail, url?}]}. Kept on the task. An agent completing a task with acceptance criteria must give a summary.",
  minutes: "Length of the claim in minutes from now, 1 to 1440 (default 120).",
  approvalId:
    "When the owner's policy asks before this key calls the tool (error approval_required), the id of the approval request the owner allowed: repeat exactly the same call with it. One approval lets one call through.",
  proposal:
    "true: the task waits in the owner's proposal inbox, out of Today, the board, list_all and the calendar, until the owner accepts, merges or rejects it.",
  source:
    'Where the task comes from: {kind, ref, url?}, e.g. {kind: "sentry", ref: "ISSUE-123"}. One source makes one task: adding it again returns the task it made the first time.',
  requestedBy: "Who asked for the task, e.g. a customer or a colleague (up to 200 characters). Default for an agent's proposal: the agent itself.",
  returnTo:
    "Id of one of the user's webhooks: it gets task.returned, with the proof, when the task is completed (or rejected, or merged into another task).",
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
  ready: "true: only tasks ready to work on (not done, not blocked, every dependency done); false: only the others.",
  proposed: "true: only proposals waiting in the owner's inbox; without it (or false) proposals are left out.",
  limit: "Page size, 1 to 200. Without it every matching task is returned at once.",
  cursor: "nextCursor of the previous page, to get the next one.",
};

const EVENT_DOCS: Record<string, string> = {
  since:
    'Where to continue: nextCursor of the previous call ("c…"), or a time as Unix milliseconds or ISO 8601 (changes from then on). Without it: the newest changes and the cursor to follow from.',
  by: 'Only changes by app, cli, agent (any agent) or one agent as "agent: <name>" (the `by` of each change).',
  taskId: 'Only changes of this task: its id or number as "#42".',
  limit: "At most this many changes, 1 to 500 (default 100).",
};

const APPROVAL_DOCS: Record<string, string> = {
  taskId: 'The task the request is about (optional): its id or number as "#42".',
  action: "What you want to do, as one short sentence the owner reads on the phone (up to 200 characters).",
  detail: "Why, and anything the owner needs to decide (up to 4000 characters).",
  options:
    "2 to 4 choices, in order: {label, consequence?, id?}. consequence says what happens if the owner picks it. Ids default to o1, o2, ...",
  reversible: "Whether what you want to do can be undone.",
  expiresInMinutes: "How long the owner has to decide, 1 to 10080 minutes (default 1440, a day). After that the request is expired.",
  approvalId: "Id of the approval request (the `id` returned by request_approval).",
  optionId: "Id of the chosen option.",
  note: "A word for the agent with the decision (optional, up to 1000 characters).",
  status: "Only requests that are pending, decided or expired.",
  limit: "At most this many requests, newest first, 1 to 200 (default 50).",
};

const CONTROL_DOCS: Record<string, string> = {
  paused: "true: pause every agent (their changes are refused, reading still works); false: let them run again.",
  reason: "Why, shown to agents in the error (optional, up to 500 characters).",
  apiKeyId: "Id of an agent API key (dayhand key list).",
  toolName: 'A tool that changes the plan (e.g. delete_task), or "*" for every such tool without its own rule.',
  rule: "allow (default), ask (the owner approves each call on the phone first) or deny.",
};

const PROPOSAL_DOCS: Record<string, string> = {
  taskId: 'The proposal: its id or number as "#42".',
  intoTaskId: 'The task the proposal is merged into: its id or number as "#42".',
  reason: "Why it is rejected; the return webhook gets it (optional).",
};

const BACKLOG_DOCS: Record<string, string> = {
  files:
    'Backlog.md files: {path, content}, path relative to the backlog folder (e.g. "tasks/task-3 - Write docs.md", "drafts/…", "completed/…", "archive/tasks/…", "config.yml"). Up to 200 files per call; send the tasks that others depend on first, or all in one call.',
  prefix: 'ID prefix of tasks that did not come from Backlog.md, e.g. "task" gives TASK-12 for task #12 (default "task"). Proposals become drafts with DRAFT-<number>.',
  includeArchived: "Include archived tasks, written to archive/tasks/ (default false).",
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
  /** Only the owner (the app, a cli key) may call it; agents do not see it (since 0.11.0). */
  ownerOnly: boolean;
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
  ownerOnly?: boolean;
};

// Changes keep the previous values in history and repeat safely with the same
// arguments (clientId); only moving a task to the trash and changing settings
// (which decide what "today" means) are marked destructive.
const read = (name: string, spec: Spec): Tool => define(name, "read", spec, { destructiveHint: false, idempotentHint: true });
// Agents' changes can be held back by the owner's policy "ask"; they then repeat the call with approvalId.
const write = (name: string, spec: Spec): Tool =>
  define(name, "write", { ...spec, fields: { ...spec.fields, ...dryRunArgs, ...(spec.ownerOnly ? {} : approvalArgs) } }, { destructiveHint: false, idempotentHint: true });

function define(name: string, kind: ToolKind, spec: Spec, defaults: Pick<Annotations, "destructiveHint" | "idempotentHint">): Tool {
  const annotations = {
    title: spec.title,
    readOnlyHint: kind === "read",
    ...defaults,
    openWorldHint: false,
    ...spec.hints,
  };
  const { title, description, fields, output, ref } = spec;
  return { name, kind, title, description, fields, output, ref, annotations, docs: { ...FIELD_DOCS, ...spec.docs }, ownerOnly: spec.ownerOnly ?? false };
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
    description:
      "Change a task's title, note, due date/time, resume note, repeat rule, labels, links, checklist, reminders, acceptance criteria, plan, dependencies or blocked reason.",
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
      "Mark a task done, optionally with proof (summary, links, checks); it ends the task's claim. An agent completing a task with acceptance criteria needs every criterion met and a proof summary, else precondition_failed. A repeating task gets its next occurrence (checklist and criteria unticked), returned as `next`; null when its series has ended.",
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
    description: "Export the whole plan as Markdown, JSON (a full copy with history) or iCalendar (ics, the dated tasks as calendar events).",
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
  read("list_events", {
    title: "Activity log",
    description:
      "Task changes in the order they happened, after a cursor: who changed which task, how (before and after). Keep nextCursor and pass it as since next time to get only what changed meanwhile, without reading the whole plan.",
    fields: args.listEvents,
    output: "event-list",
    ref: internal.ops.listEvents,
    docs: EVENT_DOCS,
  }),
  write("claim_task", {
    title: "Claim task",
    description:
      "Claim a task for a while (default 120 minutes) so other agents leave it alone: their changes and claims get the error conflict until the claim is released or expires. Claiming it again extends your claim. The owner in the app can always take over.",
    fields: args.claim,
    output: "task",
    ref: internal.ops.claim,
  }),
  write("renew_claim", {
    title: "Renew claim",
    description: "Extend your claim of a task by minutes from now (default 120). precondition_failed when you hold no claim on it; conflict when another agent does.",
    fields: args.renewClaim,
    output: "task",
    ref: internal.ops.renewClaim,
  }),
  write("release_task", {
    title: "Release task",
    description: "End your claim of a task, optionally with a checkpoint note (where you stopped, the next step) saved as its resume note.",
    fields: args.release,
    output: "task",
    ref: internal.ops.release,
    docs: { note: "Checkpoint: where the work stopped and the next step; saved as the task's resume note." },
  }),
  write("request_approval", {
    title: "Ask the owner",
    description:
      "Ask the owner to decide before you do something: what you want to do, 2 to 4 options with their consequences, whether it can be undone, and how long they have. They decide on the phone. Read the outcome with get_approval (or the approval.decided webhook). Dayhand records the decision; you must act on it yourself.",
    fields: args.requestApproval,
    output: "approval",
    ref: internal.ops.requestApproval,
    docs: APPROVAL_DOCS,
  }),
  read("get_approval", {
    title: "Approval request",
    description: "One approval request: its status (pending, decided, expired) and, once decided, the option the owner chose and their note.",
    fields: args.getApproval,
    output: "approval",
    ref: internal.ops.getApproval,
    docs: APPROVAL_DOCS,
  }),
  read("list_approvals", {
    title: "Approval requests",
    description: "Approval requests, newest first, narrowed by status and task.",
    fields: args.listApprovals,
    output: "approval-list",
    ref: internal.ops.listApprovals,
    docs: APPROVAL_DOCS,
  }),
  write("decide_approval", {
    title: "Decide approval request",
    description: "The owner picks an option of a pending approval request. Only the owner (the app or a cli key) can decide.",
    fields: args.decideApproval,
    output: "approval",
    ref: internal.ops.decideApproval,
    docs: APPROVAL_DOCS,
    ownerOnly: true,
  }),
  read("get_agent_controls", {
    title: "Agent controls",
    description: "Whether the owner paused all agents, and the owner's tool policies per agent key (allow, ask or deny).",
    fields: args.getAgentControls,
    output: "agent-controls",
    ref: internal.ops.getAgentControls,
  }),
  write("pause_agents", {
    title: "Pause agents",
    description:
      "Pause every agent (agent API keys and agent connections): their changes are refused with agents_paused until the owner resumes them; reading still works. Only the owner can call it.",
    fields: args.pauseAgents,
    output: "agent-controls",
    ref: internal.ops.pauseAgents,
    docs: CONTROL_DOCS,
    ownerOnly: true,
  }),
  write("set_tool_policy", {
    title: "Set tool policy",
    description:
      'Set what one agent key may do with a tool that changes the plan: allow, ask (each call waits for the owner\'s approval) or deny. toolName "*" covers every such tool without its own rule. Only the owner can call it.',
    fields: args.setToolPolicy,
    output: "agent-controls",
    ref: internal.ops.setToolPolicy,
    docs: CONTROL_DOCS,
    ownerOnly: true,
  }),
  write("accept_proposal", {
    title: "Accept proposal",
    description: "Accept a proposal from the inbox: it joins the plan as it is. Only the owner can call it.",
    fields: args.acceptProposal,
    output: "task",
    ref: internal.ops.acceptProposal,
    docs: PROPOSAL_DOCS,
    ownerOnly: true,
  }),
  write("merge_proposal", {
    title: "Merge proposal",
    description:
      "Merge a proposal into a task already in the plan: the task gets its note, links, labels, source and return webhooks; the proposal goes to the trash. Only the owner can call it.",
    fields: args.mergeProposal,
    output: "merge",
    ref: internal.ops.mergeProposal,
    docs: PROPOSAL_DOCS,
    ownerOnly: true,
  }),
  write("reject_proposal", {
    title: "Reject proposal",
    description: "Reject a proposal: it goes to the trash (restorable for 30 days) and its return webhook hears it was rejected. Only the owner can call it.",
    fields: args.rejectProposal,
    output: "task",
    ref: internal.ops.rejectProposal,
    docs: PROPOSAL_DOCS,
    hints: { destructiveHint: true },
    ownerOnly: true,
  }),
  read("agent_brief", {
    title: "Agent brief",
    description:
      "Start of a session, in one read: list_today (the now task, overdue, today, done today) plus the claims in force (yours marked mine) and those that ran out, whether the owner paused agents and your tool policies, approval requests waiting and the owner's recent decisions on yours, the first tasks ready to work on, and nextSteps as sentences.",
    fields: args.agentBrief,
    output: "agent-brief",
    ref: internal.ops.agentBrief,
  }),
  write("import_backlog", {
    title: "Import Backlog.md tasks",
    description:
      "Import task files in the Backlog.md format (Markdown with a YAML header) as tasks: title, status (nearest of todo, doing, done), labels, acceptance criteria, implementation plan, dependencies and the final summary as proof. Each task gets the source {kind: \"backlog-md\", ref: <id or path>}, so a file imported before is skipped. Drafts become proposals; docs, decisions and milestones are skipped. Returns what was created, skipped, failed and could not be carried over.",
    fields: args.importBacklog,
    output: "backlog-import",
    ref: internal.ops.importBacklog,
    docs: {
      ...BACKLOG_DOCS,
      run: "For a multi-batch import, the same ordered manifest of all batches: {batches: [{hash, files}]}. hash is SHA-256 of JSON.stringify(files.map(({path, content}) => ({path, content}))); files is that batch's file count. One policy approval covers this whole manifest, including idempotent retries; each submitted batch must match it.",
    },
  }),
  read("export_backlog", {
    title: "Export as Backlog.md",
    description:
      "The plan as Backlog.md task files (Markdown with a YAML header) plus a config.yml: status mapped to To Do, In Progress or Done, labels, acceptance criteria, plan, dependencies, links as references and proof as the final summary. Tasks imported from Backlog.md keep their ids. Returns the files to write; nothing is stored.",
    fields: args.exportBacklog,
    output: "backlog-export",
    ref: internal.ops.exportBacklog,
    docs: BACKLOG_DOCS,
  }),
  read("plan_health", {
    title: "Plan health",
    description:
      "What needs a look, in one read: overdue and today's tasks, tasks in progress and who works on them, claims that ran out, blocked tasks with reasons, tasks waiting for an approval, proposals, tasks done today with and without proof, and the age of the oldest open task.",
    fields: args.planHealth,
    output: "plan-health",
    ref: internal.ops.planHealth,
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

/** The tools a caller with these scopes may see and call; an API key has all scopes. Agents do not see the owner's tools. */
export function listTools(scopes: readonly Scope[] = SCOPES, actor: "cli" | "agent" = "cli") {
  return TOOLS.filter((t) => scopes.includes(scopeOf(t)) && !(actor === "agent" && t.ownerOnly)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: objectSchema(t.fields, t.docs),
    outputSchema: outputSchema(t.output),
    annotations: t.annotations,
  }));
}
