// The agent brief (agent_brief, dayhand prime): what an agent needs at the start
// of a session, from its own point of view. It is list_today with more fields:
// the claims in force and the caller's own, the owner's pause and the caller's
// tool policies, approval requests waiting and the caller's recent decisions,
// the first tasks ready to work on, and next steps written out as sentences.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getAgentControls } from "./agentControls";
import { isReady, sameHolder } from "./agentWork";
import { statusOf } from "./approvals";
import type { args } from "./args";
import { loadSettings, type Identity } from "./core";
import { localDateTime } from "./dates";
import { listToday } from "./views";

type Args = ObjectType<(typeof args)["agentBrief"]>;

/** Items listed per section; `count` counts them all. */
export const BRIEF_LIST = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVAL_WINDOW_MS = 7 * DAY_MS;

const brief = (t: Doc<"tasks">) => ({ id: t._id, ref: t.ref ?? null, title: t.title, status: t.status, dueDate: t.dueDate ?? null, dueTime: t.dueTime ?? null });
const label = (t: Doc<"tasks">) => `#${t.ref ?? t._id} ${t.title}`;
const section = <T>(items: T[]) => ({ count: items.length, items: items.slice(0, BRIEF_LIST) });

const byDue = (a: Doc<"tasks">, b: Doc<"tasks">) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || (a.ref ?? 0) - (b.ref ?? 0);

function claimView(t: Doc<"tasks">, identity: Identity) {
  return { ...brief(t), claimedBy: t.claimedBy!.name, claimExpiresAt: t.claimExpiresAt ?? null, mine: sameHolder(t.claimedBy, identity) };
}

function approvalItem(a: Doc<"approvals">, tasks: Map<string, Doc<"tasks">>, identity: Identity) {
  const task = a.taskId ? tasks.get(a.taskId) : undefined;
  const chosen = a.options.find((o) => o.id === a.optionId);
  return {
    id: a._id,
    action: a.title,
    taskId: a.taskId ?? null,
    ref: task?.ref ?? null,
    expiresAt: a.expiresAt,
    requestedBy: a.requestedBy.name,
    mine: sameHolder(a.requestedBy, identity),
    decision: a.decidedAt === undefined ? null : { optionId: a.optionId!, label: chosen?.label ?? a.optionId!, note: a.note ?? null, decidedAt: a.decidedAt },
  };
}

type Facts = {
  paused: boolean;
  reason: string | null;
  mine: Doc<"tasks">[];
  expiredMine: Doc<"tasks">[];
  decided: Doc<"approvals">[];
  waiting: Doc<"approvals">[];
  overdue: number;
  ready: Doc<"tasks">[];
  timezone: string;
};

/** The next steps, most pressing first, as sentences that name the tools and resources to use. */
function nextSteps(f: Facts): string[] {
  const at = (ms: number) => localDateTime(ms, f.timezone);
  if (f.paused) {
    return [`The owner paused all agents${f.reason ? ` (${f.reason})` : ""}: read, but change nothing until they resume you; do not retry in a loop.`];
  }
  const steps = [
    ...f.decided.map((a) => `The owner decided "${a.title}": ${a.options.find((o) => o.id === a.optionId)?.label ?? a.optionId}${a.note ? ` (${a.note})` : ""}. Act on that choice and nothing else.`),
    ...f.mine.map((t) => `You hold ${label(t)} until ${at(t.claimExpiresAt!)}: renew_claim while you work, then complete_task with proof, or release_task with a checkpoint note (dayhand://workflow/execution).`),
    ...f.expiredMine.map((t) => `Your claim of ${label(t)} ran out at ${at(t.claimExpiresAt!)}: renew_claim to go on (nobody took it over) or release_task.`),
    ...f.waiting.map((a) => `Waiting for the owner on "${a.title}" until ${at(a.expiresAt)}: check get_approval before that step, and do not take it without a decision.`),
  ];
  if (f.overdue > 0) steps.push(`${f.overdue} task(s) are overdue: go through them with the owner (the prompt triage_overdue) before moving any.`);
  if (f.mine.length === 0 && f.ready[0]) steps.push(`Ready to work on: ${label(f.ready[0])}. claim_task it first; write acceptance criteria if it has none (dayhand://workflow/intake).`);
  if (f.mine.length === 0 && f.ready.length === 0) steps.push("Nothing is ready to work on: ask the owner, or propose work with add_task and proposal: true (dayhand://workflow/intake).");
  return steps;
}

export async function agentBrief(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const today = await listToday(ctx, identity, { at });
  const { timezone } = await loadSettings(ctx, identity.userId);
  const controls = await getAgentControls(ctx, identity);
  const all = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const byId = new Map(all.map((t) => [t._id as string, t]));
  const open = all.filter((t) => t.deletedAt === undefined && t.archivedAt === undefined && t.proposedAt === undefined && t.status !== "done");
  const live = (t: Doc<"tasks">) => t.claimedBy !== undefined && (t.claimExpiresAt ?? 0) > at;
  const active = open.filter(live).sort((a, b) => a.claimExpiresAt! - b.claimExpiresAt!);
  const expired = open.filter((t) => t.claimedBy !== undefined && !live(t)).sort((a, b) => a.claimExpiresAt! - b.claimExpiresAt!);
  const ready = open.filter((t) => isReady(t, byId) && !(live(t) && !sameHolder(t.claimedBy, identity))).sort(byDue);

  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId).gte("createdAt", at - APPROVAL_WINDOW_MS))
    .collect();
  const pending = approvals.filter((a) => statusOf(a, at) === "pending").sort((a, b) => a.expiresAt - b.expiresAt);
  const decided = approvals.filter((a) => a.decidedAt !== undefined && a.decidedAt > at - DAY_MS && sameHolder(a.requestedBy, identity)).sort((a, b) => b.decidedAt! - a.decidedAt!);
  const mine = active.filter((t) => sameHolder(t.claimedBy, identity));

  return {
    ...today,
    at,
    caller: { type: identity.actor, name: identity.actorName ?? null },
    agentsPaused: controls.paused,
    pausedReason: controls.reason,
    policies: controls.policies.filter((p) => p.keyId === identity.keyId).map(({ tool, rule }) => ({ tool, rule })),
    claims: {
      active: section(active.map((t) => claimView(t, identity))),
      expired: section(expired.map((t) => claimView(t, identity))),
    },
    approvals: {
      pending: section(pending.map((a) => approvalItem(a, byId, identity))),
      decided: section(decided.map((a) => approvalItem(a, byId, identity))),
    },
    ready: section(ready.map(brief)),
    nextSteps: nextSteps({
      paused: controls.paused,
      reason: controls.reason,
      mine,
      expiredMine: expired.filter((t) => sameHolder(t.claimedBy, identity)),
      decided,
      waiting: pending.filter((a) => sameHolder(a.requestedBy, identity)),
      overdue: today.overdue.length,
      ready,
      timezone,
    }),
  };
}
