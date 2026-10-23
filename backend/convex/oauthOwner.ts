// The owner's side of OAuth (docs/oauth.md): the phone approves or refuses an
// authorization request by the code the browser shows, and the owner lists and
// revokes agent connections. Used by the app layer (app.ts, signed-in user)
// and by /connections (oauthHttp.ts, personal API key).
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requestStatusOf } from "./oauth";
import { fail, identityOf, recordEvent, type Identity } from "./lib/core";
import { countHit, retryAfter, type Limit } from "./lib/limits";
import { scopeValidator, type Scope } from "./lib/oauthConfig";
import { checkGranted, redirectHost, redirectKind } from "./lib/oauthRules";
import { normalizeUserCode, sha256Hex } from "./lib/secrets";
import { identityFields } from "./lib/validators";

const codeLimit = (userId: string): Limit => ({ bucket: `oauth:code|${userId}`, limit: 10, windowMs: 10 * 60 * 1000 });

/** What the consent screen shows. The client's name is self-asserted; the hosts are not. */
export type ConnectionRequestView = {
  requestId: Id<"oauthRequests">;
  clientName: string;
  /** cimd: Helm fetched the client's metadata from `clientHost`; dcr: the client registered itself. */
  clientType: "cimd" | "dcr";
  clientHost: string | null;
  /** Where the authorization goes back to: claude.ai, or localhost for Claude Code. */
  redirectHost: string;
  loopback: boolean;
  scopes: Scope[];
  /** When the browser asked: a request the owner did not just start is a warning sign. */
  createdAt: number;
  expiresAt: number;
};

export type LookupResult =
  | { status: "found"; request: ConnectionRequestView }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterMs: number };

function viewOf(request: Doc<"oauthRequests">): ConnectionRequestView {
  return {
    requestId: request._id,
    clientName: request.clientName,
    clientType: request.clientType,
    clientHost: request.clientType === "cimd" ? new URL(request.clientId).host : null,
    redirectHost: redirectHost(request.redirectUri),
    loopback: redirectKind(request.redirectUri) === "loopback",
    scopes: request.scopes,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

/** The waiting request with this code, counting a wrong code against the user's limit. */
async function findByCode(ctx: MutationCtx, userId: string, code: string) {
  const now = Date.now();
  const limit = codeLimit(userId);
  const wait = await retryAfter(ctx, limit, now);
  if (wait !== null) return { status: "rate_limited" as const, retryAfterMs: wait };
  const normalized = normalizeUserCode(code);
  const codeHash = normalized ? await sha256Hex(normalized) : null;
  const sameCode = codeHash
    ? await ctx.db
        .query("oauthRequests")
        .withIndex("by_userCodeHash", (q) => q.eq("userCodeHash", codeHash))
        .collect()
    : [];
  // An old request may have drawn the same code; only a waiting one counts.
  const request = sameCode.find((r) => requestStatusOf(r, now) === "pending");
  if (!request) {
    await countHit(ctx, limit, now);
    return { status: "not_found" as const };
  }
  return { status: "found" as const, request };
}

/** Domain operation lookupConnectionRequest: the details behind a code, for the consent screen. */
export async function lookupRequest(ctx: MutationCtx, identity: Identity, code: string): Promise<LookupResult> {
  const found = await findByCode(ctx, identity.userId, code);
  return found.status === "found" ? { status: "found", request: viewOf(found.request) } : found;
}

export type DecideResult =
  | { status: "approved"; scopes: Scope[] }
  | { status: "denied" }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterMs: number };

/**
 * Domain operation decideConnectionRequest: approve with some of the requested scopes, or refuse.
 * The code, not the request id, is what proves the user saw the browser that asked.
 */
export async function decideRequest(
  ctx: MutationCtx,
  identity: Identity,
  input: { code: string; approve: boolean; scopes?: Scope[] },
): Promise<DecideResult> {
  const found = await findByCode(ctx, identity.userId, input.code);
  if (found.status !== "found") return found;
  const { request } = found;
  const now = Date.now();
  const details = { requestId: request._id, clientName: request.clientName, redirectHost: redirectHost(request.redirectUri) };
  if (!input.approve) {
    await ctx.db.patch(request._id, { deniedAt: now });
    await recordEvent(ctx, identityOf(identity), { action: "connection.deny", after: details });
    return { status: "denied" };
  }
  const scopes = checkGranted(request.scopes, input.scopes ?? request.scopes);
  if (!scopes) fail("invalid_argument", `scopes must be a non-empty part of ${request.scopes.join(", ")}`);
  await ctx.db.patch(request._id, { userId: identity.userId, grantedScopes: scopes, approvedAt: now });
  await recordEvent(ctx, identityOf(identity), { action: "connection.approve", after: { ...details, scopes } });
  return { status: "approved", scopes };
}

/** A connection as the owner sees it; never a token or hash. */
export function connectionView(grant: Doc<"oauthGrants">, now = Date.now()) {
  return {
    id: grant._id,
    clientName: grant.clientName,
    clientType: grant.clientType,
    clientHost: grant.clientType === "cimd" ? new URL(grant.clientId).host : null,
    redirectHost: redirectHost(grant.redirectUri),
    scopes: grant.scopes,
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt ?? null,
    expiresAt: grant.refreshExpiresAt,
    revokedAt: grant.revokedAt ?? null,
    active: grant.revokedAt === undefined && grant.refreshExpiresAt > now,
  };
}
export type ConnectionView = ReturnType<typeof connectionView>;

/** Domain operation listConnections: newest first. */
export async function listConnections(ctx: QueryCtx, userId: string): Promise<ConnectionView[]> {
  const grants = await ctx.db
    .query("oauthGrants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  return grants.map((g) => connectionView(g, now)).sort((a, b) => b.createdAt - a.createdAt);
}

/** Domain operation revokeConnection: every token of the connection stops on its next use. */
export async function revokeConnection(ctx: MutationCtx, identity: Identity, connectionId: string) {
  const id = ctx.db.normalizeId("oauthGrants", connectionId);
  const grant = id ? await ctx.db.get(id) : null;
  if (!grant || grant.userId !== identity.userId) fail("not_found", `Connection ${connectionId} not found`);
  if (grant.revokedAt !== undefined) return { id: grant._id, revokedAt: grant.revokedAt };
  const revokedAt = Date.now();
  await ctx.db.patch(grant._id, { revokedAt });
  await recordEvent(ctx, identityOf(identity), {
    action: "connection.revoke",
    after: { connectionId: grant._id, clientName: grant.clientName },
  });
  return { id: grant._id, revokedAt };
}

// Internal functions for /connections (API key) and the deployment admin.

export const list = internalQuery({
  args: identityFields,
  handler: (ctx, { userId }) => listConnections(ctx, userId),
});

/** `id` is the connection to revoke (`connectionId` is the caller's own identity field). */
export const revoke = internalMutation({
  args: { ...identityFields, id: v.string() },
  handler: (ctx, input) => revokeConnection(ctx, identityOf(input), input.id),
});

export const decide = internalMutation({
  args: { ...identityFields, code: v.string(), approve: v.boolean(), scopes: v.optional(v.array(scopeValidator)) },
  handler: (ctx, input) => decideRequest(ctx, identityOf(input), input),
});
