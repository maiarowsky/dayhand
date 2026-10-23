// Webhooks (docs/webhooks.md): adding, listing, removing, testing and turning
// a webhook back on, and delivering its messages. A message is POSTed with the
// Standard Webhooks headers (webhook-id, webhook-timestamp, webhook-signature);
// a delivery that does not get a 2xx is tried again after the delays of
// RETRY_DELAYS_S, with the same webhook-id and body. A webhook whose deliveries
// fail on every attempt DISABLE_AFTER times in a row is turned off, with the
// reason in its listing and in the history.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, identityOf, recordEvent } from "./lib/core";
import { SERVER_INFO } from "./lib/mcpProtocol";
import { identityFields as identityArgs } from "./lib/validators";
import { queueDelivery, WEBHOOK_EVENTS, webhookArgs, type WebhookEvent } from "./lib/webhookEvents";
import { newWebhookSecret, signWebhook } from "./lib/webhookSign";
import { targetProblem } from "./lib/webhookTarget";

export const MAX_WEBHOOKS = 10;
export const DISABLE_AFTER = 5;
const MAX_DESCRIPTION = 200;
const TIMEOUT_MS = 10_000;
const MAX_ERROR = 200;
/** How long the delivery log is kept. */
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 500;
const DEFAULT_LIST = 50;

/**
 * Delays before the second, third, … attempt, in seconds: the schedule Standard Webhooks
 * suggests (5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h: eight attempts in about 27 hours).
 * HELM_WEBHOOK_RETRY_DELAYS (comma-separated seconds) replaces it, e.g. in tests.
 */
export const RETRY_DELAYS_S = [5, 300, 1800, 7200, 18000, 36000, 36000];

function retryDelaysMs(): number[] {
  const configured = process.env.HELM_WEBHOOK_RETRY_DELAYS;
  const seconds = configured ? configured.split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0) : RETRY_DELAYS_S;
  return seconds.map((s) => Math.round(s * 1000));
}

// ---- Views ----

export type WebhookView = {
  id: Id<"webhooks">;
  url: string;
  events: WebhookEvent[];
  description: string | null;
  createdAt: number;
  enabled: boolean;
  disabledAt: number | null;
  disabledReason: string | null;
  failureStreak: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
};

const view = (w: Doc<"webhooks">): WebhookView => ({
  id: w._id,
  url: w.url,
  events: w.events,
  description: w.description ?? null,
  createdAt: w.createdAt,
  enabled: w.disabledAt === undefined,
  disabledAt: w.disabledAt ?? null,
  disabledReason: w.disabledReason ?? null,
  failureStreak: w.failureStreak,
  lastSuccessAt: w.lastSuccessAt ?? null,
  lastFailureAt: w.lastFailureAt ?? null,
});

const deliveryView = (d: Doc<"webhookDeliveries">) => ({
  id: d._id,
  eventId: d.eventId,
  type: d.type,
  status: d.status,
  createdAt: d.createdAt,
  nextAttemptAt: d.nextAttemptAt ?? null,
  finishedAt: d.finishedAt ?? null,
  attempts: d.attempts.map((a) => ({ at: a.at, durationMs: a.durationMs, responseStatus: a.responseStatus ?? null, error: a.error ?? null })),
  payload: JSON.parse(d.payload) as unknown,
});

async function ownWebhook(ctx: QueryCtx, userId: string, webhookId: Id<"webhooks">) {
  const webhook = await ctx.db.get(webhookId);
  if (!webhook || webhook.userId !== userId) fail("not_found", `Webhook ${webhookId} not found`);
  return webhook;
}

async function userWebhooks(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("webhooks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

// ---- Managing webhooks ----

const createArgs = webhookArgs.create;

export type CreatedWebhook = { webhook: WebhookView; secret: string };

/** Adds a webhook; the secret is returned only here. Every event when `events` is left out. */
export const create = internalAction({
  args: { ...identityArgs, ...createArgs },
  handler: async (ctx, input): Promise<CreatedWebhook> => {
    const secret = newWebhookSecret();
    const webhook: WebhookView = await ctx.runMutation(internal.webhooks.insert, { ...input, secret });
    return { webhook, secret };
  },
});

export const insert = internalMutation({
  args: { ...identityArgs, ...createArgs, secret: v.string() },
  handler: async (ctx, input): Promise<WebhookView> => {
    const problem = targetProblem(input.url);
    if (problem) fail("invalid_argument", problem);
    const events = [...new Set(input.events ?? WEBHOOK_EVENTS)];
    if (events.length === 0) fail("invalid_argument", `events must list at least one of ${WEBHOOK_EVENTS.join(", ")}`);
    const description = input.description?.trim() || undefined;
    if (description && description.length > MAX_DESCRIPTION) fail("invalid_argument", `description is longer than ${MAX_DESCRIPTION} characters`);
    if ((await userWebhooks(ctx, input.userId)).length >= MAX_WEBHOOKS) fail("invalid_argument", `At most ${MAX_WEBHOOKS} webhooks; remove one first`);
    const id = await ctx.db.insert("webhooks", {
      userId: input.userId,
      url: input.url,
      events,
      description,
      secret: input.secret,
      createdAt: Date.now(),
      failureStreak: 0,
    });
    await recordEvent(ctx, identityOf(input), { action: "webhook.create", after: { webhookId: id, url: input.url, events } });
    return view((await ctx.db.get(id))!);
  },
});

export const list = internalQuery({
  args: identityArgs,
  handler: async (ctx, { userId }) => (await userWebhooks(ctx, userId)).map(view),
});

export const get = internalQuery({
  args: { ...identityArgs, webhookId: v.id("webhooks") },
  handler: async (ctx, { userId, webhookId }) => view(await ownWebhook(ctx, userId, webhookId)),
});

/** Removes a webhook and its delivery log; deliveries still waiting are dropped. */
export const remove = internalMutation({
  args: { ...identityArgs, webhookId: v.id("webhooks") },
  handler: async (ctx, input) => {
    const webhook = await ownWebhook(ctx, input.userId, input.webhookId);
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhook", (q) => q.eq("webhookId", webhook._id))
      .collect();
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);
    await ctx.db.delete(webhook._id);
    await recordEvent(ctx, identityOf(input), { action: "webhook.delete", after: { webhookId: webhook._id, url: webhook.url } });
    return { id: webhook._id, deleted: true };
  },
});

/** Turns a webhook back on after it was turned off for failing. */
export const enable = internalMutation({
  args: { ...identityArgs, webhookId: v.id("webhooks") },
  handler: async (ctx, input) => {
    const webhook = await ownWebhook(ctx, input.userId, input.webhookId);
    if (webhook.disabledAt === undefined) return view(webhook);
    await ctx.db.patch(webhook._id, { disabledAt: undefined, disabledReason: undefined, failureStreak: 0 });
    await recordEvent(ctx, identityOf(input), { action: "webhook.enable", after: { webhookId: webhook._id } });
    return view((await ctx.db.get(webhook._id))!);
  },
});

/** Sends a webhook.test message to this webhook only (also to a turned-off one, to check a fix). */
export const test = internalMutation({
  args: { ...identityArgs, webhookId: v.id("webhooks") },
  handler: async (ctx, input) => {
    const webhook = await ownWebhook(ctx, input.userId, input.webhookId);
    const at = Date.now();
    const payload = JSON.stringify({ type: "webhook.test", timestamp: new Date(at).toISOString(), data: { webhookId: webhook._id } });
    const deliveryId = await queueDelivery(ctx, webhook, `msg_test_${webhook._id}_${at}`, "webhook.test", payload);
    const delivery = (await ctx.db.get(deliveryId))!;
    return { deliveryId, eventId: delivery.eventId };
  },
});

/** The newest deliveries of a webhook (default 50, at most 200), with every attempt. */
export const deliveries = internalQuery({
  args: { ...identityArgs, webhookId: v.id("webhooks"), ...webhookArgs.deliveries },
  handler: async (ctx, { userId, webhookId, limit }) => {
    await ownWebhook(ctx, userId, webhookId);
    const count = limit ?? DEFAULT_LIST;
    if (!Number.isInteger(count) || count < 1 || count > 200) fail("invalid_argument", "limit must be a whole number from 1 to 200");
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhook", (q) => q.eq("webhookId", webhookId))
      .order("desc")
      .take(count);
    return rows.map(deliveryView);
  },
});

// ---- Delivering ----

type Job = { url: string; secret: string; eventId: string; payload: string; test: boolean; disabled: boolean };

export const job = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }): Promise<Job | null> => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return null;
    const webhook = await ctx.db.get(delivery.webhookId);
    if (!webhook) return null;
    const test = delivery.type === "webhook.test";
    return { url: webhook.url, secret: webhook.secret, eventId: delivery.eventId, payload: delivery.payload, test, disabled: webhook.disabledAt !== undefined };
  },
});

/** Sends one attempt of a delivery and records it; the scheduler calls it again for a retry. */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const work = await ctx.runQuery(internal.webhooks.job, { deliveryId });
    if (!work) return;
    const at = Date.now();
    const refused = work.disabled && !work.test ? "the webhook is turned off" : targetProblem(work.url);
    if (refused) {
      await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId, at, durationMs: 0, error: refused, final: true });
      return;
    }
    const timestamp = Math.floor(at / 1000);
    let responseStatus: number | undefined;
    let error: string | undefined;
    try {
      const response = await fetch(work.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `Helm-Webhooks/${SERVER_INFO.version}`,
          "webhook-id": work.eventId,
          "webhook-timestamp": String(timestamp),
          "webhook-signature": await signWebhook(work.secret, work.eventId, timestamp, work.payload),
        },
        body: work.payload,
        // A redirect could lead anywhere, the deployment's own network included: it counts as a failure.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      responseStatus = response.status;
      await response.body?.cancel();
    } catch (failure) {
      error = (failure as Error).name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : `could not connect (${(failure as Error).message})`;
    }
    await ctx.runMutation(internal.webhooks.recordAttempt, {
      deliveryId,
      at,
      durationMs: Date.now() - at,
      responseStatus,
      error: error?.slice(0, MAX_ERROR),
      final: false,
    });
  },
});

/** Records an attempt; schedules the next one, or ends the delivery and counts it for the webhook. */
export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    at: v.number(),
    durationMs: v.number(),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    final: v.boolean(),
  },
  handler: async (ctx, { deliveryId, at, durationMs, responseStatus, error, final }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return;
    const attempts = [...delivery.attempts, { at, durationMs, responseStatus, error }];
    const ok = responseStatus !== undefined && responseStatus >= 200 && responseStatus < 300;
    const delays = retryDelaysMs();
    const now = Date.now();
    if (ok) {
      await ctx.db.patch(deliveryId, { attempts, status: "succeeded", finishedAt: now, nextAttemptAt: undefined });
      await settle(ctx, delivery, true, now);
      return;
    }
    const delay = delays[attempts.length - 1];
    if (!final && delay !== undefined) {
      await ctx.db.patch(deliveryId, { attempts, nextAttemptAt: now + delay });
      await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId });
      return;
    }
    await ctx.db.patch(deliveryId, { attempts, status: "failed", finishedAt: now, nextAttemptAt: undefined });
    await settle(ctx, delivery, false, now);
  },
});

/** A finished delivery updates its webhook: a success clears the streak, a failure may turn it off. */
async function settle(ctx: MutationCtx, delivery: Doc<"webhookDeliveries">, ok: boolean, now: number) {
  const webhook = await ctx.db.get(delivery.webhookId);
  if (!webhook) return;
  if (ok) {
    await ctx.db.patch(webhook._id, { failureStreak: 0, lastSuccessAt: now });
    return;
  }
  // A test message, or a delivery dropped because the webhook was already off, does not count.
  if (delivery.type === "webhook.test" || webhook.disabledAt !== undefined) {
    await ctx.db.patch(webhook._id, { lastFailureAt: now });
    return;
  }
  const failureStreak = webhook.failureStreak + 1;
  if (failureStreak < DISABLE_AFTER) {
    await ctx.db.patch(webhook._id, { failureStreak, lastFailureAt: now });
    return;
  }
  const disabledReason = `Turned off after ${failureStreak} deliveries in a row failed on every attempt`;
  await ctx.db.patch(webhook._id, { failureStreak, lastFailureAt: now, disabledAt: now, disabledReason });
  await recordEvent(ctx, { userId: webhook.userId, actor: "app", actorName: "webhooks" }, {
    action: "webhook.disable",
    after: { webhookId: webhook._id, url: webhook.url, reason: disabledReason },
  });
}

/** Run daily by the cron: drops delivery log entries older than 30 days, in batches. */
export const purgeDeliveries = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const at = now ?? Date.now();
    const old = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", at - DELIVERY_RETENTION_MS))
      .take(PURGE_BATCH);
    for (const delivery of old) if (delivery.status !== "pending") await ctx.db.delete(delivery._id);
    if (old.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.webhooks.purgeDeliveries, { now: at });
    return { purged: old.length };
  },
});
