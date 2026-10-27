// Personal API keys for the agent (MCP and CLI) and for integrations (REST,
// docs/api.md). Only the SHA-256 hash is stored; the key is shown once, when
// it is created. A key's kind (cli or agent) is the actor of the changes made
// with it; the default is agent. Since 0.8.0 a key has a scope (read, write
// or full; absent = full) and may expire. A key created with another key
// (POST /api/v1/keys) only reads or writes and works only while that key does.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { args } from "./lib/args";
import { fail, identityOf, ownerOnly, recordEvent } from "./lib/core";
import { randomBase64url, sha256Hex } from "./lib/secrets";
import { identityFields as identityArgs, keyKindValidator, keyScopeValidator, type KeyKind, type KeyScope } from "./lib/validators";

// New keys start with dayhand_; keys from before the rename keep helm_ and still work (they are found by their hash).
const KEY_PREFIX = "dayhand_";
const MAX_NAME = 100;
const DEFAULT_KIND: KeyKind = "agent";
const DEFAULT_SCOPE: KeyScope = "full";

/** Kind of a stored key; keys from before kinds existed are agent keys. */
const kindOf = (key: { kind?: KeyKind }): KeyKind => key.kind ?? DEFAULT_KIND;
/** Scope of a stored key; keys from before scopes existed may do everything. */
export const scopeOf = (key: { scope?: KeyScope }): KeyScope => key.scope ?? DEFAULT_SCOPE;

const SCOPE_RANK: Record<KeyScope, number> = { read: 0, write: 1, full: 2 };
/** Whether a key of scope `has` may do what needs `needs` (read < write < full). */
export const scopeCovers = (has: KeyScope, needs: KeyScope) => SCOPE_RANK[has] >= SCOPE_RANK[needs];

export const hashKey = sha256Hex;

function newKey(): string {
  // Actions have a real random source (mutations are deterministic).
  return KEY_PREFIX + randomBase64url(32);
}

export type CreatedKey = {
  id: Id<"apiKeys">;
  name: string;
  kind: KeyKind;
  scope: KeyScope;
  expiresAt: number | null;
  key: string;
};

/** Domain operation createApiKey: returns the plain key exactly once. */
export const create = internalAction({
  args: { ...identityArgs, ...args.createApiKey },
  handler: async (ctx, input): Promise<CreatedKey> => {
    const key = newKey();
    const id: Id<"apiKeys"> = await ctx.runMutation(internal.apiKeys.insert, { ...input, hash: await hashKey(key) });
    return {
      id,
      name: input.name.trim(),
      kind: input.kind ?? DEFAULT_KIND,
      scope: input.scope ?? DEFAULT_SCOPE,
      expiresAt: input.expiresAt ?? null,
      key,
    };
  },
});

export const insert = internalMutation({
  args: { ...identityArgs, ...args.createApiKey, hash: v.string() },
  handler: async (ctx, input) => {
    const name = input.name.trim();
    if (!name || name.length > MAX_NAME) fail("invalid_argument", `name must be 1 to ${MAX_NAME} characters`);
    const now = Date.now();
    if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)) {
      fail("invalid_argument", "expiresAt must be a time in the future (Unix milliseconds)");
    }
    const kind = input.kind ?? DEFAULT_KIND;
    const scope = input.scope ?? DEFAULT_SCOPE;
    // A key made with a key: never more than read or write, and never beyond its parent.
    const parentKeyId = input.keyId;
    if (parentKeyId !== undefined) {
      if (scope === "full") fail("invalid_argument", "A key created with an API key can only have scope read or write");
      // A cli key is the owner (ownerOnly); an agent key must not mint one and so reach the owner's tools.
      if (kind === "cli") ownerOnly(identityOf(input), "create a cli key");
      const parent = await ctx.db.get(parentKeyId);
      if (parent?.expiresAt !== undefined && (input.expiresAt === undefined || input.expiresAt > parent.expiresAt)) {
        fail("invalid_argument", "The new key must expire no later than the key that creates it");
      }
    }
    const id = await ctx.db.insert("apiKeys", {
      userId: input.userId,
      name,
      kind,
      scope,
      expiresAt: input.expiresAt,
      parentKeyId,
      hash: input.hash,
      createdAt: now,
    });
    const after = { keyId: id, name, kind, scope, ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}) };
    await recordEvent(ctx, identityOf(input), { action: "apiKey.create", after });
    return id;
  },
});

/** Domain operation revokeApiKey: the key (and every key it created) stops working on the next request. */
export const revoke = internalMutation({
  args: { ...identityArgs, ...args.revokeApiKey },
  handler: async (ctx, input) => {
    const { userId, keyId } = input;
    const key = await ctx.db.get(keyId);
    if (!key || key.userId !== userId) fail("not_found", `API key ${keyId} not found`);
    if (key.revokedAt !== undefined) return { id: key._id, revokedAt: key.revokedAt };
    const revokedAt = Date.now();
    await ctx.db.patch(key._id, { revokedAt });
    await recordEvent(ctx, identityOf(input), { action: "apiKey.revoke", after: { keyId, name: key.name } });
    return { id: key._id, revokedAt };
  },
});

export type KeyView = {
  id: Id<"apiKeys">;
  name: string;
  kind: KeyKind;
  scope: KeyScope;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdWith: Id<"apiKeys"> | null;
};

const keyView = (k: Doc<"apiKeys">): KeyView => ({
  id: k._id,
  name: k.name,
  kind: kindOf(k),
  scope: scopeOf(k),
  createdAt: k.createdAt,
  expiresAt: k.expiresAt ?? null,
  revokedAt: k.revokedAt ?? null,
  createdWith: k.parentKeyId ?? null,
});

/** Key metadata for the settings screen and GET /api/v1/keys; never the hash. */
export async function listKeys(ctx: QueryCtx, userId: string): Promise<KeyView[]> {
  const keys = await ctx.db
    .query("apiKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return keys.map(keyView);
}

export const list = internalQuery({
  args: identityArgs,
  handler: (ctx, { userId }) => listKeys(ctx, userId),
});

/** A key works when it is not revoked, not expired, and the key that created it still works. */
const works = (key: Doc<"apiKeys"> | null, now: number): key is Doc<"apiKeys"> =>
  key !== null && key.revokedAt === undefined && (key.expiresAt === undefined || key.expiresAt > now);

/**
 * Resolves the owner of a working key from its hash; null when unknown, revoked or expired.
 * `now` comes from the caller so a cached result never outlives an expiry.
 */
export const verify = internalQuery({
  args: { hash: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { hash, now }) => {
    const at = now ?? Date.now();
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!works(key, at)) return null;
    if (key.parentKeyId !== undefined && !works(await ctx.db.get(key.parentKeyId), at)) return null;
    return { userId: key.userId, keyId: key._id, name: key.name, kind: kindOf(key), scope: scopeOf(key), expiresAt: key.expiresAt ?? null };
  },
});
