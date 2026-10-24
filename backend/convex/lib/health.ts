// The plan health report (docs/agent-work.md#8-the-plan-health-report): in one read,
// what needs a look: overdue and today's tasks, what is in progress and who
// works on it, claims that ran out, blocked tasks and why, tasks waiting for
// an approval, proposals, what was done today with and without proof, and how
// old the oldest open task is. The phone shows the same as a card above Today.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { agentsPaused } from "./agentControls";
import { statusOf } from "./approvals";
import type { args } from "./args";
import { loadSettings, type Identity } from "./core";
import { isOverdue, localDate } from "./dates";

type Args = ObjectType<(typeof args)["planHealth"]>;

/** Tasks listed per section; `count` always counts them all. */
export const HEALTH_LIST = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest an approval request can wait, so older ones need not be read. */
const APPROVAL_WINDOW_MS = 7 * DAY_MS;

const brief = (t: Doc<"tasks">) => ({
  id: t._id,
  ref: t.ref ?? null,
  title: t.title,
  status: t.status,
  dueDate: t.dueDate ?? null,
  dueTime: t.dueTime ?? null,
});

function section<T>(items: T[]) {
  return { count: items.length, tasks: items.slice(0, HEALTH_LIST) };
}

const hasProof = (t: Doc<"tasks">) => Boolean(t.proof?.summary || t.proof?.links?.length || t.proof?.checks?.length);

const byDue = (a: Doc<"tasks">, b: Doc<"tasks">) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.createdAt - b.createdAt;

/** Why a task cannot go on: its blocked reason, and every dependency that is not done yet. */
function reasonsOf(task: Doc<"tasks">, byId: Map<string, Doc<"tasks">>): string[] {
  const reasons = task.blockedReason !== undefined ? [task.blockedReason] : [];
  for (const id of task.dependsOn ?? []) {
    const dependency = byId.get(id);
    if (dependency && dependency.deletedAt === undefined && dependency.status !== "done") {
      reasons.push(`waiting for #${dependency.ref ?? dependency._id} ${dependency.title}`);
    }
  }
  return reasons;
}

export async function planHealth(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const { timezone } = await loadSettings(ctx, identity.userId);
  const today = localDate(at, timezone);
  const all = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const byId = new Map(all.map((t) => [t._id as string, t]));
  const live = all.filter((t) => t.deletedAt === undefined && t.archivedAt === undefined);
  const proposals = live.filter((t) => t.proposedAt !== undefined);
  const plan = live.filter((t) => t.proposedAt === undefined);
  const open = plan.filter((t) => t.status !== "done");

  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId).gte("createdAt", at - APPROVAL_WINDOW_MS))
    .collect();
  const pending = approvals.filter((a) => statusOf(a, at) === "pending");
  const waiting = new Map<string, number>();
  for (const approval of pending) if (approval.taskId) waiting.set(approval.taskId, (waiting.get(approval.taskId) ?? 0) + 1);

  const doneToday = plan
    .filter((t) => t.status === "done" && t.completedAt !== undefined && localDate(t.completedAt, timezone) === today)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const withProof = doneToday.filter(hasProof).length;
  const blocked = open.map((t) => ({ task: t, reasons: reasonsOf(t, byId) })).filter((b) => b.reasons.length > 0);
  const oldest = [...open].sort((a, b) => a.createdAt - b.createdAt)[0];
  const liveClaim = (t: Doc<"tasks">) => t.claimedBy !== undefined && (t.claimExpiresAt ?? 0) > at;

  return {
    at,
    date: today,
    timezone,
    agentsPaused: await agentsPaused(ctx, identity.userId),
    overdue: section(open.filter((t) => isOverdue(t, today)).sort(byDue).map(brief)),
    dueToday: section(open.filter((t) => t.dueDate === today).sort(byDue).map(brief)),
    inProgress: section(
      open
        .filter((t) => t.status === "doing")
        .sort(byDue)
        .map((t) => ({ ...brief(t), isNow: t.isNow, workingBy: liveClaim(t) ? `agent: ${t.claimedBy!.name}` : null })),
    ),
    expiredClaims: section(
      open
        .filter((t) => t.claimedBy !== undefined && !liveClaim(t))
        .sort((a, b) => (a.claimExpiresAt ?? 0) - (b.claimExpiresAt ?? 0))
        .map((t) => ({ ...brief(t), claimedBy: t.claimedBy!.name, claimExpiresAt: t.claimExpiresAt ?? null })),
    ),
    blocked: section(blocked.map(({ task, reasons }) => ({ ...brief(task), reasons }))),
    awaitingApproval: {
      ...section(open.filter((t) => waiting.has(t._id)).map((t) => ({ ...brief(t), approvals: waiting.get(t._id)! }))),
      pendingApprovals: pending.length,
    },
    proposals: { count: proposals.length },
    completedToday: {
      ...section(doneToday.map((t) => ({ ...brief(t), proof: hasProof(t) }))),
      withProof,
      withoutProof: doneToday.length - withProof,
    },
    oldestOpen: oldest ? { ...brief(oldest), createdAt: oldest.createdAt, ageDays: Math.floor((at - oldest.createdAt) / DAY_MS) } : null,
  };
}
