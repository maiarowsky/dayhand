// Account routes of the REST API (docs/api.md#api-keys): API keys made with a
// full key. Each handler only calls the domain function with the caller's
// identity; rest.ts has already checked the key's scope and limit.
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { CreatedKey } from "./apiKeys";
import type { RestHandler } from "./rest";

export const ACCOUNT_HANDLERS: Record<string, RestHandler> = {
  listKeys: async (ctx, { identity }) => ({ body: { keys: await ctx.runQuery(internal.apiKeys.list, identity) } }),

  // A key made with a key reads unless asked to write; it can never be full (apiKeys.insert).
  createKey: async (ctx, { identity, body }) => {
    const created: CreatedKey = await ctx.runAction(internal.apiKeys.create, { scope: "read", ...body, ...identity } as never);
    return { status: 201, body: created };
  },

  revokeKey: async (ctx, { identity, params }) => ({
    body: await ctx.runMutation(internal.apiKeys.revoke, { ...identity, keyId: params.keyId as Id<"apiKeys"> }),
  }),
};
