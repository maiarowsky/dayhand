import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { inject } from "vitest";
import { internal } from "../convex/_generated/api";
import { signAppToken } from "../scripts/jwt.mjs";

export const helm = () => inject("helm");

/** Fresh user id, so test files never see each other's data. */
export const newUserId = () => `test|${randomUUID()}`;

type AnyRef = FunctionReference<"query" | "mutation" | "action", "internal">;

/** Calls internal (domain) functions directly with the admin key. */
export function admin() {
  const client = new ConvexHttpClient(helm().url);
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(helm().adminKey);
  return {
    query: (ref: AnyRef, args: Record<string, unknown>) => client.query(ref as any, args),
    mutation: (ref: AnyRef, args: Record<string, unknown>) => client.mutation(ref as any, args),
    action: (ref: AnyRef, args: Record<string, unknown>) => client.action(ref as any, args),
  };
}

/** Domain calls on behalf of one user and actor. */
export function asUser(userId: string, actor: "app" | "agent" = "app") {
  const a = admin();
  return {
    query: (ref: AnyRef, args: Record<string, unknown> = {}) => a.query(ref, { userId, actor, ...args }),
    mutation: (ref: AnyRef, args: Record<string, unknown> = {}) => a.mutation(ref, { userId, actor, ...args }),
  };
}

/** A client of the public app layer signed in as `subject`; its userId is issuer|subject. */
export async function appClient(subject = randomUUID()) {
  const client = new ConvexHttpClient(helm().url);
  const { issuer, privateJwk } = helm();
  client.setAuth(await signAppToken({ privateJwk, issuer, subject }));
  return { client, userId: `${issuer}|${subject}` };
}

export async function createKey(userId: string, name = "test"): Promise<string> {
  const created = (await admin().action(internal.apiKeys.create, { userId, actor: "app", name })) as { key: string };
  return created.key;
}

export const mcpUrl = () => new URL(`${helm().siteUrl}/mcp`);

export async function mcpClient(key: string) {
  const client = new Client({ name: "helm-tests", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl(), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its parsed JSON result (throws on tool errors). */
export async function callTool<T = any>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
  if (result.isError) throw new Error(`Tool ${name} failed: ${text}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Unix ms of a UTC wall-clock time, e.g. utc("2026-10-22T23:30"). */
export const utc = (isoMinute: string) => Date.parse(`${isoMinute}:00Z`);
