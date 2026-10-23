import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { inject } from "vitest";
import { internal } from "../convex/_generated/api";
import { signAppToken } from "../scripts/jwt.mjs";
import { convexCliEnv, runConvexCli } from "../scripts/local-backend-lib.mjs";

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

export async function createKey(userId: string, name = "test", kind?: "cli" | "agent"): Promise<string> {
  const created = (await admin().action(internal.apiKeys.create, { userId, actor: "app", name, kind })) as {
    key: string;
  };
  return created.key;
}

/** Writes rows straight into a table with `convex import`, as data from an older version would be. */
export async function importRows(table: string, rows: Record<string, unknown>[]) {
  const dir = mkdtempSync(join(process.env.HELM_TEST_TMPDIR ?? tmpdir(), "helm-import-"));
  try {
    const file = join(dir, `${table}.jsonl`);
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const env = convexCliEnv({ url: helm().url, adminKey: helm().adminKey, home: join(dir, "home") });
    await runConvexCli(["import", "--table", table, "--append", "--yes", file], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

/** One raw JSON-RPC POST to /mcp with the key (or none) and extra headers. */
export const mcpPost = (key: string | null, body: unknown, headers: Record<string, string> = {}) =>
  fetch(mcpUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

export const MODERN = "2026-07-28";

/**
 * A 2026-07-28 request as the specification writes it: the protocol version
 * and client capabilities in params._meta, mirrored in the standard headers.
 */
export function modern(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  const name = (params.name ?? params.uri) as string | undefined;
  return {
    body: {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "helm-tests", version: "0" },
        },
      },
    },
    headers: {
      "MCP-Protocol-Version": MODERN,
      "Mcp-Method": method,
      ...(name !== undefined && ["tools/call", "resources/read", "prompts/get"].includes(method) ? { "Mcp-Name": name } : {}),
    } as Record<string, string>,
  };
}

export type RestAnswer = { status: number; headers: Headers; body: any };

/** One request to the REST API /api/v1 with the key (or none); a JSON body when given. */
export async function rest(
  key: string | null,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<RestAnswer> {
  const response = await fetch(`${helm().siteUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    // not JSON: kept as text
  }
  return { status: response.status, headers: response.headers, body };
}
