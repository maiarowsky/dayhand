// The proposal inbox (docs/agent-work.md#7-the-proposal-inbox): a task an agent or
// an integration adds with `proposal: true` waits in the inbox, out of Today,
// the board, list_all and the calendar, until the owner accepts it, merges it
// into a task that already exists, or rejects it. A task can name its source
// (an alert, an issue) so the same source never makes two tasks, and webhooks
// to tell (task.returned, with the proof) when it closes.
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { checkLinks, fail, loadTask, ownerOnly, patchTask, replay, toTask, type Identity } from "./core";
import type { TaskSource } from "./validators";
import { queueReturn, type ReturnOutcome } from "./webhookEvents";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

const LIMITS = { kind: 50, ref: 200, url: 2_048, requestedBy: 200, reason: 1_000, labels: 20, links: 20, note: 20_000 };
const SOURCE_KIND = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---- Fields of a new task ----

/** The source as stored: a kind such as "sentry" or "github-issue", the item's id there, an optional http(s) link. */
export function checkSource(source: TaskSource): TaskSource {
  const kind = source.kind.trim();
  if (!SOURCE_KIND.test(kind) || kind.length > LIMITS.kind) {
    fail("invalid_argument", `source.kind is 1 to ${LIMITS.kind} letters, digits, ".", "-" or "_", starting with a letter or digit`);
  }
  const ref = source.ref.trim();
  if (!ref || ref.length > LIMITS.ref) fail("invalid_argument", `source.ref must be 1 to ${LIMITS.ref} characters`);
  if (source.url === undefined) return { kind, ref };
  const [link] = checkLinks([{ url: source.url }]);
  return { kind, ref, url: link!.url };
}

/** The task a source already made, if any (also when it sits in the trash: the owner said no to it). */
export async function taskOfSource(ctx: QueryCtx, userId: string, source: TaskSource): Promise<Doc<"tasks"> | null> {
  const row = await ctx.db
    .query("taskSources")
    .withIndex("by_user_source", (q) => q.eq("userId", userId).eq("kind", source.kind).eq("ref", source.ref))
    .first();
  return row ? ctx.db.get(row.taskId) : null;
}

export async function addSource(ctx: MutationCtx, userId: string, source: TaskSource, taskId: Id<"tasks">) {
  await ctx.db.insert("taskSources", { userId, kind: source.kind, ref: source.ref, taskId });
}

/**
 * Who asked for the task: as given; for an agent's proposal, else the agent
 * itself, so the inbox always says who proposed it. Other tasks have history for that.
 */
export function checkRequestedBy(identity: Identity, requestedBy: string | undefined, proposal: boolean): string | undefined {
  if (requestedBy !== undefined) {
    const value = requestedBy.trim();
    if (value.length > LIMITS.requestedBy) fail("invalid_argument", `requestedBy is longer than ${LIMITS.requestedBy} characters`);
    if (value) return value;
  }
  return proposal && identity.actor === "agent" ? `agent: ${identity.actorName ?? "agent"}` : undefined;
}

/** returnTo: one of the user's webhooks, which gets task.returned when the task closes. */
export async function checkReturnTo(ctx: QueryCtx, userId: string, webhookId: string): Promise<Id<"webhooks">[]> {
  const id = ctx.db.normalizeId("webhooks", webhookId);
  const webhook = id ? await ctx.db.get(id) : null;
  if (!id || !webhook || webhook.userId !== userId) fail("invalid_argument", `returnTo must be the id of one of your webhooks, got "${webhookId}"`);
  return [id];
}

/** Work on a proposal waits until the owner accepts it. */
export function notProposal(task: Doc<"tasks">) {
  if (task.proposedAt !== undefined) {
    fail("invalid_argument", `Task #${task.ref ?? task._id} is a proposal; it can be worked on once the owner accepts it`);
  }
  return task;
}

function proposal(task: Doc<"tasks">) {
  if (task.deletedAt !== undefined) fail("invalid_argument", "Task is in the trash; restore it first");
  if (task.proposedAt === undefined) fail("invalid_argument", `Task #${task.ref ?? task._id} is not a proposal`);
  return task;
}

const eventActor = (identity: Identity) => ({ type: identity.actor, name: identity.actorName ?? null });

/** Tells the task's return webhooks it closed (task.returned). */
export async function sendReturn(ctx: MutationCtx, identity: Identity, task: Doc<"tasks">, outcome: ReturnOutcome, details: Record<string, unknown> = {}) {
  if (!task.returnTo?.length) return;
  await queueReturn(ctx, task, outcome, details, eventActor(identity), toTask);
}

// ---- The owner's decisions ----

/** accept_proposal: the task joins the plan as it is. */
export async function acceptProposal(ctx: MutationCtx, identity: Identity, input: Args<"acceptProposal">) {
  ownerOnly(identity, "accept proposals");
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = proposal(await loadTask(ctx, identity.userId, input.taskId));
  return toTask(await patchTask(ctx, identity, task, "accept", { proposedAt: undefined }, input.clientId));
}

/** reject_proposal: the proposal goes to the trash (30 days, restorable) and its return webhooks hear "rejected". */
export async function rejectProposal(ctx: MutationCtx, identity: Identity, input: Args<"rejectProposal">) {
  ownerOnly(identity, "reject proposals");
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) return toTask(replayed);
  const task = proposal(await loadTask(ctx, identity.userId, input.taskId));
  const reason = input.reason?.trim().slice(0, LIMITS.reason) || undefined;
  const rejected = await patchTask(ctx, identity, task, "reject", { deletedAt: Date.now() }, input.clientId);
  await sendReturn(ctx, identity, rejected, "rejected", { reason: reason ?? null });
  return toTask(rejected);
}

const union = <T>(a: T[], b: T[], key: (item: T) => string) => [...new Map([...a, ...b].map((item) => [key(item), item])).values()];

/**
 * merge_proposal: the proposal is folded into a task already in the plan. The
 * task gets its note (after a line naming it), links, labels, sources and
 * return webhooks; the proposal goes to the trash with mergedInto. Its return
 * webhooks hear "merged" now and "completed" when that task is done.
 */
export async function mergeProposal(ctx: MutationCtx, identity: Identity, input: Args<"mergeProposal">) {
  ownerOnly(identity, "merge proposals");
  const replayed = await replay(ctx, identity.userId, input.clientId);
  if (replayed) {
    // A retry: the same answer as the first time, the target and the merged proposal.
    const events = await ctx.db
      .query("taskEvents")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", input.clientId))
      .collect();
    const mergedId = events.find((e) => e.action === "merge")?.taskId;
    const merged = mergedId ? await ctx.db.get(mergedId) : null;
    return { task: toTask(replayed), merged: merged ? toTask(merged) : null };
  }
  const from = proposal(await loadTask(ctx, identity.userId, input.taskId));
  const into = await loadTask(ctx, identity.userId, input.intoTaskId);
  if (into._id === from._id) fail("invalid_argument", "A proposal cannot be merged into itself");
  if (into.deletedAt !== undefined) fail("invalid_argument", "The task to merge into is in the trash; restore it first");
  if (into.proposedAt !== undefined) fail("invalid_argument", "The task to merge into is a proposal too; accept it first");

  const heading = `Merged from #${from.ref ?? from._id}: ${from.title}`;
  const note = [into.note, heading, from.note].filter((part) => part !== undefined && part !== "").join("\n\n").slice(0, LIMITS.note);
  const links = union(into.links, from.links, (link) => link.url);
  const labels = union(into.labels, from.labels, (label) => label);
  const patch: Partial<Doc<"tasks">> = {
    note,
    links: links.length > LIMITS.links ? into.links : links,
    labels: labels.length > LIMITS.labels ? into.labels : labels,
  };
  const returnTo = union(into.returnTo ?? [], from.returnTo ?? [], (id) => id);
  if (returnTo.length) patch.returnTo = returnTo;
  if (into.source === undefined && from.source !== undefined) patch.source = from.source;
  const target = await patchTask(ctx, identity, into, "update", patch, input.clientId);
  const sources = await ctx.db
    .query("taskSources")
    .withIndex("by_task", (q) => q.eq("taskId", from._id))
    .collect();
  for (const row of sources) await ctx.db.patch(row._id, { taskId: target._id });
  const merged = await patchTask(ctx, identity, from, "merge", { deletedAt: Date.now(), mergedInto: target._id }, input.clientId);
  await sendReturn(ctx, identity, merged, "merged", { mergedInto: toTask(target) });
  return { task: toTask(target), merged: toTask(merged) };
}

/** The inbox, newest first. */
export async function listProposals(ctx: QueryCtx, identity: Identity) {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user_proposedAt", (q) => q.eq("userId", identity.userId).gt("proposedAt", 0))
    .order("desc")
    .collect();
  return tasks.filter((t) => t.deletedAt === undefined).map(toTask);
}
