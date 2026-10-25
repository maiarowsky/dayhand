// App-only proof for an occurrence already calculated on a disconnected phone.
// The phone clears the parent's rule, completes it, then adds its local successor.
// Confirm both history entries and the rule/date before allowing an archived project.
import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { checkClientId, fail, loadTask, type Identity } from "./core";
import { isValidDate } from "./dates";
import { projectTarget } from "./projectOps";
import { advance, validateRepeat } from "./repeat";
import type { RepeatRule } from "./validators";

export const offlineRepeatValidator = v.object({
  taskId: v.id("tasks"),
  completedBy: v.string(),
  completedOn: v.string(),
});
export type OfflineRepeat = Infer<typeof offlineRepeatValidator>;

// Only the history immediately preceding this completion is needed, not the whole life of a task.
const HISTORY_LIMIT = 64;

export async function confirmOfflineRepeat(
  ctx: MutationCtx,
  identity: Identity,
  proof: OfflineRepeat,
  next: { clientId?: string; projectId?: string; dueDate?: string; repeat?: RepeatRule; proposal?: boolean; status?: string },
): Promise<Id<"projects">> {
  if (identity.actor !== "app") fail("forbidden", "Only the app can restore a local occurrence");
  if (!next.clientId || next.proposal || next.status === "doing" || !isValidDate(proof.completedOn)) {
    fail("invalid_argument", "A local occurrence needs a clientId, completion day and repeat rule");
  }
  const parent = await loadTask(ctx, identity.userId, proof.taskId);
  if (parent.status !== "done" || parent.repeat !== undefined || parent.deletedAt !== undefined || parent.projectId === undefined) {
    fail("invalid_argument", "The local occurrence's parent must be a completed repeating task in that project");
  }
  const events = await ctx.db.query("taskEvents")
    .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", checkClientId(proof.completedBy)))
    .collect();
  const completion = events.find((e) => e.taskId === parent._id && e.action === "complete" && e.actor === "app");
  if (!completion?.seq || completion.after?.completedAt !== parent.completedAt || events.some((e) => e.action === "repeat")) {
    fail("invalid_argument", "The parent completion is not confirmed or already has its next occurrence");
  }
  const history = await ctx.db.query("taskEvents").withIndex("by_task", (q) => q.eq("taskId", parent._id).lte("at", completion.at))
    .order("desc").take(HISTORY_LIMIT);
  const cleared = history.find((e) => e.seq !== undefined && e.seq < completion.seq! && e.after && "repeat" in e.after);
  const original: RepeatRule | undefined = cleared?.before?.repeat;
  if (cleared?.action !== "update" || cleared.actor !== "app" || cleared.after?.repeat !== null ||
      !original || validateRepeat(original) !== null) {
    fail("invalid_argument", "The parent has no confirmed local repeat completion");
  }
  const occurrence = advance(original, parent.dueDate, proof.completedOn);
  if (!occurrence || occurrence.dueDate !== next.dueDate || !next.repeat || !sameRule(occurrence.repeat, next.repeat)) {
    fail("invalid_argument", "The task is not the next local occurrence of its parent");
  }
  const target = next.projectId === undefined ? undefined : await projectTarget(ctx, identity.userId, next.projectId, parent.projectId);
  if (target !== parent.projectId) fail("invalid_argument", "A local occurrence must keep its parent's project");
  return parent.projectId;
}

/** Semantic equality, independent of object key order and the default repeat.from spelling. */
function sameRule(a: RepeatRule, b: RepeatRule): boolean {
  const key = (r: RepeatRule) => [r.every, r.interval, r.weekdays?.slice().sort((x, y) => x - y), r.from ?? "due",
    r.monthDay, r.weekdayOfMonth?.nth, r.weekdayOfMonth?.weekday, r.until, r.count];
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}
