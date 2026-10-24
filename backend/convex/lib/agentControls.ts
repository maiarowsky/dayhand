// The owner's controls over agents (docs/agent-work.md#6-pausing-agents-and-tool-policies):
// one switch that pauses every agent, and per agent key a rule for each write
// tool: allow, ask (an approval request first, lib/approvals.ts) or deny. Reads
// are never refused. Every change an agent makes passes gateAgentWrite, in the
// same transaction as the change (ops.ts).
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { usePolicyApproval } from "./approvals";
import { fail, ownerOnly, recordEvent, type Identity } from "./core";
import type { PolicyRule } from "./validators";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

const MAX_REASON = 500;
/** The rule of every write tool of a key that has no rule of its own. */
export const ANY_TOOL = "*";

async function controlsRow(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("agentControls")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The rule for one key and one write tool: its own row, else the key's "*" row, else allow. */
export async function ruleOf(ctx: QueryCtx, keyId: Id<"apiKeys">, tool: string): Promise<PolicyRule> {
  for (const name of [tool, ANY_TOOL]) {
    const row = await ctx.db
      .query("toolPolicies")
      .withIndex("by_key_tool", (q) => q.eq("keyId", keyId).eq("tool", name))
      .unique();
    if (row) return row.rule;
  }
  return "allow";
}

/**
 * Refuses a change by an agent while agents are paused, or when the owner's
 * policy denies the tool to its key; with "ask" the call needs an approval
 * request decided "allow" (approvalId), used up by this change. A dry run
 * changes nothing and needs no approval. The owner (app, cli) is never refused.
 */
export async function gateAgentWrite(
  ctx: MutationCtx,
  identity: Identity,
  call: { tool?: string; approvalId?: string; dryRun?: boolean; input: Record<string, unknown> },
) {
  if (identity.actor !== "agent") return;
  const controls = await controlsRow(ctx, identity.userId);
  if (controls?.pausedAt !== undefined) {
    const reason = controls.reason ? ` (${controls.reason})` : "";
    fail("agents_paused", `The owner has paused all agents${reason}: reading works, changes are refused until they resume agents`);
  }
  if (!call.tool || !identity.keyId) return;
  const rule = await ruleOf(ctx, identity.keyId, call.tool);
  if (rule === "deny") fail("forbidden", `The owner's policy does not let this key call ${call.tool}`);
  if (rule === "allow" || call.dryRun) return;
  if (call.approvalId === undefined) {
    fail("approval_required", `The owner's policy asks before this key calls ${call.tool}`);
  }
  await usePolicyApproval(ctx, identity, call.tool, call.input, call.approvalId);
}

/** Whether agents are paused: for the account routes of the REST API, which run no domain change. */
export async function agentsPaused(ctx: QueryCtx, userId: string): Promise<boolean> {
  return (await controlsRow(ctx, userId))?.pausedAt !== undefined;
}

// ---- Views and the owner's changes ----

async function policyViews(ctx: QueryCtx, userId: string) {
  const rows = await ctx.db
    .query("toolPolicies")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const keys = new Map<string, Doc<"apiKeys"> | null>();
  for (const row of rows) if (!keys.has(row.keyId)) keys.set(row.keyId, await ctx.db.get(row.keyId));
  return rows
    .filter((row) => keys.get(row.keyId)?.revokedAt === undefined && keys.get(row.keyId) !== null)
    .map((row) => ({ keyId: row.keyId, keyName: keys.get(row.keyId)!.name, tool: row.tool, rule: row.rule, updatedAt: row.updatedAt }))
    .sort((a, b) => a.keyName.localeCompare(b.keyName) || a.tool.localeCompare(b.tool));
}

/** get_agent_controls: whether agents are paused, and every rule the owner set. */
export async function getAgentControls(ctx: QueryCtx, identity: Identity) {
  const row = await controlsRow(ctx, identity.userId);
  const paused = row?.pausedAt !== undefined;
  return {
    paused,
    pausedAt: row?.pausedAt ?? null,
    pausedBy: paused ? (row?.pausedBy ?? null) : null,
    reason: paused ? (row?.reason ?? null) : null,
    policies: await policyViews(ctx, identity.userId),
  };
}

/** pause_agents: the owner pauses every agent, or lets them run again. */
export async function setAgentsPaused(ctx: MutationCtx, identity: Identity, input: Args<"pauseAgents">) {
  ownerOnly(identity, "pause or resume agents");
  const reason = input.reason?.trim();
  if (reason && reason.length > MAX_REASON) fail("invalid_argument", `reason is longer than ${MAX_REASON} characters`);
  const row = await controlsRow(ctx, identity.userId);
  const now = Date.now();
  const wasPaused = row?.pausedAt !== undefined;
  const fields = input.paused
    ? { pausedAt: wasPaused ? row!.pausedAt : now, pausedBy: identity.actor, reason: reason || undefined, updatedAt: now }
    : { pausedAt: undefined, pausedBy: undefined, reason: undefined, updatedAt: now };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert("agentControls", { userId: identity.userId, ...fields });
  if (wasPaused !== input.paused) {
    await recordEvent(ctx, identity, { action: input.paused ? "agents.pause" : "agents.resume", after: input.paused ? { reason: reason ?? null } : {} });
  }
  return getAgentControls(ctx, identity);
}

/** set_tool_policy: the owner's rule for one agent key and one write tool (or "*"); allow removes the rule. */
export async function setToolPolicy(ctx: MutationCtx, identity: Identity, input: Args<"setToolPolicy">, writeTools: readonly string[]) {
  ownerOnly(identity, "change tool policies");
  const keyId = ctx.db.normalizeId("apiKeys", input.apiKeyId);
  const key = keyId ? await ctx.db.get(keyId) : null;
  if (!keyId || !key || key.userId !== identity.userId || key.revokedAt !== undefined) fail("not_found", `API key ${input.apiKeyId} not found`);
  if ((key.kind ?? "agent") !== "agent") fail("invalid_argument", "Policies are for agent keys; a cli key is the owner at a terminal");
  const tool = input.toolName;
  if (tool !== ANY_TOOL && !writeTools.includes(tool)) {
    fail("invalid_argument", `toolName must be "*" or a tool that changes the plan: ${writeTools.join(", ")}`);
  }
  const existing = await ctx.db
    .query("toolPolicies")
    .withIndex("by_key_tool", (q) => q.eq("keyId", keyId).eq("tool", tool))
    .unique();
  const before = existing?.rule ?? null;
  // "allow" on a single tool is kept when the key's "*" rule says otherwise; otherwise allow is the default.
  const keepAllow = input.rule === "allow" && tool !== ANY_TOOL && (await ruleOf(ctx, keyId, ANY_TOOL)) !== "allow";
  if (input.rule === "allow" && !keepAllow) {
    if (existing) await ctx.db.delete(existing._id);
  } else if (existing) await ctx.db.patch(existing._id, { rule: input.rule, updatedAt: Date.now() });
  else await ctx.db.insert("toolPolicies", { userId: identity.userId, keyId, tool, rule: input.rule, updatedAt: Date.now() });
  if (before !== input.rule) {
    await recordEvent(ctx, identity, { action: "policy.set", before: { rule: before }, after: { keyId, keyName: key.name, tool, rule: input.rule } });
  }
  return getAgentControls(ctx, identity);
}
