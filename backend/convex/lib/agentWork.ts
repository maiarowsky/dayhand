// Agent work on a task (docs/agent-work.md): acceptance criteria and a plan,
// proof of completion, dependencies and a blocked reason, and a time-boxed
// claim. No new statuses: everything here is fields next to todo/doing/done.
import type { ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { checkLinks, checkText, fail, loadTask, patchTask, replay, toTask, type Identity } from "./core";
import type { AcceptanceInput, AcceptanceItem, ClaimHolder, Proof } from "./validators";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

const LIMITS = {
  acceptance: 50,
  acceptanceId: 64,
  acceptanceText: 500,
  plan: 20_000,
  blockedReason: 2_000,
  dependsOn: 50,
  summary: 4_000,
  checks: 50,
  checkName: 200,
  url: 2_048,
  claimMinutes: 24 * 60,
};

export const DEFAULT_CLAIM_MINUTES = 120;

// ---- Acceptance criteria, plan, blocked reason ----

/**
 * The criteria as stored: trimmed texts in the given order, `met` false unless
 * set, and an id for every one. New criteria get the next free `a<n>`. An
 * empty list is no criteria.
 */
export function checkAcceptance(items: AcceptanceInput[]): AcceptanceItem[] | undefined {
  if (items.length > LIMITS.acceptance) fail("invalid_argument", `at most ${LIMITS.acceptance} acceptance criteria`);
  const given = items.map((item) => item.id).filter((id): id is string => id !== undefined);
  if (given.some((id) => id.trim() === "" || id.length > LIMITS.acceptanceId)) {
    fail("invalid_argument", `acceptance criterion ids must be 1 to ${LIMITS.acceptanceId} characters`);
  }
  if (new Set(given).size !== given.length) fail("invalid_argument", "acceptance criterion ids must be distinct");
  const used = new Set(given);
  let next = 1;
  const freeId = () => {
    while (used.has(`a${next}`)) next++;
    used.add(`a${next}`);
    return `a${next}`;
  };
  const result = items.map((item) => {
    const text = item.text.trim();
    if (!text) fail("invalid_argument", "acceptance criteria need a text");
    if (text.length > LIMITS.acceptanceText) fail("invalid_argument", `acceptance criteria are at most ${LIMITS.acceptanceText} characters`);
    return { id: item.id ?? freeId(), text, met: item.met ?? false };
  });
  return result.length > 0 ? result : undefined;
}

export function checkLongText(field: "plan" | "blockedReason", value: string): string | undefined {
  if (value.length > LIMITS[field]) fail("invalid_argument", `${field} is longer than ${LIMITS[field]} characters`);
  return value.trim() === "" ? undefined : value;
}

// ---- Proof of completion ----

function checkUrl(field: string, url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("invalid_argument", `${field}: invalid URL "${url}"`);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || url.length > LIMITS.url) {
    fail("invalid_argument", `${field}: URLs must be http(s), up to ${LIMITS.url} characters`);
  }
  return url;
}

/** The proof as stored: a trimmed summary, checked links and checks; empty parts left out. */
export function checkProof(proof: Proof): Proof {
  const summary = proof.summary?.trim();
  if (summary && summary.length > LIMITS.summary) fail("invalid_argument", `proof.summary is longer than ${LIMITS.summary} characters`);
  const checks = proof.checks ?? [];
  if (checks.length > LIMITS.checks) fail("invalid_argument", `at most ${LIMITS.checks} proof checks`);
  const cleanChecks = checks.map((check) => {
    const name = check.name.trim();
    if (!name || name.length > LIMITS.checkName) fail("invalid_argument", `proof checks need a name of 1 to ${LIMITS.checkName} characters`);
    return check.url === undefined ? { name, result: check.result } : { name, result: check.result, url: checkUrl("proof.checks", check.url) };
  });
  return {
    ...(summary ? { summary } : {}),
    links: checkLinks(proof.links ?? []),
    checks: cleanChecks,
  };
}

/**
 * An agent may complete a task with acceptance criteria only when every
 * criterion is met and the proof has a summary. People (app, cli) complete
 * tasks as before.
 */
export function checkCompletion(task: Doc<"tasks">, identity: Identity, proof: Proof | undefined) {
  const criteria = task.acceptance ?? [];
  if (identity.actor !== "agent" || criteria.length === 0) return;
  const unmet = criteria.filter((item) => !item.met);
  if (unmet.length > 0) {
    fail("precondition_failed", `Acceptance criteria not met: ${unmet.map((item) => item.id).join(", ")}; mark them met with update_task first`);
  }
  if (!proof?.summary) fail("precondition_failed", "A task with acceptance criteria needs proof with a summary to be completed by an agent");
}

// ---- Dependencies ----

/**
 * The dependencies as stored: the tasks' ids, each once. A task cannot depend
 * on itself or on a task that (through its own dependencies) depends on it.
 */
export async function checkDependsOn(ctx: QueryCtx, userId: string, taskId: Id<"tasks"> | null, refs: string[]): Promise<Id<"tasks">[] | undefined> {
  if (refs.length > LIMITS.dependsOn) fail("invalid_argument", `at most ${LIMITS.dependsOn} dependencies`);
  const ids: Id<"tasks">[] = [];
  for (const ref of refs) {
    const dependency = await loadTask(ctx, userId, ref);
    if (dependency._id === taskId) fail("invalid_argument", "A task cannot depend on itself");
    if (!ids.includes(dependency._id)) ids.push(dependency._id);
  }
  if (taskId !== null) await refuseCycle(ctx, taskId, ids);
  return ids.length > 0 ? ids : undefined;
}

async function refuseCycle(ctx: QueryCtx, taskId: Id<"tasks">, start: Id<"tasks">[]) {
  const seen = new Set<string>();
  const pending = [...start];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === taskId) fail("invalid_argument", "These dependencies would make a cycle: a task would wait for itself");
    if (seen.has(id)) continue;
    seen.add(id);
    const task = await ctx.db.get(id);
    pending.push(...(task?.dependsOn ?? []));
  }
}

/**
 * Ready to work on: not done, not blocked, not a proposal, and every dependency
 * done. A dependency in the trash or purged no longer holds the task back.
 */
export function isReady(task: Doc<"tasks">, byId: Map<string, Doc<"tasks">>): boolean {
  if (task.status === "done" || task.blockedReason !== undefined || task.proposedAt !== undefined) return false;
  return (task.dependsOn ?? []).every((id) => {
    const dependency = byId.get(id);
    return dependency === undefined || dependency.deletedAt !== undefined || dependency.status === "done";
  });
}

// ---- Claims ----

/** The caller as a claim holder; only an API key or an agent connection can hold a claim. */
function holderOf(identity: Identity): ClaimHolder {
  if (identity.keyId) return { keyId: identity.keyId, name: identity.actorName ?? "API key" };
  if (identity.connectionId) return { connectionId: identity.connectionId, name: identity.actorName ?? "connection" };
  return fail("invalid_argument", "Only an API key or an agent connection can claim a task");
}

/** Whether the caller (its API key or agent connection) is the holder. */
export const sameHolder = (a: ClaimHolder | undefined, identity: Pick<Identity, "keyId" | "connectionId">) =>
  a !== undefined && ((a.keyId !== undefined && a.keyId === identity.keyId) || (a.connectionId !== undefined && a.connectionId === identity.connectionId));

/** The live claim of someone other than the caller, if any. */
function othersClaim(task: Doc<"tasks">, identity: Identity, now: number): ClaimHolder | null {
  const live = task.claimedBy !== undefined && (task.claimExpiresAt ?? 0) > now;
  return live && !sameHolder(task.claimedBy, identity) ? task.claimedBy! : null;
}

const until = (at: number) => new Date(at).toISOString();

function conflict(task: Doc<"tasks">, holder: ClaimHolder): never {
  fail("conflict", `Task #${task.ref ?? task._id} is claimed by ${holder.name} until ${until(task.claimExpiresAt!)}`);
}

/**
 * Refuses a change of a task that another agent has claimed. The owner wins:
 * changes from the app and the CLI (the user) always go through.
 */
export function checkClaim(task: Doc<"tasks">, identity: Identity) {
  if (identity.actor !== "agent") return;
  const holder = othersClaim(task, identity, Date.now());
  if (holder) conflict(task, holder);
}

function claimMinutes(minutes: number | undefined): number {
  const value = minutes ?? DEFAULT_CLAIM_MINUTES;
  if (!Number.isInteger(value) || value < 1 || value > LIMITS.claimMinutes) {
    fail("invalid_argument", `minutes must be a whole number from 1 to ${LIMITS.claimMinutes}`);
  }
  return value;
}

function claimable(task: Doc<"tasks">) {
  if (task.deletedAt !== undefined) fail("invalid_argument", "Task is in the trash; restore it first");
  if (task.archivedAt !== undefined) fail("invalid_argument", "Task is archived; restore it first");
  if (task.status === "done") fail("invalid_argument", "Task is done; reopen it first");
  if (task.proposedAt !== undefined) fail("invalid_argument", "Task is a proposal; it can be claimed once the owner accepts it");
  return task;
}

/** Claims a task for `minutes` (default 120); claiming it again extends the caller's own claim. */
export async function claimTask(ctx: MutationCtx, identity: Identity, input: Args<"claim">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = claimable(await loadTask(ctx, identity.userId, input.taskId));
  const holder = holderOf(identity);
  const minutes = claimMinutes(input.minutes);
  const other = othersClaim(task, identity, Date.now());
  if (other) conflict(task, other);
  const patch = { claimedBy: holder, claimExpiresAt: Date.now() + minutes * 60_000 };
  return toTask(await patchTask(ctx, identity, task, "claim", patch, input.clientId));
}

/**
 * Extends the caller's claim by `minutes` from now. It works after the claim
 * expired too, as long as nobody else has claimed the task since.
 */
export async function renewClaim(ctx: MutationCtx, identity: Identity, input: Args<"renewClaim">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = claimable(await loadTask(ctx, identity.userId, input.taskId));
  const minutes = claimMinutes(input.minutes);
  if (!sameHolder(task.claimedBy, identity)) {
    const other = othersClaim(task, identity, Date.now());
    if (other) conflict(task, other);
    fail("precondition_failed", "You do not hold a claim on this task; claim it with claim_task");
  }
  return toTask(await patchTask(ctx, identity, task, "renewClaim", { claimExpiresAt: Date.now() + minutes * 60_000 }, input.clientId));
}

/**
 * Gives a claim up, optionally leaving a checkpoint as the resume note (where
 * the work stopped, the next step). The holder releases its own claim; the
 * owner (app, cli) may release anyone's, which is how a person takes over.
 */
export async function releaseTask(ctx: MutationCtx, identity: Identity, input: Args<"release">) {
  const replayed = await replay(ctx, identity.userId, input.clientId, input.taskId);
  if (replayed) return toTask(replayed);
  const task = await loadTask(ctx, identity.userId, input.taskId);
  checkClaim(task, identity);
  const patch: Partial<Doc<"tasks">> = { claimedBy: undefined, claimExpiresAt: undefined };
  const checkpoint = input.note === undefined ? undefined : checkText("resumeNote", input.note);
  if (checkpoint !== undefined) patch.resumeNote = checkpoint;
  return toTask(await patchTask(ctx, identity, task, "release", patch, input.clientId));
}
