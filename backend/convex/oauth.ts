// State of the OAuth authorization server (docs/oauth.md): authorization
// requests waiting for the phone, single-use codes, connections (grants) and
// their tokens. Secrets are generated in HTTP actions (mutations have no real
// random source) and arrive here as selector + SHA-256 only. Failures return a
// result instead of throwing, so that counters and revocations are saved.
// The HTTP endpoints are in oauthHttp.ts; the owner's side is in oauthOwner.ts.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ACCESS_TOKEN_TTL_MS, CODE_TTL_MS, REFRESH_TOKEN_TTL_MS, REQUEST_TTL_MS, scopeValidator, type Scope } from "./lib/oauthConfig";
import { countHit, resetBucket, retryAfter, type Limit } from "./lib/limits";
import { timingSafeEqual } from "./lib/secrets";

const MAX_PENDING_REQUESTS = 10;
const AUTHORIZE_LIMIT: Limit = { bucket: "oauth:authorize", limit: 30, windowMs: 10 * 60 * 1000 };
const REGISTER_LIMIT: Limit = { bucket: "oauth:register", limit: 20, windowMs: 60 * 60 * 1000 };
const TOKEN_LIMIT: Limit = { bucket: "oauth:token", limit: 30, windowMs: 10 * 60 * 1000 };
const RETENTION_MS = 24 * 60 * 60 * 1000;
const UNUSED_CLIENT_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 500;

const clientTypeValidator = v.union(v.literal("cimd"), v.literal("dcr"));
const secretArgs = { selector: v.string(), secretHash: v.string() };

type Limited = { ok: false; reason: "rate_limited"; retryAfterMs: number };

// ---- Client registration (RFC 7591) ----

export const registerClient = internalMutation({
  args: { clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, input): Promise<{ ok: true; createdAt: number } | Limited> => {
    const now = Date.now();
    const wait = await retryAfter(ctx, REGISTER_LIMIT, now);
    if (wait !== null) return { ok: false, reason: "rate_limited", retryAfterMs: wait };
    await countHit(ctx, REGISTER_LIMIT, now);
    await ctx.db.insert("oauthClients", { ...input, createdAt: now });
    return { ok: true, createdAt: now };
  },
});

export const getClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    const client = await ctx.db
      .query("oauthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .unique();
    return client ? { name: client.name, redirectUris: client.redirectUris } : null;
  },
});

// ---- Authorization requests (the browser's side) ----

async function requestByHandle(ctx: QueryCtx, selector: string, secretHash: string) {
  const request = await ctx.db
    .query("oauthRequests")
    .withIndex("by_selector", (q) => q.eq("selector", selector))
    .unique();
  return request && timingSafeEqual(request.secretHash, secretHash) ? request : null;
}

export type RequestStatus = "pending" | "approved" | "denied" | "expired" | "completed";

export function requestStatusOf(request: Doc<"oauthRequests">, now: number): RequestStatus {
  if (request.codeHash !== undefined) return "completed";
  if (request.deniedAt !== undefined) return "denied";
  if (request.expiresAt <= now) return "expired";
  return request.approvedAt !== undefined ? "approved" : "pending";
}

/** Starts a request; refused while too many are waiting or too many were started lately. */
export const createRequest = internalMutation({
  args: {
    ...secretArgs,
    userCodeHash: v.string(),
    clientId: v.string(),
    clientType: clientTypeValidator,
    clientName: v.string(),
    redirectUri: v.string(),
    state: v.optional(v.string()),
    codeChallenge: v.string(),
    scopes: v.array(scopeValidator),
    resource: v.string(),
  },
  handler: async (ctx, input): Promise<{ ok: true; expiresAt: number } | Limited | { ok: false; reason: "collision" }> => {
    const now = Date.now();
    const live = await ctx.db
      .query("oauthRequests")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", now))
      .take(MAX_PENDING_REQUESTS * 4);
    const waiting = live.filter((r) => requestStatusOf(r, now) === "pending");
    const wait = await retryAfter(ctx, AUTHORIZE_LIMIT, now);
    if (wait !== null || waiting.length >= MAX_PENDING_REQUESTS) {
      const oldest = Math.min(...waiting.map((r) => r.expiresAt), now + REQUEST_TTL_MS);
      return { ok: false, reason: "rate_limited", retryAfterMs: wait ?? oldest - now };
    }
    if (live.some((r) => r.userCodeHash === input.userCodeHash)) return { ok: false, reason: "collision" };
    await countHit(ctx, AUTHORIZE_LIMIT, now);
    const expiresAt = now + REQUEST_TTL_MS;
    await ctx.db.insert("oauthRequests", { ...input, createdAt: now, expiresAt });
    return { ok: true, expiresAt };
  },
});

export const requestStatus = internalQuery({
  args: secretArgs,
  handler: async (ctx, { selector, secretHash }): Promise<RequestStatus | null> => {
    const request = await requestByHandle(ctx, selector, secretHash);
    return request ? requestStatusOf(request, Date.now()) : null;
  },
});

type Finish =
  | { status: "approved" | "denied"; redirectUri: string; state: string | null }
  | { status: "pending"; redirectUri: string; clientName: string; scopes: Scope[] }
  | { status: "expired" | "completed" | "unknown" };

/** After the phone decided: stores the code (once) and says where to send the browser. */
export const finishRequest = internalMutation({
  args: { ...secretArgs, codeHash: v.string() },
  handler: async (ctx, { selector, secretHash, codeHash }): Promise<Finish> => {
    const request = await requestByHandle(ctx, selector, secretHash);
    if (!request) return { status: "unknown" };
    const now = Date.now();
    const status = requestStatusOf(request, now);
    if (status === "pending") {
      return { status, redirectUri: request.redirectUri, clientName: request.clientName, scopes: request.scopes };
    }
    if (status !== "approved" && status !== "denied") return { status };
    if (status === "approved") await ctx.db.patch(request._id, { codeHash, codeExpiresAt: now + CODE_TTL_MS });
    return { status, redirectUri: request.redirectUri, state: request.state ?? null };
  },
});

// ---- Token endpoint ----

type TokenFailure = { ok: false; error: "invalid_grant" | "invalid_target"; description: string } | Limited;
type TokenSuccess = { ok: true; scopes: Scope[] };
const newTokens = {
  accessSelector: v.string(),
  accessHash: v.string(),
  refreshSelector: v.string(),
  refreshHash: v.string(),
};
const INVALID_GRANT = { ok: false, error: "invalid_grant", description: "The code or token is not valid" } as const;

async function insertTokens(
  ctx: MutationCtx,
  grantId: Id<"oauthGrants">,
  tokens: { accessSelector: string; accessHash: string; refreshSelector: string; refreshHash: string },
  now: number,
) {
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_MS;
  await ctx.db.insert("oauthTokens", {
    grantId,
    kind: "access",
    selector: tokens.accessSelector,
    secretHash: tokens.accessHash,
    createdAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
  });
  await ctx.db.insert("oauthTokens", {
    grantId,
    kind: "refresh",
    selector: tokens.refreshSelector,
    secretHash: tokens.refreshHash,
    createdAt: now,
    expiresAt: refreshExpiresAt,
  });
  await ctx.db.patch(grantId, { refreshExpiresAt });
}

async function revokeGrant(ctx: MutationCtx, grantId: Id<"oauthGrants">, now: number) {
  const grant = await ctx.db.get(grantId);
  if (grant && grant.revokedAt === undefined) await ctx.db.patch(grantId, { revokedAt: now });
}

async function failToken(ctx: MutationCtx, now: number): Promise<TokenFailure> {
  await countHit(ctx, TOKEN_LIMIT, now);
  return INVALID_GRANT;
}

/**
 * authorization_code grant. The code dies on its first presentation, right or wrong; presenting
 * it again revokes the connection it created (RFC 6749 section 4.1.2).
 */
export const exchangeCode = internalMutation({
  args: { codeHash: v.string(), clientId: v.string(), redirectUri: v.string(), challenge: v.string(), resource: v.string(), ...newTokens },
  handler: async (ctx, input): Promise<TokenSuccess | TokenFailure> => {
    const now = Date.now();
    const wait = await retryAfter(ctx, TOKEN_LIMIT, now);
    if (wait !== null) return { ok: false, reason: "rate_limited", retryAfterMs: wait };
    const request = await ctx.db
      .query("oauthRequests")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", input.codeHash))
      .unique();
    if (!request || request.codeExpiresAt === undefined || request.userId === undefined) return failToken(ctx, now);
    if (request.codeUsedAt !== undefined) {
      if (request.grantId) await revokeGrant(ctx, request.grantId, now);
      return failToken(ctx, now);
    }
    await ctx.db.patch(request._id, { codeUsedAt: now });
    const matches =
      request.codeExpiresAt > now &&
      request.clientId === input.clientId &&
      request.redirectUri === input.redirectUri &&
      timingSafeEqual(request.codeChallenge, input.challenge);
    if (!matches) return failToken(ctx, now);
    if (request.resource !== input.resource) {
      return { ok: false, error: "invalid_target", description: "The resource is not the one this code was issued for" };
    }
    const scopes = request.grantedScopes ?? [];
    const grantId = await ctx.db.insert("oauthGrants", {
      userId: request.userId,
      clientId: request.clientId,
      clientType: request.clientType,
      clientName: request.clientName,
      redirectUri: request.redirectUri,
      scopes,
      resource: request.resource,
      createdAt: now,
      refreshExpiresAt: now,
    });
    await ctx.db.patch(request._id, { grantId });
    await insertTokens(ctx, grantId, input, now);
    if (request.clientType === "dcr") {
      const client = await ctx.db
        .query("oauthClients")
        .withIndex("by_clientId", (q) => q.eq("clientId", request.clientId))
        .unique();
      if (client) await ctx.db.patch(client._id, { lastUsedAt: now });
    }
    return { ok: true, scopes };
  },
});

async function tokenBySelector(ctx: QueryCtx, selector: string) {
  return ctx.db
    .query("oauthTokens")
    .withIndex("by_selector", (q) => q.eq("selector", selector))
    .unique();
}

/**
 * refresh_token grant with rotation: the old refresh token dies, and using a dead one again
 * revokes the whole connection (it may have been stolen). `scopes`, when given, may only narrow.
 */
export const refresh = internalMutation({
  args: { ...secretArgs, clientId: v.string(), resource: v.string(), scopes: v.optional(v.array(scopeValidator)), ...newTokens },
  handler: async (ctx, input): Promise<TokenSuccess | TokenFailure | { ok: false; error: "invalid_scope"; description: string }> => {
    const now = Date.now();
    const token = await tokenBySelector(ctx, input.selector);
    if (!token || token.kind !== "refresh" || !timingSafeEqual(token.secretHash, input.secretHash)) return failToken(ctx, now);
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.revokedAt !== undefined || grant.clientId !== input.clientId) return INVALID_GRANT;
    if (token.rotatedAt !== undefined) {
      await revokeGrant(ctx, grant._id, now);
      return INVALID_GRANT;
    }
    if (token.expiresAt <= now) return INVALID_GRANT;
    if (grant.resource !== input.resource) {
      return { ok: false, error: "invalid_target", description: "The resource is not the one this token was issued for" };
    }
    if (input.scopes && input.scopes.some((s) => !grant.scopes.includes(s))) {
      return { ok: false, error: "invalid_scope", description: "A refresh cannot add scopes" };
    }
    await ctx.db.patch(token._id, { rotatedAt: now });
    await insertTokens(ctx, grant._id, input, now);
    return { ok: true, scopes: grant.scopes };
  },
});

/** RFC 7009: revoking either token ends the connection. Unknown tokens are not an error. */
export const revokeToken = internalMutation({
  args: { ...secretArgs, clientId: v.string() },
  handler: async (ctx, { selector, secretHash, clientId }) => {
    const token = await tokenBySelector(ctx, selector);
    if (!token || !timingSafeEqual(token.secretHash, secretHash)) return;
    const grant = await ctx.db.get(token.grantId);
    if (grant && grant.clientId === clientId) await revokeGrant(ctx, grant._id, Date.now());
  },
});

// ---- The protected resource (/mcp) ----

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export type Connection = {
  userId: string;
  connectionId: Id<"oauthGrants">;
  clientName: string;
  scopes: Scope[];
  resource: string;
  stale: boolean;
};

/** The connection behind a live access token; null when unknown, wrong, expired or revoked. */
export const verifyAccessToken = internalQuery({
  args: secretArgs,
  handler: async (ctx, { selector, secretHash }): Promise<Connection | null> => {
    const token = await tokenBySelector(ctx, selector);
    const now = Date.now();
    if (!token || token.kind !== "access" || token.expiresAt <= now || !timingSafeEqual(token.secretHash, secretHash)) return null;
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.revokedAt !== undefined) return null;
    return {
      userId: grant.userId,
      connectionId: grant._id,
      clientName: grant.clientName,
      scopes: grant.scopes,
      resource: grant.resource,
      stale: now - (grant.lastUsedAt ?? 0) > TOUCH_INTERVAL_MS,
    };
  },
});

/** Records use of a connection (at most every few minutes, so reads stay cheap). */
export const touchConnection = internalMutation({
  args: { connectionId: v.id("oauthGrants") },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.patch(connectionId, { lastUsedAt: Date.now() });
  },
});

// ---- Housekeeping ----

/** Run daily by the cron: old requests, dead tokens and registrations nobody used. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const requests = await ctx.db
      .query("oauthRequests")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff))
      .take(PURGE_BATCH);
    for (const request of requests) await ctx.db.delete(request._id);
    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff))
      .take(PURGE_BATCH);
    for (const token of tokens) await ctx.db.delete(token._id);
    const clients = await ctx.db
      .query("oauthClients")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - UNUSED_CLIENT_MS))
      .take(PURGE_BATCH);
    const unused = clients.filter((c) => c.lastUsedAt === undefined);
    for (const client of unused) await ctx.db.delete(client._id);
    return { requests: requests.length, tokens: tokens.length, clients: unused.length };
  },
});

/** Clears the OAuth limits, e.g. after someone filled them on purpose: `npx convex run oauth:resetLimits`. */
export const resetLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const { bucket } of [AUTHORIZE_LIMIT, REGISTER_LIMIT, TOKEN_LIMIT]) await resetBucket(ctx, bucket);
  },
});
