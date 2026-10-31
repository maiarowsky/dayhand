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
import { countHit, deleteBuckets, retryAfter, type Limit } from "./lib/limits";
import { timingSafeEqual } from "./lib/secrets";

// Limits on what unauthenticated callers can create. Per client, so that a stranger flooding the
// endpoint with their own (or Claude Code's) client cannot block another client; the global
// buckets only guard the database against floods. There is no lockout on the token endpoint:
// codes and tokens are 256-bit random, and a lockout would only let anyone block real clients.
const MAX_PENDING_PER_CLIENT = 5;
const LIMIT_PREFIX = "oauth:";
const AUTHORIZE_WINDOW_MS = 10 * 60 * 1000;
const authorizeLimit = (clientId: string): Limit => ({ bucket: `oauth:authorize|${clientId}`, limit: 20, windowMs: AUTHORIZE_WINDOW_MS });
const AUTHORIZE_FLOOD_LIMIT: Limit = { bucket: "oauth:authorize", limit: 300, windowMs: AUTHORIZE_WINDOW_MS };
const REGISTER_LIMIT: Limit = { bucket: "oauth:register", limit: 100, windowMs: 60 * 60 * 1000 };
/** A rotated refresh token presented again this soon is a retry (a lost answer), not a theft. */
const REFRESH_RETRY_MS = 30 * 1000;
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

/** Counts every authorization attempt before any metadata fetch, including malformed requests. */
export const consumeAuthorize = internalMutation({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }): Promise<{ ok: true } | Limited> => {
    const now = Date.now();
    const limit = authorizeLimit(clientId);
    const wait = (await retryAfter(ctx, limit, now)) ?? (await retryAfter(ctx, AUTHORIZE_FLOOD_LIMIT, now));
    if (wait !== null) return { ok: false, reason: "rate_limited", retryAfterMs: wait };
    await countHit(ctx, limit, now);
    await countHit(ctx, AUTHORIZE_FLOOD_LIMIT, now);
    return { ok: true };
  },
});

/** Starts a request after the HTTP ingress limit; refused while too many of this client's are waiting. */
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
      .take(AUTHORIZE_FLOOD_LIMIT.limit * 2);
    const waiting = live.filter((r) => r.clientId === input.clientId && requestStatusOf(r, now) === "pending");
    if (waiting.length >= MAX_PENDING_PER_CLIENT) {
      const oldest = Math.min(...waiting.map((r) => r.expiresAt), now + REQUEST_TTL_MS);
      return { ok: false, reason: "rate_limited", retryAfterMs: oldest - now };
    }
    if (live.some((r) => r.userCodeHash === input.userCodeHash)) return { ok: false, reason: "collision" };
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

type TokenFailure = { ok: false; error: "invalid_grant" | "invalid_target"; description: string };
type TokenSuccess = { ok: true; scopes: Scope[] };
const newTokens = {
  accessSelector: v.string(),
  accessHash: v.string(),
  refreshSelector: v.string(),
  refreshHash: v.string(),
};
const INVALID_GRANT = { ok: false, error: "invalid_grant", description: "The code or token is not valid" } as const;

/** A token's own scopes (after a narrowing refresh) never exceed the grant's. */
const grantedScopes = (token: Scope[] | undefined, grant: Scope[]) => (token ? grant.filter((s) => token.includes(s)) : grant);

/** A new token pair; `scopes` is set only when a refresh narrowed the grant's scopes. */
async function insertTokens(
  ctx: MutationCtx,
  grantId: Id<"oauthGrants">,
  tokens: { accessSelector: string; accessHash: string; refreshSelector: string; refreshHash: string },
  now: number,
  scopes?: Scope[],
) {
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_MS;
  await ctx.db.insert("oauthTokens", {
    grantId,
    kind: "access",
    selector: tokens.accessSelector,
    secretHash: tokens.accessHash,
    createdAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
    scopes,
  });
  await ctx.db.insert("oauthTokens", {
    grantId,
    kind: "refresh",
    selector: tokens.refreshSelector,
    secretHash: tokens.refreshHash,
    createdAt: now,
    expiresAt: refreshExpiresAt,
    scopes,
  });
  await ctx.db.patch(grantId, { refreshExpiresAt });
}

async function revokeGrant(ctx: MutationCtx, grantId: Id<"oauthGrants">, now: number) {
  const grant = await ctx.db.get(grantId);
  if (grant && grant.revokedAt === undefined) await ctx.db.patch(grantId, { revokedAt: now });
}

/**
 * authorization_code grant. The code dies on its first presentation, right or wrong; presenting
 * it again revokes the connection it created (RFC 6749 section 4.1.2).
 */
export const exchangeCode = internalMutation({
  args: { codeHash: v.string(), clientId: v.string(), redirectUri: v.string(), challenge: v.string(), resource: v.string(), ...newTokens },
  handler: async (ctx, input): Promise<TokenSuccess | TokenFailure> => {
    const now = Date.now();
    const request = await ctx.db
      .query("oauthRequests")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", input.codeHash))
      .unique();
    if (!request || request.codeExpiresAt === undefined || request.userId === undefined) return INVALID_GRANT;
    if (request.codeUsedAt !== undefined) {
      if (request.grantId) await revokeGrant(ctx, request.grantId, now);
      return INVALID_GRANT;
    }
    await ctx.db.patch(request._id, { codeUsedAt: now });
    const matches =
      request.codeExpiresAt > now &&
      request.clientId === input.clientId &&
      request.redirectUri === input.redirectUri &&
      timingSafeEqual(request.codeChallenge, input.challenge);
    if (!matches) return INVALID_GRANT;
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

/** Ends the grant's live refresh tokens, so that a connection has only one at a time. */
async function retireRefreshTokens(ctx: MutationCtx, grantId: Id<"oauthGrants">, now: number) {
  const tokens = await ctx.db
    .query("oauthTokens")
    .withIndex("by_grant", (q) => q.eq("grantId", grantId))
    .collect();
  for (const token of tokens) {
    if (token.kind === "refresh" && token.rotatedAt === undefined) await ctx.db.patch(token._id, { rotatedAt: now });
  }
}

/**
 * refresh_token grant with rotation: the old refresh token dies, and using a dead one again
 * revokes the whole connection (it may have been stolen). The exception is a retry within
 * REFRESH_RETRY_MS, when the client most likely lost the answer: it gets a new pair, and the pair
 * it never saw dies instead. `scopes`, when given, may only narrow, and the narrowing sticks to
 * the new tokens.
 */
export const refresh = internalMutation({
  args: { ...secretArgs, clientId: v.string(), resource: v.string(), scopes: v.optional(v.array(scopeValidator)), ...newTokens },
  handler: async (ctx, input): Promise<TokenSuccess | TokenFailure | { ok: false; error: "invalid_scope"; description: string }> => {
    const now = Date.now();
    const token = await tokenBySelector(ctx, input.selector);
    if (!token || token.kind !== "refresh" || !timingSafeEqual(token.secretHash, input.secretHash)) return INVALID_GRANT;
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.revokedAt !== undefined || grant.clientId !== input.clientId) return INVALID_GRANT;
    if (token.rotatedAt !== undefined && now - token.rotatedAt > REFRESH_RETRY_MS) {
      await revokeGrant(ctx, grant._id, now);
      return INVALID_GRANT;
    }
    if (token.expiresAt <= now) return INVALID_GRANT;
    if (grant.resource !== input.resource) {
      return { ok: false, error: "invalid_target", description: "The resource is not the one this token was issued for" };
    }
    const allowed = grantedScopes(token.scopes, grant.scopes);
    if (input.scopes && input.scopes.some((s) => !allowed.includes(s))) {
      return { ok: false, error: "invalid_scope", description: "A refresh cannot add scopes" };
    }
    const scopes = input.scopes ? allowed.filter((s) => input.scopes!.includes(s)) : allowed;
    await retireRefreshTokens(ctx, grant._id, now);
    if (token.rotatedAt === undefined) await ctx.db.patch(token._id, { rotatedAt: now });
    await insertTokens(ctx, grant._id, input, now, scopes.length < grant.scopes.length ? scopes : undefined);
    return { ok: true, scopes };
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

export type Connection = {
  userId: string;
  connectionId: Id<"oauthGrants">;
  clientName: string;
  scopes: Scope[];
  resource: string;
  expiresAt: number;
  lastUsedAt: number | null;
};

/**
 * The connection behind an access token; null when unknown, wrong or revoked. Expiry is checked
 * by the caller against `expiresAt`: a query's clock is not reliable, as its result may be cached.
 */
export const verifyAccessToken = internalQuery({
  args: secretArgs,
  handler: async (ctx, { selector, secretHash }): Promise<Connection | null> => {
    const token = await tokenBySelector(ctx, selector);
    if (!token || token.kind !== "access" || !timingSafeEqual(token.secretHash, secretHash)) return null;
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.revokedAt !== undefined) return null;
    return {
      userId: grant.userId,
      connectionId: grant._id,
      clientName: grant.clientName,
      scopes: grantedScopes(token.scopes, grant.scopes),
      resource: grant.resource,
      expiresAt: token.expiresAt,
      lastUsedAt: grant.lastUsedAt ?? null,
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
    await deleteBuckets(ctx, LIMIT_PREFIX, cutoff, PURGE_BATCH);
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
    await deleteBuckets(ctx, LIMIT_PREFIX, Infinity, PURGE_BATCH);
  },
});
