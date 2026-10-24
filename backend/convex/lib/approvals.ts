// Approval requests (docs/agent-work.md#5-approval-requests): an agent asks the
// owner before it does something, with 2 to 4 options and what each one leads
// to; the owner decides on the phone before the request expires. Dayhand keeps
// the request and the decision; acting on the decision is up to the agent,
// except for the requests a tool policy "ask" makes (source "policy", lib/agentControls.ts):
// an "allow" there lets exactly one matching call through.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { checkClientId, fail, loadTask, ownerOnly, recordEvent, type Identity } from "./core";
import { sha256Hex } from "./secrets";
import type { ApprovalOption, ApprovalOptionInput } from "./validators";
import { queueApprovalDecided } from "./webhookEvents";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

const LIMITS = {
  action: 200,
  detail: 4_000,
  minOptions: 2,
  maxOptions: 4,
  optionId: 32,
  label: 100,
  consequence: 500,
  note: 1_000,
  minutes: 7 * 24 * 60,
  list: 200,
  arguments: 2_000,
};

export const DEFAULT_APPROVAL_MINUTES = 24 * 60;
/** How long a policy request waits for the owner. */
export const POLICY_APPROVAL_MINUTES = 60;
const DEFAULT_LIST = 50;

export type ApprovalStatus = "pending" | "decided" | "expired";

export const statusOf = (approval: Doc<"approvals">, now: number): ApprovalStatus =>
  approval.decidedAt !== undefined ? "decided" : now >= approval.expiresAt ? "expired" : "pending";

/** An approval request as clients see it. */
export async function approvalView(ctx: QueryCtx, approval: Doc<"approvals">, now = Date.now()) {
  const task = approval.taskId ? await ctx.db.get(approval.taskId) : null;
  const chosen = approval.options.find((option) => option.id === approval.optionId);
  return {
    id: approval._id,
    taskId: approval.taskId ?? null,
    ref: task?.ref ?? null,
    taskTitle: task?.title ?? null,
    action: approval.title,
    detail: approval.detail ?? null,
    options: approval.options.map((option) => ({ id: option.id, label: option.label, consequence: option.consequence ?? null })),
    reversible: approval.reversible,
    status: statusOf(approval, now),
    expiresAt: approval.expiresAt,
    createdAt: approval.createdAt,
    requestedBy: { type: approval.requestedBy.actor, name: approval.requestedBy.name },
    source: approval.source,
    tool: approval.tool ?? null,
    arguments: approval.arguments ?? null,
    used: approval.usedAt !== undefined,
    decision:
      approval.decidedAt === undefined
        ? null
        : {
            optionId: approval.optionId!,
            label: chosen?.label ?? approval.optionId!,
            note: approval.note ?? null,
            decidedAt: approval.decidedAt,
            by: approval.decidedBy ?? "app",
          },
  };
}
export type ApprovalView = Awaited<ReturnType<typeof approvalView>>;

// ---- Input checks ----

function checkLine(field: string, value: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) fail("invalid_argument", `${field} must not be empty`);
  if (trimmed.length > max) fail("invalid_argument", `${field} is longer than ${max} characters`);
  return trimmed;
}

/** The options as stored: 2 to 4, trimmed labels, distinct ids; a new option gets the next free `o<n>`. */
export function checkOptions(items: ApprovalOptionInput[]): ApprovalOption[] {
  if (items.length < LIMITS.minOptions || items.length > LIMITS.maxOptions) {
    fail("invalid_argument", `options must list ${LIMITS.minOptions} to ${LIMITS.maxOptions} choices`);
  }
  const given = items.map((item) => item.id?.trim()).filter((id): id is string => id !== undefined);
  if (given.some((id) => !/^[A-Za-z0-9_-]+$/.test(id) || id.length > LIMITS.optionId)) {
    fail("invalid_argument", `option ids are 1 to ${LIMITS.optionId} letters, digits, - or _`);
  }
  if (new Set(given).size !== given.length) fail("invalid_argument", "option ids must be distinct");
  const used = new Set(given);
  let next = 1;
  const freeId = () => {
    while (used.has(`o${next}`)) next++;
    used.add(`o${next}`);
    return `o${next}`;
  };
  return items.map((item) => {
    const label = checkLine("option label", item.label, LIMITS.label);
    const consequence = item.consequence?.trim();
    if (consequence && consequence.length > LIMITS.consequence) fail("invalid_argument", `option consequences are at most ${LIMITS.consequence} characters`);
    const id = item.id?.trim() || freeId();
    return consequence ? { id, label, consequence } : { id, label };
  });
}

function checkMinutes(minutes: number | undefined): number {
  const value = minutes ?? DEFAULT_APPROVAL_MINUTES;
  if (!Number.isInteger(value) || value < 1 || value > LIMITS.minutes) {
    fail("invalid_argument", `expiresInMinutes must be a whole number from 1 to ${LIMITS.minutes}`);
  }
  return value;
}

/** Who asks, as stored on the request. */
function requesterOf(identity: Identity): Doc<"approvals">["requestedBy"] {
  return {
    actor: identity.actor,
    keyId: identity.keyId,
    connectionId: identity.connectionId,
    name: identity.actorName ?? identity.actor,
  };
}

export async function loadApproval(ctx: QueryCtx, userId: string, approvalId: string): Promise<Doc<"approvals">> {
  const id = ctx.db.normalizeId("approvals", approvalId);
  if (!id) fail("invalid_argument", `approvalId is not an approval request id: "${approvalId}"`);
  const approval = await ctx.db.get(id);
  if (!approval || approval.userId !== userId) fail("not_found", `Approval request ${approvalId} not found`);
  return approval;
}

/** History of a request: on its task when it has one (and so in the activity log), else on the account. */
async function record(ctx: MutationCtx, identity: Identity, approval: Doc<"approvals">, action: string, after: Record<string, unknown>) {
  await recordEvent(ctx, identity, { taskId: approval.taskId, action, after: { approvalId: approval._id, ...after } });
}

// ---- Operations ----

/** request_approval: a new request, waiting for the owner. Idempotent by clientId. */
export async function requestApproval(ctx: MutationCtx, identity: Identity, input: Args<"requestApproval">) {
  const clientId = checkClientId(input.clientId);
  if (clientId !== undefined) {
    const existing = await ctx.db
      .query("approvals")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", clientId))
      .first();
    if (existing) return approvalView(ctx, existing);
  }
  const task = input.taskId === undefined ? null : await loadTask(ctx, identity.userId, input.taskId);
  const detail = input.detail?.trim();
  if (detail && detail.length > LIMITS.detail) fail("invalid_argument", `detail is longer than ${LIMITS.detail} characters`);
  const now = Date.now();
  const id = await ctx.db.insert("approvals", {
    userId: identity.userId,
    taskId: task?._id,
    title: checkLine("action", input.action, LIMITS.action),
    detail: detail || undefined,
    options: checkOptions(input.options),
    reversible: input.reversible,
    expiresAt: now + checkMinutes(input.expiresInMinutes) * 60_000,
    requestedBy: requesterOf(identity),
    source: "agent",
    createdAt: now,
    clientId,
  });
  const approval = (await ctx.db.get(id))!;
  await record(ctx, identity, approval, "approvalRequest", { action: approval.title });
  return approvalView(ctx, approval);
}

export async function getApproval(ctx: QueryCtx, identity: Identity, input: Args<"getApproval">) {
  return approvalView(ctx, await loadApproval(ctx, identity.userId, input.approvalId));
}

/** The user's requests, newest first, narrowed by status and task. */
export async function listApprovals(ctx: QueryCtx, identity: Identity, input: Args<"listApprovals">) {
  const limit = input.limit ?? DEFAULT_LIST;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.list) fail("invalid_argument", `limit must be a whole number from 1 to ${LIMITS.list}`);
  const taskId = input.taskId === undefined ? undefined : (await loadTask(ctx, identity.userId, input.taskId))._id;
  const now = Date.now();
  const approvals = [];
  for await (const approval of ctx.db
    .query("approvals")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .order("desc")) {
    if (approvals.length >= limit) break;
    if (taskId !== undefined && approval.taskId !== taskId) continue;
    if (input.status !== undefined && statusOf(approval, now) !== input.status) continue;
    approvals.push(await approvalView(ctx, approval, now));
  }
  return { approvals };
}

/** decide_approval: the owner picks an option of a waiting request. Deciding it again the same way changes nothing. */
export async function decideApproval(ctx: MutationCtx, identity: Identity, input: Args<"decideApproval">) {
  ownerOnly(identity, "decide approval requests");
  const approval = await loadApproval(ctx, identity.userId, input.approvalId);
  const option = approval.options.find((o) => o.id === input.optionId);
  if (!option) fail("invalid_argument", `optionId must be one of ${approval.options.map((o) => o.id).join(", ")}`);
  const now = Date.now();
  const status = statusOf(approval, now);
  if (status === "decided") {
    if (approval.optionId === option.id) return approvalView(ctx, approval, now);
    fail("precondition_failed", `This request was already decided: ${approval.optionId}`);
  }
  if (status === "expired") fail("precondition_failed", "This request expired before it was decided; the agent has to ask again");
  const note = input.note?.trim();
  if (note && note.length > LIMITS.note) fail("invalid_argument", `note is longer than ${LIMITS.note} characters`);
  await ctx.db.patch(approval._id, { decidedAt: now, optionId: option.id, note: note || undefined, decidedBy: identity.actor });
  const decided = (await ctx.db.get(approval._id))!;
  await record(ctx, identity, decided, "approvalDecide", { optionId: option.id, label: option.label });
  const view = await approvalView(ctx, decided, now);
  await queueApprovalDecided(ctx, identity.userId, decided._id, view, { type: identity.actor, name: identity.actorName ?? null }, now);
  return view;
}

// ---- Requests made by a tool policy "ask" (lib/agentControls.ts) ----

const NOT_HASHED = new Set(["userId", "actor", "keyId", "connectionId", "actorName", "clientId", "dryRun", "approvalId", "ifMatch", "tool", "at"]);

/** The call's arguments as they are compared: without identity, retry and preview fields, keys sorted. */
export function callArguments(input: Record<string, unknown>): Record<string, unknown> {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]));
  };
  const kept = Object.fromEntries(Object.entries(input).filter(([key, value]) => !NOT_HASHED.has(key) && value !== undefined));
  return sorted(kept) as Record<string, unknown>;
}

/** What one approval allows: this key (or connection), this tool, these arguments. */
export async function policyHash(identity: Identity, tool: string, input: Record<string, unknown>): Promise<string> {
  const holder = identity.keyId ?? identity.connectionId ?? identity.actor;
  return sha256Hex(JSON.stringify([holder, tool, callArguments(input)]));
}

const ALLOW = "allow";

/**
 * The request a refused call points to: a waiting one for the same call is
 * reused, so an agent that repeats the call does not flood the phone.
 */
export async function requestForPolicy(ctx: MutationCtx, identity: Identity, tool: string, input: Record<string, unknown>, reversible: boolean) {
  const argsHash = await policyHash(identity, tool, input);
  const now = Date.now();
  const same = await ctx.db
    .query("approvals")
    .withIndex("by_user_hash", (q) => q.eq("userId", identity.userId).eq("argsHash", argsHash))
    .collect();
  const waiting = same.find((a) => statusOf(a, now) === "pending" || (a.optionId === ALLOW && a.usedAt === undefined));
  if (waiting) return approvalView(ctx, waiting, now);
  const shown = JSON.stringify(callArguments(input));
  const taskRef = typeof input.taskId === "string" ? input.taskId : null;
  let task: Doc<"tasks"> | null = null;
  if (taskRef !== null) {
    try {
      task = await loadTask(ctx, identity.userId, taskRef);
    } catch {
      task = null;
    }
  }
  const name = identity.actorName ?? identity.actor;
  const id = await ctx.db.insert("approvals", {
    userId: identity.userId,
    taskId: task?._id,
    title: `${name} wants to call ${tool}`.slice(0, LIMITS.action),
    detail: `Your policy asks before this key calls ${tool}. Arguments: ${shown}`.slice(0, LIMITS.detail),
    options: [
      { id: ALLOW, label: "Allow once", consequence: `The agent repeats the call and ${tool} runs once, with exactly these arguments.` },
      { id: "deny", label: "Deny", consequence: "The call stays refused; the agent is told you said no." },
    ],
    reversible,
    expiresAt: now + POLICY_APPROVAL_MINUTES * 60_000,
    requestedBy: requesterOf(identity),
    source: "policy",
    tool,
    argsHash,
    arguments: shown.slice(0, LIMITS.arguments),
    createdAt: now,
  });
  const approval = (await ctx.db.get(id))!;
  await record(ctx, identity, approval, "approvalRequest", { action: approval.title, tool });
  return approvalView(ctx, approval, now);
}

/**
 * Lets a call through on its policy approval, or refuses it. The approval is
 * used in the same transaction as the change, so one "allow" is one change.
 */
export async function usePolicyApproval(ctx: MutationCtx, identity: Identity, tool: string, input: Record<string, unknown>, approvalId: string) {
  const approval = await loadApproval(ctx, identity.userId, approvalId);
  const argsHash = await policyHash(identity, tool, input);
  if (approval.source !== "policy" || approval.argsHash !== argsHash) {
    fail("approval_required", `Approval request ${approvalId} is for another call; repeat exactly the call it was made for`);
  }
  const status = statusOf(approval, Date.now());
  if (status === "pending") fail("approval_required", "The owner has not decided yet; check with get_approval and try again later", { approvalId: approval._id });
  if (status === "expired") fail("approval_required", "The approval request expired; call again for a new one");
  if (approval.optionId !== ALLOW) fail("forbidden", `The owner denied this call${approval.note ? `: ${approval.note}` : ""}`);
  if (approval.usedAt !== undefined) fail("approval_required", "This approval was already used; call again for a new one");
  await ctx.db.patch(approval._id, { usedAt: Date.now() });
}
