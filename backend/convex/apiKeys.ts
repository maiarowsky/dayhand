// Personal API keys for the agent (MCP and CLI). Only the SHA-256 hash is
// stored; the key is shown once, when it is created.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { args } from "./lib/args";
import { fail, recordEvent } from "./lib/core";
import { randomBase64url, sha256Hex } from "./lib/secrets";
import { actorValidator } from "./lib/validators";

const KEY_PREFIX = "helm_";
const MAX_NAME = 100;
const identityArgs = { userId: v.string(), actor: actorValidator };

export const hashKey = sha256Hex;

function newKey(): string {
  // Actions have a real random source (mutations are deterministic).
  return KEY_PREFIX + randomBase64url(32);
}

/** Domain operation createApiKey: returns the plain key exactly once. */
export const create = internalAction({
  args: { ...identityArgs, ...args.createApiKey },
  handler: async (ctx, input): Promise<{ id: Id<"apiKeys">; name: string; key: string }> => {
    const key = newKey();
    const id: Id<"apiKeys"> = await ctx.runMutation(internal.apiKeys.insert, {
      ...input,
      hash: await hashKey(key),
    });
    return { id, name: input.name.trim(), key };
  },
});

export const insert = internalMutation({
  args: { ...identityArgs, name: v.string(), hash: v.string() },
  handler: async (ctx, { userId, actor, name, hash }) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME) fail("invalid_argument", `name must be 1 to ${MAX_NAME} characters`);
    const id = await ctx.db.insert("apiKeys", { userId, name: trimmed, hash, createdAt: Date.now() });
    await recordEvent(ctx, { userId, actor }, { action: "apiKey.create", after: { keyId: id, name: trimmed } });
    return id;
  },
});

/** Domain operation revokeApiKey: the key stops working on the next request. */
export const revoke = internalMutation({
  args: { ...identityArgs, ...args.revokeApiKey },
  handler: async (ctx, { userId, actor, keyId }) => {
    const key = await ctx.db.get(keyId);
    if (!key || key.userId !== userId) fail("not_found", `API key ${keyId} not found`);
    if (key.revokedAt !== undefined) return { id: key._id, revokedAt: key.revokedAt };
    const revokedAt = Date.now();
    await ctx.db.patch(key._id, { revokedAt });
    await recordEvent(ctx, { userId, actor }, { action: "apiKey.revoke", after: { keyId, name: key.name } });
    return { id: key._id, revokedAt };
  },
});

/** Key metadata for the settings screen; never the hash. */
export async function listKeys(ctx: QueryCtx, userId: string) {
  const keys = await ctx.db
    .query("apiKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return keys.map((k) => ({ id: k._id, name: k.name, createdAt: k.createdAt, revokedAt: k.revokedAt ?? null }));
}

export const list = internalQuery({
  args: identityArgs,
  handler: (ctx, { userId }) => listKeys(ctx, userId),
});

/** Resolves the owner of an active key from its hash; null when unknown or revoked. */
export const verify = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!key || key.revokedAt !== undefined) return null;
    return { userId: key.userId, keyId: key._id, name: key.name };
  },
});
