// The plan health report (docs/agent-work.md#8-the-plan-health-report): in one read,
// what needs a look: overdue and today's tasks, what is in progress and who
// works on it, claims that ran out, blocked tasks and why, tasks waiting for
// an approval, proposals, what was done today with and without proof, and how
// old the oldest open task is. Only work that owes proof counts as done without
// it: a task an agent completed, or one with acceptance criteria. The phone
// shows the same as a card above Today.
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

const hasCriteria = (t: Doc<"tasks">) => (t.acceptance?.length ?? 0) > 0;

/** Who completed the task last: the actor of its latest "complete" event. */
async function completedByAgent(ctx: QueryCtx, task: Doc<"tasks">) {
  const event = await ctx.db
    .query("taskEvents")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .filter((q) => q.eq(q.field("action"), "complete"))
    .first();
  return event?.actor === "agent";
}

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

const isLive = (t: Doc<"tasks">) => t.deletedAt === undefined && t.archivedAt === undefined;

/** Reads only what the report can show, and history only for today's tasks done without proof: polled every minute, it must stay cheap. */
export async function planHealth(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const { userId } = identity;
  const { timezone } = await loadSettings(ctx, userId);
  const today = localDate(at, timezone);
  const withStatus = (status: "todo" | "doing") =>
    ctx.db
      .query("tasks")
      .withIndex("by_user_status_dueDate", (q) => q.eq("userId", userId).eq("status", status))
      .collect();
  const notDone = [...(await withStatus("todo")), ...(await withStatus("doing"))].sort((a, b) => a._creationTime - b._creationTime);
  const byId = new Map(notDone.map((t) => [t._id as string, t]));
  const open = notDone.filter((t) => isLive(t) && t.proposedAt === undefined);
  const proposals = (
    await ctx.db
      .query("tasks")
      .withIndex("by_user_proposedAt", (q) => q.eq("userId", userId).gt("proposedAt", 0))
      .collect()
  ).filter(isLive);
  const recentlyDone = await ctx.db
    .query("tasks")
    .withIndex("by_user_completedAt", (q) => q.eq("userId", userId).gte("completedAt", at - 2 * DAY_MS))
    .collect();

  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("createdAt", at - APPROVAL_WINDOW_MS))
    .collect();
  const pending = approvals.filter((a) => statusOf(a, at) === "pending");
  const waiting = new Map<string, number>();
  for (const approval of pending) if (approval.taskId) waiting.set(approval.taskId, (waiting.get(approval.taskId) ?? 0) + 1);

  const doneToday = recentlyDone
    .filter((t) => t.status === "done" && isLive(t) && t.proposedAt === undefined && localDate(t.completedAt!, timezone) === today)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const withProof = doneToday.filter(hasProof).length;
  let withoutProof = 0;
  for (const t of doneToday) {
    if (!hasProof(t) && (hasCriteria(t) || (await completedByAgent(ctx, t)))) withoutProof += 1;
  }
  const blocked = open.map((t) => ({ task: t, reasons: reasonsOf(t, byId) })).filter((b) => b.reasons.length > 0);
  const oldest = [...open].sort((a, b) => a.createdAt - b.createdAt)[0];
  const liveClaim = (t: Doc<"tasks">) => t.claimedBy !== undefined && (t.claimExpiresAt ?? 0) > at;

  return {
    at,
    date: today,
    timezone,
    agentsPaused: await agentsPaused(ctx, userId),
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
      withoutProof,
    },
    oldestOpen: oldest ? { ...brief(oldest), createdAt: oldest.createdAt, ageDays: Math.max(0, Math.floor((at - oldest.createdAt) / DAY_MS)) } : null,
  };
}
