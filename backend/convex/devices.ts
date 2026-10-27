// Phone pairing: one-time pairing codes, long-lived revocable device tokens
// and the failed-attempt limit of the pairing endpoint. Codes and tokens are
// generated in actions; only SHA-256 hashes of their secret parts are stored.
// The HTTP endpoints are in pairing.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { appSubject } from "./lib/appToken";
import { fail, identityOf, ownerOnly, recordEvent } from "./lib/core";
import { serverEnv } from "./lib/env";
import { formatPairingCode, newPairingCode, parsePairingCode, sha256Hex, timingSafeEqual } from "./lib/secrets";
import { identityFields as identityArgs } from "./lib/validators";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const PAIR_BUCKET = "pair";
const PAIR_FAILURE_LIMIT = 10;
const PAIR_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const CODE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_NAME = 100;

export function checkDeviceName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) fail("invalid_argument", `deviceName must be 1 to ${MAX_NAME} characters`);
  return trimmed;
}

// ---- Pairing codes ----

/** Creates a pairing code for `userId`; the plain code is returned exactly once. `ttlMs` is only for tests. */
export const createPairingCode = internalAction({
  args: { ...identityArgs, createdBy: v.optional(v.string()), ttlMs: v.optional(v.number()) },
  handler: async (ctx, input): Promise<{ code: string; expiresAt: number }> => {
    ownerOnly(identityOf(input), "create pairing codes");
    const ttlMs = Math.min(Math.max(input.ttlMs ?? PAIRING_CODE_TTL_MS, 1), PAIRING_CODE_TTL_MS);
    // A new selector rarely collides with an active code; draw again if it does.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      const parsed = parsePairingCode(code)!;
      const expiresAt: number | null = await ctx.runMutation(internal.devices.insertCode, {
        ...identityOf(input),
        createdBy: input.createdBy ?? "admin",
        selector: parsed.selector,
        secretHash: await sha256Hex(parsed.secret),
        ttlMs,
      });
      if (expiresAt !== null) return { code: formatPairingCode(code), expiresAt };
    }
    throw new Error("Could not draw an unused pairing code");
  },
});

export const insertCode = internalMutation({
  args: { ...identityArgs, createdBy: v.string(), selector: v.string(), secretHash: v.string(), ttlMs: v.number() },
  handler: async (ctx, input) => {
    const { userId, createdBy, selector, secretHash, ttlMs } = input;
    const issuer = serverEnv("JWT_ISSUER") ?? "";
    if (!appSubject(userId, issuer)) {
      fail("invalid_argument", `User ${userId} cannot sign in to the app: app users are "${issuer}|<subject>"`);
    }
    const now = Date.now();
    const sameSelector = await ctx.db
      .query("pairingCodes")
      .withIndex("by_selector", (q) => q.eq("selector", selector))
      .collect();
    if (sameSelector.some((c) => c.usedAt === undefined && c.expiresAt > now)) return null;
    const expiresAt = now + ttlMs;
    const id = await ctx.db.insert("pairingCodes", {
      userId,
      selector,
      secretHash,
      createdBy,
      createdAt: now,
      expiresAt,
      failedAttempts: 0,
    });
    await recordEvent(ctx, identityOf(input), { action: "device.pairingCode", after: { codeId: id, createdBy, expiresAt } });
    return expiresAt;
  },
});

// ---- Failed-attempt limit of POST /auth/pair ----
// One counter for the whole deployment (the endpoint is unauthenticated, so
// there is no user to count per). Over the limit, codes are not checked at all.

async function pairLimitRow(ctx: MutationCtx) {
  return ctx.db
    .query("authLimits")
    .withIndex("by_bucket", (q) => q.eq("bucket", PAIR_BUCKET))
    .unique();
}

async function recordPairFailure(ctx: MutationCtx, now: number) {
  const row = await pairLimitRow(ctx);
  if (!row) {
    await ctx.db.insert("authLimits", { bucket: PAIR_BUCKET, windowStart: now, failures: 1 });
  } else if (now - row.windowStart >= PAIR_FAILURE_WINDOW_MS) {
    await ctx.db.patch(row._id, { windowStart: now, failures: 1 });
  } else {
    await ctx.db.patch(row._id, { failures: row.failures + 1 });
  }
}

/** Clears the failed-attempt counter, e.g. after an attacker locked pairing: `npx convex run devices:resetPairLimit`. */
export const resetPairLimit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await pairLimitRow(ctx);
    if (row) await ctx.db.delete(row._id);
  },
});

type RedeemResult =
  | { ok: true; deviceId: Id<"devices"> }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterMs: number };

/**
 * Exchanges a pairing code for a new device, at most once. Failures return
 * instead of throwing so that the failure counters are saved.
 */
export const redeemCode = internalMutation({
  args: {
    selector: v.string(),
    secretHash: v.string(),
    deviceName: v.string(),
    deviceSelector: v.string(),
    deviceSecretHash: v.string(),
  },
  handler: async (ctx, input): Promise<RedeemResult> => {
    const now = Date.now();
    const limit = await pairLimitRow(ctx);
    if (limit && now - limit.windowStart < PAIR_FAILURE_WINDOW_MS && limit.failures >= PAIR_FAILURE_LIMIT) {
      return { ok: false, reason: "rate_limited", retryAfterMs: limit.windowStart + PAIR_FAILURE_WINDOW_MS - now };
    }
    const code = (
      await ctx.db
        .query("pairingCodes")
        .withIndex("by_selector", (q) => q.eq("selector", input.selector))
        .collect()
    ).find((c) => c.usedAt === undefined && c.expiresAt > now && c.failedAttempts < MAX_CODE_ATTEMPTS);
    if (!code || !timingSafeEqual(code.secretHash, input.secretHash)) {
      if (code) await ctx.db.patch(code._id, { failedAttempts: code.failedAttempts + 1 });
      await recordPairFailure(ctx, now);
      return { ok: false, reason: "invalid" };
    }
    await ctx.db.patch(code._id, { usedAt: now });
    const name = checkDeviceName(input.deviceName);
    const deviceId = await ctx.db.insert("devices", {
      userId: code.userId,
      name,
      selector: input.deviceSelector,
      secretHash: input.deviceSecretHash,
      pairedBy: code.createdBy,
      createdAt: now,
    });
    await recordEvent(ctx, { userId: code.userId, actor: "app" }, { action: "device.pair", after: { deviceId, name } });
    return { ok: true, deviceId };
  },
});

/** Run daily by the cron: removes codes that expired more than a day ago. */
export const purgeExpiredCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("pairingCodes")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now() - CODE_RETENTION_MS))
      .take(500);
    for (const code of expired) await ctx.db.delete(code._id);
    return { purged: expired.length };
  },
});

// ---- Devices ----

/** Resolves an active device from its token; records the use. Null when unknown, wrong or revoked. */
export const useToken = internalMutation({
  args: { selector: v.string(), secretHash: v.string() },
  handler: async (ctx, { selector, secretHash }) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_selector", (q) => q.eq("selector", selector))
      .unique();
    if (!device || device.revokedAt !== undefined || !timingSafeEqual(device.secretHash, secretHash)) return null;
    await ctx.db.patch(device._id, { lastUsedAt: Date.now() });
    return { userId: device.userId, deviceId: device._id };
  },
});

/** Device metadata for `dayhand devices`; never the hash. */
export const list = internalQuery({
  args: identityArgs,
  handler: async (ctx, { userId }) => {
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return devices.map((d) => ({
      id: d._id,
      name: d.name,
      pairedBy: d.pairedBy,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt ?? null,
      revokedAt: d.revokedAt ?? null,
    }));
  },
});

/** The device gets no new app tokens; a token it already holds expires within an hour. */
export const revoke = internalMutation({
  args: { ...identityArgs, deviceId: v.string() },
  handler: async (ctx, input) => {
    const { userId, deviceId } = input;
    const id = ctx.db.normalizeId("devices", deviceId);
    const device = id ? await ctx.db.get(id) : null;
    if (!device || device.userId !== userId) fail("not_found", `Device ${deviceId} not found`);
    if (device.revokedAt !== undefined) return { id: device._id, revokedAt: device.revokedAt };
    const revokedAt = Date.now();
    await ctx.db.patch(device._id, { revokedAt });
    await recordEvent(ctx, identityOf(input), { action: "device.revoke", after: { deviceId: device._id, name: device.name } });
    return { id: device._id, revokedAt };
  },
});
