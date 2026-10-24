// `dayhand prime`: a short context block for an agent's session start (a
// SessionStart hook, a system prompt): Today, the agent brief (claims,
// approvals, ready work, next steps) and the rules of the road.
import { CliError } from "../core/exit.js";
import { AGENT_RULES } from "../guide.js";
import { formatTimestamp } from "../render/format.js";
import type { TodayView } from "../render/model.js";
import { PLAIN_STYLE } from "../render/style.js";
import { renderHuman } from "../render/views.js";
import { tool } from "./ops.js";
import type { CommandSpec } from "./types.js";

type Section<T> = { count: number; items: T[] };
type Named = { ref: number | null; title: string };
type Claim = { ref: number | null; title: string; claimedBy: string; claimExpiresAt: number | null; mine: boolean };
type Approval = { id: string; action: string; ref: number | null; expiresAt: number; mine: boolean; decision: { label: string } | null };

/** agent_brief (backend 0.12.0): list_today and what an agent needs at the start of a session. */
export type AgentBrief = TodayView & {
  agentsPaused: boolean;
  pausedReason: string | null;
  policies: { tool: string; rule: string }[];
  claims: { active: Section<Claim>; expired: Section<Claim> };
  approvals: { pending: Section<Approval>; decided: Section<Approval> };
  ready: Section<Named>;
  nextSteps: string[];
};

const name = (t: Named) => `#${t.ref ?? "?"} ${t.title}`;
const more = (section: Section<unknown>) => (section.count > section.items.length ? ` (${section.count} in all)` : "");

/** The brief's own lines, in the user's time zone; empty sections are left out. */
export function briefLines(brief: AgentBrief): string[] {
  const at = (ms: number | null) => (ms === null ? "?" : formatTimestamp(ms, brief.timezone));
  const claim = (c: Claim) => `${name(c)}, ${c.mine ? "you" : c.claimedBy}, until ${at(c.claimExpiresAt)}`;
  const request = (a: Approval) => `"${a.action}"${a.ref === null ? "" : ` (#${a.ref})`}${a.mine ? ", yours" : ""}, until ${at(a.expiresAt)}`;
  const lines = [brief.agentsPaused ? `Agents: PAUSED by the owner${brief.pausedReason ? ` (${brief.pausedReason})` : ""}` : "Agents: running"];
  if (brief.policies.length) lines.push(`Your tool policies: ${brief.policies.map((p) => `${p.tool} ${p.rule}`).join(", ")}`);
  const sections: [string, Section<any>, (item: any) => string][] = [
    ["Claims", brief.claims.active, claim],
    ["Claims that ran out", brief.claims.expired, claim],
    ["Waiting for the owner", brief.approvals.pending, request],
    ["Decided for you", brief.approvals.decided, (a: Approval) => `"${a.action}": ${a.decision?.label ?? "?"}`],
    ["Ready to work on", brief.ready, name],
  ];
  for (const [title, section, line] of sections) {
    if (section.count > 0) lines.push(`${title}${more(section)}:`, ...section.items.map((item) => `  ${line(item)}`));
  }
  return lines;
}

export function primeText(view: TodayView | AgentBrief): string {
  const brief = "nextSteps" in view ? view : null;
  return [
    "# Dayhand tasks (dayhand)",
    "",
    // No colors and no cutting: the text goes into a context window, not a terminal.
    renderHuman({ kind: "today", view }, view, undefined, { style: PLAIN_STYLE, today: view.date }),
    ...(brief ? ["", "## Agent brief", ...briefLines(brief)] : []),
    ...(brief?.nextSteps.length ? ["", "## Next steps", ...brief.nextSteps.map((step) => `- ${step}`)] : []),
    "",
    "## Using dayhand",
    ...AGENT_RULES.map((rule) => `- ${rule}`),
    "- Phase guides for one task: the MCP resources dayhand://workflow/intake, /execution and /finalization.",
    "- Reference: dayhand help, dayhand <command> --help, dayhand tools.",
  ].join("\n");
}

const unknownTool = (error: unknown) => error instanceof CliError && error.code === "invalid_argument" && /unknown tool/i.test(error.message);

const prime: CommandSpec = {
  name: "prime",
  schema: "agent-brief.schema.json",
  summary: "Context for an AI agent: Today, its claims, approvals, ready work, next steps and how to use dayhand (for a SessionStart hook)",
  description:
    "Prints plain text without colors in every format except --json, which prints agent_brief: list_today's fields plus claims, approvals, ready tasks and nextSteps (a backend before 0.12.0 gives list_today alone). " +
    'In a Claude Code hook: {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"dayhand prime"}]}]}}.',
  tools: ["agent_brief", "list_today"],
  examples: ["dayhand prime", "dayhand prime --json"],
  run: async (ctx) => {
    const view = await tool<AgentBrief>(ctx, "agent_brief").catch(async (error) => {
      if (!unknownTool(error)) throw error;
      return tool<TodayView>(ctx, "list_today");
    });
    return { value: view, view: { kind: "text", text: primeText(view) } };
  },
};

export const agentCommands: CommandSpec[] = [prime];
