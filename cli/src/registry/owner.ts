// The owner in charge of agents (docs/agent-work.md, backend 0.11.0): approval
// requests, pausing agents and tool policies, the proposal inbox and the plan
// health report. One MCP tool per command, as elsewhere; the owner's tools
// (deciding, pausing, policies, proposals) need a cli key.
import { usageError } from "../core/exit.js";
import { formatTimestamp, refOf } from "../render/format.js";
import type { Task } from "../render/model.js";
import { tool, userTimezone } from "./ops.js";
import { resolveRef } from "./parse.js";
import type { CommandSpec, OptSpec, Opts, RunContext } from "./types.js";

const NEEDS = "Needs backend 0.11.0 or later (dayhand version).";
const OWNER = "Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).";

type Option = { id: string; label: string; consequence: string | null };
export type Approval = {
  id: string;
  ref: number | null;
  taskTitle: string | null;
  action: string;
  detail: string | null;
  options: Option[];
  reversible: boolean;
  status: "pending" | "decided" | "expired";
  expiresAt: number;
  requestedBy: { type: string; name: string };
  source: "agent" | "policy";
  tool: string | null;
  decision: { optionId: string; label: string; note: string | null; decidedAt: number; by: string } | null;
};
type Policy = { keyId: string; keyName: string; tool: string; rule: string };
export type Controls = { paused: boolean; pausedAt: number | null; reason: string | null; policies: Policy[] };

// ---- Approval requests ----

/** --option "Deploy now: customers get 2.4 within 10 minutes" as {label, consequence}. */
export function parseOption(text: string): { label: string; consequence?: string } {
  const [label, ...rest] = text.split(":");
  const consequence = rest.join(":").trim();
  if (!label!.trim()) throw usageError(`--option needs a label, optionally followed by ": consequence", got "${text}"`);
  return consequence ? { label: label!.trim(), consequence } : { label: label!.trim() };
}

const SPAN = /^(\d{1,5})\s*(m|min|h|d)?$/i;
const SPAN_MINUTES: Record<string, number> = { m: 1, min: 1, h: 60, d: 24 * 60 };

/** --expires as minutes: 90 (minutes), 30m, 2h, 1d. */
export function parseMinutes(text: string): number {
  const match = SPAN.exec(text.trim());
  if (!match) throw usageError(`--expires takes minutes or 30m, 2h, 1d, got "${text}"`);
  return Number(match[1]) * SPAN_MINUTES[(match[2] ?? "m").toLowerCase()]!;
}

/** One request as `dayhand approval` prints it. */
export function approvalText(approval: Approval, timezone?: string): string {
  const about = approval.ref !== null ? `  (#${approval.ref} ${approval.taskTitle ?? ""})` : "";
  const lines = [`${approval.action}${about}`, `  ${approval.id}  ${approval.status}  asked by ${approval.requestedBy.name}`];
  if (approval.detail) lines.push(`  ${approval.detail}`);
  for (const option of approval.options) lines.push(`  ${option.id}: ${option.label}${option.consequence ? ` - ${option.consequence}` : ""}`);
  lines.push(`  ${approval.reversible ? "can be undone" : "cannot be undone"}; ${approval.status === "pending" ? "decide by" : "expires"} ${formatTimestamp(approval.expiresAt, timezone)}`);
  if (approval.decision) {
    const note = approval.decision.note ? `: ${approval.decision.note}` : "";
    lines.push(`  decided ${approval.decision.optionId} (${approval.decision.label}) on ${formatTimestamp(approval.decision.decidedAt, timezone)}${note}`);
  }
  return lines.join("\n");
}

const listText = (approvals: Approval[], timezone?: string) =>
  approvals.length === 0 ? "(no approval requests)" : approvals.map((a) => approvalText(a, timezone)).join("\n\n");

const POLL_MS = 5_000;

const ask: CommandSpec = {
  name: "ask",
  schema: "approval.schema.json",
  summary: "Ask the owner to decide before you do something; they answer on the phone",
  description:
    `Give 2 to 4 --option, each "label: consequence". Read the answer with dayhand approval <id> (--wait to wait for it). Dayhand records the decision; acting on it is up to you. ${NEEDS}`,
  args: [{ name: "action", description: "What you want to do, as one short sentence", required: true, variadic: true }],
  options: [
    { flags: "--option <text>", description: 'A choice, "label: what happens then" (repeatable, 2 to 4)', kind: "list" },
    { flags: "--detail <text>", description: "Why, and what the owner needs to know" },
    { flags: "--task <ref>", description: "The task it is about" },
    { flags: "--reversible", description: "What you want to do can be undone (default: it cannot)" },
    { flags: "--expires <span>", description: "How long the owner has: minutes, 30m, 2h, 1d (default 1d, at most 7d)" },
  ],
  tools: ["request_approval"],
  examples: [
    'dayhand ask Deploy 2.4 to production --option "Deploy now: live in 10 minutes" --option "Wait: nothing changes until Monday" --expires 2h',
    'dayhand ask Delete old backups --task 42 --option Yes --option No --json',
  ],
  run: async (ctx, args, opts) => {
    const input: Record<string, unknown> = {
      action: (args.action as string[]).join(" "),
      options: (opts.option as string[]).map(parseOption),
      reversible: Boolean(opts.reversible),
      clientId: ctx.clientId(),
    };
    if (opts.detail !== undefined) input.detail = opts.detail;
    if (opts.task !== undefined) input.taskId = await resolveRef(ctx, String(opts.task));
    if (opts.expires !== undefined) input.expiresInMinutes = parseMinutes(String(opts.expires));
    const [value, timezone] = await Promise.all([tool<Approval>(ctx, "request_approval", input), userTimezone(ctx)]);
    return { value, view: { kind: "text", text: `Asked.\n${approvalText(value, timezone)}` } };
  },
};

const approval: CommandSpec = {
  name: "approval",
  schema: "approval.schema.json",
  summary: "One approval request and, once decided, the owner's choice",
  description: `--wait <seconds> checks every 5 s until the request is decided or expired, or the time is up. ${NEEDS}`,
  args: [{ name: "id", description: "Id of the approval request", required: true }],
  options: [{ flags: "--wait <seconds>", description: "Wait up to this many seconds for a decision", kind: "int" }],
  tools: ["get_approval"],
  examples: ["dayhand approval <id>", "dayhand approval <id> --wait 600 --json"],
  run: async (ctx, args, opts) => {
    const until = Date.now() + Number(opts.wait ?? 0) * 1000;
    let value = await tool<Approval>(ctx, "get_approval", { approvalId: args.id });
    while (value.status === "pending" && Date.now() + POLL_MS <= until) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      value = await tool<Approval>(ctx, "get_approval", { approvalId: args.id });
    }
    return { value, view: { kind: "text", text: approvalText(value, await userTimezone(ctx)) } };
  },
};

const approvals: CommandSpec = {
  name: "approvals",
  schema: "approval-list.schema.json",
  summary: "Approval requests, newest first",
  description: NEEDS,
  options: [
    { flags: "--status <status>", description: "Only pending, decided or expired requests", choices: ["pending", "decided", "expired"] },
    { flags: "--task <ref>", description: "Only requests about this task" },
    { flags: "--limit <n>", description: "At most this many, 1 to 200 (default 50)", kind: "int" },
  ],
  tools: ["list_approvals"],
  examples: ["dayhand approvals --status pending", "dayhand approvals --task 42 --json"],
  run: async (ctx, _args, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.task !== undefined) input.taskId = await resolveRef(ctx, String(opts.task));
    if (opts.limit !== undefined) input.limit = opts.limit;
    const [value, timezone] = await Promise.all([tool<{ approvals: Approval[] }>(ctx, "list_approvals", input), userTimezone(ctx)]);
    return { value, view: { kind: "text", text: listText(value.approvals, timezone) } };
  },
  subcommands: [
    {
      name: "decide",
      schema: "approval.schema.json",
      summary: "Pick an option of a pending approval request",
      description: OWNER,
      args: [
        { name: "id", description: "Id of the approval request", required: true },
        { name: "option", description: "Id of the chosen option (o1, allow, …)", required: true },
      ],
      options: [{ flags: "--note <text>", description: "A word for the agent with the decision" }],
      tools: ["decide_approval"],
      examples: ["dayhand approvals decide <id> o2 --note \"after the weekend\"", "dayhand approvals decide <id> allow"],
      run: async (ctx, args, opts) => {
        const input: Record<string, unknown> = { approvalId: args.id, optionId: args.option };
        if (opts.note !== undefined) input.note = opts.note;
        const [value, timezone] = await Promise.all([tool<Approval>(ctx, "decide_approval", input), userTimezone(ctx)]);
        return { value, view: { kind: "text", text: `Decided.\n${approvalText(value, timezone)}` } };
      },
    },
  ],
};

// ---- Pausing agents and tool policies ----

export function controlsText(controls: Controls, timezone?: string): string {
  const head = controls.paused
    ? `Agents are paused since ${formatTimestamp(controls.pausedAt!, timezone)}${controls.reason ? ` (${controls.reason})` : ""}: they read, their changes are refused.`
    : "Agents run.";
  const rules = controls.policies.map((p) => `  ${p.keyName}  ${p.tool}  ${p.rule}  (key ${p.keyId})`);
  return [head, rules.length ? "Tool policies:" : "Tool policies: none (every tool allowed)", ...rules].join("\n");
}

async function controlsOutcome(ctx: RunContext, name: string, input: Record<string, unknown> = {}) {
  const [value, timezone] = await Promise.all([tool<Controls>(ctx, name, input), userTimezone(ctx)]);
  return { value, view: { kind: "text" as const, text: controlsText(value, timezone) } };
}

const agents: CommandSpec = {
  name: "agents",
  schema: "agent-controls.schema.json",
  summary: "Whether agents are paused, and the tool policies of agent keys",
  description: NEEDS,
  tools: ["get_agent_controls"],
  examples: ["dayhand agents", "dayhand agents pause --reason holiday", "dayhand agents resume"],
  run: (ctx) => controlsOutcome(ctx, "get_agent_controls"),
  subcommands: [
    {
      name: "pause",
      schema: "agent-controls.schema.json",
      summary: "Pause every agent: they can read, their changes are refused until you resume them",
      description: OWNER,
      options: [{ flags: "--reason <text>", description: "Why; agents see it in the error" }],
      tools: ["pause_agents"],
      examples: ["dayhand agents pause", 'dayhand agents pause --reason "going on holiday"'],
      run: (ctx, _args, opts) => controlsOutcome(ctx, "pause_agents", { paused: true, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) }),
    },
    {
      name: "resume",
      schema: "agent-controls.schema.json",
      summary: "Let agents change the plan again",
      description: OWNER,
      tools: ["pause_agents"],
      examples: ["dayhand agents resume"],
      run: (ctx) => controlsOutcome(ctx, "pause_agents", { paused: false }),
    },
  ],
};

const policy: CommandSpec = {
  name: "policy",
  schema: "agent-controls.schema.json",
  summary: "Tool policies of agent keys: allow, ask (the owner approves each call) or deny",
  description: NEEDS,
  tools: ["get_agent_controls"],
  examples: ["dayhand policy", "dayhand policy set <keyId> delete_task deny", 'dayhand policy set <keyId> "*" ask'],
  run: (ctx) => controlsOutcome(ctx, "get_agent_controls"),
  subcommands: [
    {
      name: "set",
      schema: "agent-controls.schema.json",
      summary: "Set one agent key's rule for a tool that changes the plan, or \"*\" for every such tool",
      description: `The key's id comes from dayhand key list. allow removes the rule (unless "*" says otherwise). ${OWNER}`,
      args: [
        { name: "key", description: "Id of an agent API key", required: true },
        { name: "tool", description: 'A tool that changes the plan (dayhand tools), or "*"', required: true },
        { name: "rule", description: "allow, ask or deny", required: true },
      ],
      tools: ["set_tool_policy"],
      examples: ["dayhand policy set <keyId> complete_task ask"],
      run: (ctx, args) => {
        const rule = String(args.rule);
        if (!["allow", "ask", "deny"].includes(rule)) throw usageError(`rule must be allow, ask or deny, got "${rule}"`, { valid: ["allow", "ask", "deny"] });
        return controlsOutcome(ctx, "set_tool_policy", { apiKeyId: args.key, toolName: args.tool, rule });
      },
    },
  ],
};

// ---- Proposals (dayhand add --propose, dayhand proposals) ----

export const PROPOSAL_OPTIONS: OptSpec[] = [
  { flags: "--propose", description: "A proposal: it waits in the owner's inbox, out of Today, until accepted" },
  { flags: "--source <source>", description: 'Where it comes from, "<kind>:<ref>" optionally followed by a URL; one source makes one task' },
  { flags: "--requested-by <who>", description: "Who asked for it" },
  { flags: "--return-to <webhookId>", description: "A webhook that hears, with the proof, when the task closes (dayhand webhook list)" },
];

const SOURCE = /^([A-Za-z0-9][A-Za-z0-9._-]*):(\S+)(?:\s+(\S+))?$/;

/** --source "sentry:CHECKOUT-42 https://…" as {kind, ref, url}. */
export function parseSource(text: string): { kind: string; ref: string; url?: string } {
  const match = SOURCE.exec(text.trim());
  if (!match) throw usageError(`--source takes "<kind>:<ref>", optionally followed by a URL, got "${text}"`);
  return match[3] ? { kind: match[1]!, ref: match[2]!, url: match[3] } : { kind: match[1]!, ref: match[2]! };
}

/** The proposal fields of dayhand add. */
export function proposalArgs(opts: Opts, input: Record<string, unknown>) {
  if (opts.propose) input.proposal = true;
  if (opts.source !== undefined) input.source = parseSource(String(opts.source));
  if (opts.requestedBy !== undefined) input.requestedBy = opts.requestedBy;
  if (opts.returnTo !== undefined) input.returnTo = opts.returnTo;
}

const proposalLine = (task: Task) => {
  const source = task.source as { kind: string; ref: string } | undefined;
  const from = [task.requestedBy ? `from ${task.requestedBy}` : "", source ? `${source.kind}:${source.ref}` : ""].filter(Boolean).join(", ");
  return `${refOf(task)} ${task.title}${from ? `  (${from})` : ""}`;
};

const proposals: CommandSpec = {
  name: "proposals",
  schema: "task-list.schema.json",
  summary: "The proposal inbox: tasks agents and integrations proposed, waiting for you",
  description: `Accept, merge or reject them with the subcommands; proposals stay out of Today, list and the board until accepted. ${NEEDS}`,
  tools: ["list_all"],
  fields: "task",
  examples: ["dayhand proposals", "dayhand proposals accept 42", "dayhand proposals merge 43 --into 12", 'dayhand proposals reject 44 --reason "not now"'],
  run: async (ctx) => {
    const value = await tool<{ result: Task[]; total: number }>(ctx, "list_all", { proposed: true, limit: 200 });
    const text = value.result.length === 0 ? "(no proposals)" : value.result.map(proposalLine).join("\n");
    return { value, view: { kind: "text", text } };
  },
  subcommands: [
    {
      name: "accept",
      schema: "task.schema.json",
      summary: "Accept a proposal: it joins the plan as it is",
      description: OWNER,
      args: [{ name: "ref", description: "The proposal: #42 or 42", required: true }],
      tools: ["accept_proposal"],
      fields: "task",
      examples: ["dayhand proposals accept 42"],
      run: async (ctx, args) => {
        const task = await tool<Task>(ctx, "accept_proposal", { taskId: await resolveRef(ctx, String(args.ref)), clientId: ctx.clientId() });
        return { value: task, view: { kind: "task", verb: "Accepted", task } };
      },
    },
    {
      name: "merge",
      schema: "merge.schema.json",
      summary: "Merge a proposal into a task already in the plan; the proposal goes to the trash",
      description: `The task gets the proposal's note, links, labels, source and return webhooks. ${OWNER}`,
      args: [{ name: "ref", description: "The proposal: #42 or 42", required: true }],
      options: [{ flags: "--into <ref>", description: "The task to merge it into (required)" }],
      tools: ["merge_proposal"],
      examples: ["dayhand proposals merge 43 --into 12"],
      run: async (ctx, args, opts) => {
        if (opts.into === undefined) throw usageError("--into <ref> names the task to merge the proposal into");
        const input = { taskId: await resolveRef(ctx, String(args.ref)), intoTaskId: await resolveRef(ctx, String(opts.into)), clientId: ctx.clientId() };
        const value = await tool<{ task: Task; merged: Task | null }>(ctx, "merge_proposal", input);
        return { value, view: { kind: "task", verb: "Merged into", task: value.task } };
      },
    },
    {
      name: "reject",
      schema: "task.schema.json",
      summary: "Reject a proposal: it goes to the trash (restorable for 30 days)",
      description: OWNER,
      args: [{ name: "ref", description: "The proposal: #42 or 42", required: true }],
      options: [{ flags: "--reason <text>", description: "Why; the return webhook gets it" }],
      tools: ["reject_proposal"],
      fields: "task",
      examples: ['dayhand proposals reject 44 --reason "not this quarter"'],
      run: async (ctx, args, opts) => {
        const input: Record<string, unknown> = { taskId: await resolveRef(ctx, String(args.ref)), clientId: ctx.clientId() };
        if (opts.reason !== undefined) input.reason = opts.reason;
        const task = await tool<Task>(ctx, "reject_proposal", input);
        return { value: task, view: { kind: "task", verb: "Rejected", task } };
      },
    },
  ],
};

// ---- The plan health report ----

type Brief = { ref: number | null; title: string; dueDate: string | null };
type Section<T = Brief> = { count: number; tasks: (Brief & T)[] };
export type Health = {
  agentsPaused: boolean;
  overdue: Section;
  dueToday: Section;
  inProgress: Section<{ workingBy: string | null }>;
  expiredClaims: Section<{ claimedBy: string }>;
  blocked: Section<{ reasons: string[] }>;
  awaitingApproval: Section<{ approvals: number }> & { pendingApprovals: number };
  proposals: { count: number };
  completedToday: Section<{ proof: boolean }> & { withProof: number; withoutProof: number };
  oldestOpen: (Brief & { ageDays: number }) | null;
};

const name = (t: Brief) => `${t.ref !== null ? `#${t.ref}` : ""} ${t.title}`.trim();

/** The report as `dayhand health` prints it: a line per section, the tasks behind it indented. */
export function healthText(h: Health): string {
  const lines: string[] = [];
  if (h.agentsPaused) lines.push("Agents are paused (dayhand agents resume).");
  const section = <T>(title: string, s: Section<T>, extra: (t: Brief & T) => string = () => "") => {
    lines.push(`${title}: ${s.count}`);
    for (const t of s.tasks) lines.push(`  ${name(t)}${extra(t)}`);
  };
  section("Overdue", h.overdue, (t) => (t.dueDate ? `  (due ${t.dueDate})` : ""));
  section("Due today", h.dueToday);
  section("In progress", h.inProgress, (t) => (t.workingBy ? `  (${t.workingBy})` : ""));
  section("Claims run out", h.expiredClaims, (t) => `  (was ${t.claimedBy})`);
  section("Blocked", h.blocked, (t) => `  (${t.reasons.join("; ")})`);
  section("Waiting for approval", h.awaitingApproval);
  lines.push(`Approval requests pending: ${h.awaitingApproval.pendingApprovals}`);
  lines.push(`Proposals in the inbox: ${h.proposals.count}`);
  lines.push(`Done today: ${h.completedToday.count} (${h.completedToday.withProof} with proof, ${h.completedToday.withoutProof} without)`);
  lines.push(h.oldestOpen ? `Oldest open: ${name(h.oldestOpen)}, ${h.oldestOpen.ageDays} days` : "Oldest open: none");
  return lines.join("\n");
}

const health: CommandSpec = {
  name: "health",
  schema: "plan-health.schema.json",
  summary: "What needs a look: overdue, blocked, stale claims, approvals, proposals, done without proof",
  description: `Each section counts every task and lists the first 20. ${NEEDS}`,
  tools: ["plan_health"],
  examples: ["dayhand health", "dayhand health --json"],
  run: async (ctx) => {
    const value = await tool<Health>(ctx, "plan_health");
    return { value, view: { kind: "text", text: healthText(value) } };
  },
};

export const ownerCommands: CommandSpec[] = [ask, approval, approvals, agents, policy, proposals, health];
