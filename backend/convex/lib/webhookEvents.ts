// Webhook events (docs/webhooks.md#events): every history entry about a task
// becomes an event for the user's webhooks that subscribe to its type. The
// event is queued in the same transaction as the change, so a change that is
// rolled back (a dry run, an error) sends nothing. Delivery is webhooks.ts.
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Actor } from "./validators";

export const WEBHOOK_EVENTS = ["task.created", "task.updated", "task.completed", "task.deleted", "task.restored", "now.changed"] as const;
export const webhookEventValidator = v.union(
  v.literal("task.created"),
  v.literal("task.updated"),
  v.literal("task.completed"),
  v.literal("task.deleted"),
  v.literal("task.restored"),
  v.literal("now.changed"),
);
export type WebhookEvent = Infer<typeof webhookEventValidator>;

/** Arguments of adding a webhook and of reading its delivery log (webhooks.ts, REST). */
export const webhookArgs = {
  create: { url: v.string(), events: v.optional(v.array(webhookEventValidator)), description: v.optional(v.string()) },
  deliveries: { limit: v.optional(v.number()) },
};

/** The event type of each history action about a task. */
const TYPE_OF_ACTION: Record<string, WebhookEvent> = {
  create: "task.created",
  repeat: "task.created",
  import: "task.created",
  update: "task.updated",
  setStatus: "task.updated",
  setNow: "task.updated",
  archive: "task.updated",
  complete: "task.completed",
  delete: "task.deleted",
  restore: "task.restored",
};

/** The id every delivery of one event carries in webhook-id, the same on every retry. */
export const messageId = (eventId: string) => `msg_${eventId}`;

export type TaskChange = {
  userId: string;
  /** The history entry the event comes from; its id makes the webhook-id. */
  eventId: Id<"taskEvents">;
  taskId: Id<"tasks">;
  action: string;
  at: number;
  actor: Actor;
  actorName?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

/** Queues the events of one history entry for every live webhook of the user that wants them. */
export async function queueTaskEvents(ctx: MutationCtx, change: TaskChange, view: (task: Doc<"tasks">) => unknown) {
  const type = TYPE_OF_ACTION[change.action];
  if (!type) return;
  const types: WebhookEvent[] = [type];
  // Only a change of the flag: a new task's snapshot has isNow too, but no previous value.
  if (change.before && "isNow" in change.before) types.push("now.changed");
  const webhooks = (
    await ctx.db
      .query("webhooks")
      .withIndex("by_user", (q) => q.eq("userId", change.userId))
      .collect()
  ).filter((w) => w.disabledAt === undefined && types.some((t) => w.events.includes(t)));
  if (webhooks.length === 0) return;
  const task = await ctx.db.get(change.taskId);
  if (!task) return;
  const actor = { type: change.actor, name: change.actorName ?? null };
  for (const eventType of types) {
    const id = types.length > 1 && eventType === "now.changed" ? `${change.eventId}n` : change.eventId;
    const data = eventType === "now.changed" ? { task: view(task), isNow: task.isNow } : { task: view(task) };
    const payload = JSON.stringify({
      type: eventType,
      timestamp: new Date(change.at).toISOString(),
      data,
      previous: change.before ?? {},
      actor,
    });
    for (const webhook of webhooks.filter((w) => w.events.includes(eventType))) {
      await queueDelivery(ctx, webhook, messageId(id), eventType, payload);
    }
  }
}

/** One delivery of one message to one webhook, sent at once by the scheduler. */
export async function queueDelivery(ctx: MutationCtx, webhook: Doc<"webhooks">, eventId: string, type: string, payload: string) {
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    userId: webhook.userId,
    webhookId: webhook._id,
    eventId,
    type,
    payload,
    status: "pending",
    attempts: [],
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  return deliveryId;
}
