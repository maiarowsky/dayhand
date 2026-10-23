import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, inject } from "vitest";

export const helm = () => inject("helm");

const BIN = fileURLToPath(new URL("../dist/bin/hlm.js", import.meta.url));
const SCHEMAS = new URL("../../docs/schemas/", import.meta.url);

export type Run = { code: number; stdout: string; stderr: string };

/**
 * Config, cache and stored keys of the test runs live in a private folder, and
 * keys go to a file: tests never touch the real keychain or ~/.config.
 */
export const TEST_HOME = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-home-"));
afterAll(() => rmSync(TEST_HOME, { recursive: true, force: true }));
const isolated = (dir = TEST_HOME) => ({
  HLM_CONFIG_DIR: join(dir, "config"),
  HLM_CACHE_DIR: join(dir, "cache"),
  HLM_CREDENTIAL_STORE: "file",
  HOME: dir,
  USERPROFILE: dir,
  APPDATA: dir,
  LOCALAPPDATA: dir,
});

/**
 * Runs the built `hlm` with only the given environment. stdin is a pipe (no
 * TTY), closed after `input`; a run that waits for input fails on the timeout.
 */
export function hlm(key: string | undefined, args: string[], options: { env?: Record<string, string>; input?: string; url?: string } = {}): Promise<Run> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    ...isolated(),
    HLM_URL: options.url ?? helm().siteUrl,
    ...(key ? { HLM_API_KEY: key } : {}),
    ...options.env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hlm ${args.join(" ")} did not finish (waiting for input?)`));
    }, 20_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

/** Runs hlm with --json and parses stdout; fails the test on a non-zero exit. */
export async function hlmJson<T = any>(key: string, args: string[]): Promise<T> {
  const run = await hlm(key, [...args, "--json"]);
  if (run.code !== 0) throw new Error(`hlm ${args.join(" ")} exited ${run.code}: ${run.stderr}`);
  return JSON.parse(run.stdout) as T;
}

/** The parsed {"error":…} line of a failed --json run. */
export const jsonError = (run: Run) => JSON.parse(run.stderr.trim().split("\n").at(-1)!).error;

/** Runs an internal Convex function with the admin key (the HTTP API `npx convex run` uses). */
export async function admin<T = any>(kind: "query" | "mutation" | "action", path: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${helm().url}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Convex ${helm().adminKey}` },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const body = (await response.json()) as { status: string; value: unknown };
  if (body.status !== "success") throw new Error(`${path} failed: ${JSON.stringify(body)}`);
  return body.value as T;
}

/** A user the app can sign in as (issuer|subject), so pairing works too. */
export const newUserId = () => `${helm().issuer}|${randomUUID()}`;

export async function createKey(userId: string, name = "macbook", kind: "cli" | "agent" = "cli") {
  return admin<{ key: string; id: string }>("action", "apiKeys:create", { userId, actor: "app", name, kind });
}

export const revokeKey = (userId: string, keyId: string) => admin("mutation", "apiKeys:revoke", { userId, actor: "app", keyId });

/** A user with a fresh cli key. */
export async function newUser(kind: "cli" | "agent" = "cli") {
  const userId = newUserId();
  const { key, id } = await createKey(userId, kind === "cli" ? "macbook" : "claude-code", kind);
  return { userId, key, keyId: id };
}

export async function mcpClient(key: string) {
  const client = new Client({ name: "hlm-tests", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${helm().siteUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

/** structuredContent of a tool call through the official MCP SDK client. */
export async function sdkCall(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { structured: result.structuredContent, isError: Boolean(result.isError), content: result.content };
}

/** Validates against docs/schemas; several files mean "any of them". */
export function schemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const file of readdirSync(SCHEMAS).filter((f) => f.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")));
  }
  return (files: string | string[], value: unknown): string[] => {
    const errors: string[] = [];
    for (const file of [files].flat()) {
      const validate = ajv.getSchema(`https://schemas.helm.invalid/${file}`);
      if (!validate) return [`no schema ${file}`];
      if (validate(value)) return [];
      errors.push(`${file}: ${ajv.errorsText(validate.errors)}`);
    }
    return errors;
  };
}

/**
 * An agent connection made the way the Claude app makes one (docs/oauth.md): it registers
 * itself, opens the authorization page, the owner approves the page's code (here through the
 * domain function the phone uses), and the code is exchanged with PKCE.
 */
export async function connectAgent(userId: string, clientName = "Claude") {
  const site = helm().siteUrl;
  const callback = "https://claude.ai/api/mcp/auth_callback";
  const registered = await (
    await fetch(`${site}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: clientName, redirect_uris: [callback] }),
    })
  ).json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${site}/oauth/authorize`);
  Object.entries({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: callback,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "tasks:read",
  }).forEach(([k, v]) => authorize.searchParams.set(k, v));
  const page = await (await fetch(authorize)).text();
  const userCode = /<div class="code"[^>]*>([0-9A-Z-]+)<\/div>/.exec(page)![1];
  const handle = /name="request" value="([^"]+)"/.exec(page)![1];
  await admin("mutation", "oauthOwner:decide", { userId, actor: "app", code: userCode, approve: true });
  const form = { "Content-Type": "application/x-www-form-urlencoded" };
  const back = await fetch(`${site}/oauth/authorize/continue`, { method: "POST", headers: form, body: new URLSearchParams({ request: handle }), redirect: "manual" });
  const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
  const tokens = await fetch(`${site}/oauth/token`, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: registered.client_id, redirect_uri: callback }),
  });
  return (await tokens.json()) as { access_token: string; refresh_token: string };
}
