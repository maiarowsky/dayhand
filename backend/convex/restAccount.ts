// Account routes of the REST API (docs/api.md#api-keys, docs/webhooks.md): API
// keys made with a full key, webhooks, and import (restImport.ts). Each handler only calls the domain
// function with the caller's identity; rest.ts has already checked the key's
// scope and limit.
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { CreatedKey } from "./apiKeys";
import type { CreatedWebhook } from "./webhooks";
import type { RestHandler } from "./rest";
import { importPlan } from "./restImport";

const webhookId = (params: Record<string, string>) => params.webhookId as Id<"webhooks">;

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

  listWebhooks: async (ctx, { identity }) => ({ body: { webhooks: await ctx.runQuery(internal.webhooks.list, identity) } }),

  createWebhook: async (ctx, { identity, body }) => {
    const created: CreatedWebhook = await ctx.runAction(internal.webhooks.create, { ...body, ...identity } as never);
    return { status: 201, body: created };
  },

  getWebhook: async (ctx, { identity, params }) => ({
    body: { webhook: await ctx.runQuery(internal.webhooks.get, { ...identity, webhookId: webhookId(params) }) },
  }),

  deleteWebhook: async (ctx, { identity, params }) => ({
    body: await ctx.runMutation(internal.webhooks.remove, { ...identity, webhookId: webhookId(params) }),
  }),

  testWebhook: async (ctx, { identity, params }) => ({
    status: 202,
    body: await ctx.runMutation(internal.webhooks.test, { ...identity, webhookId: webhookId(params) }),
  }),

  enableWebhook: async (ctx, { identity, params }) => ({
    body: { webhook: await ctx.runMutation(internal.webhooks.enable, { ...identity, webhookId: webhookId(params) }) },
  }),

  listDeliveries: async (ctx, { identity, params, query }) => ({
    body: { deliveries: await ctx.runQuery(internal.webhooks.deliveries, { ...identity, webhookId: webhookId(params), ...query }) },
  }),

  importPlan,
};
