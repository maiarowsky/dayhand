// What `npm run setup` (scripts/setup.mjs) runs: the Convex CLI from
// backend/node_modules (started with node itself, no shell, so it works the
// same on Windows) and the HTTP checks of the finished server. Secrets go to
// the CLI on stdin, never as arguments, and its output is shown only with
// the secrets hidden.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_DIR } from "./local-backend-lib.mjs";
import { redact, stripAnsi } from "./setup-lib.mjs";

export const CONVEX_MAIN = join(BACKEND_DIR, "node_modules", "convex", "bin", "main.js");
export const hasConvexCli = () => existsSync(CONVEX_MAIN);

/** The deployment's own view of its URLs, read with an inline query (no code needs to be deployed). */
const URLS_QUERY = "({ cloud: process.env.CONVEX_CLOUD_URL, site: process.env.CONVEX_SITE_URL })";

/**
 * Arguments of every Convex CLI call. `target` selects the deployment: ["--env-file", <file>]
 * (the server's convex.env) or ["--deployment", <team:project:prod>] before that file exists.
 */
export const commands = {
  login: () => ["login"],
  loginStatus: () => ["login", "status"],
  projectCreate: (name, team) => ["project", "create", name, "--team", team],
  deploymentCreate: (team, project) => ["deployment", "create", `${team}:${project}:production`, "--type", "prod", "--default"],
  urls: (target) => ["run", "--inline-query", URLS_QUERY, ...target],
  envNames: (target) => ["env", "list", "--names-only", ...target],
  envGet: (target, name) => ["env", "get", name, ...target],
  /** The value goes on stdin. */
  envSet: (target, name) => ["env", "set", name, ...target],
  deploy: (envFile) => ["deploy", "--yes", "--typecheck", "disable", "--codegen", "enable", "--env-file", envFile],
  run: (target, fn, args) => ["run", fn, JSON.stringify(args), ...target],
};

// Variables that would point the CLI at another deployment than the one asked for: set to
// empty, so neither the shell nor backend/.env.local (written by backend:start) can win.
const TARGET_VARS = ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"];

export function childEnv(base = process.env, overrides = {}) {
  const env = { ...base, ...overrides };
  for (const name of TARGET_VARS) env[name] = "";
  return env;
}

export class ConvexCliError extends Error {}

/**
 * Runs `convex <args>` in backend/.
 *   interactive: the user sees it and can answer (login in the browser)
 *   show: output is shown as it comes, nothing is read back
 *   otherwise output is captured and returned, and shown only on failure
 * Output always goes to stderr, so `--json` keeps stdout for its result.
 */
export function convex(args, { input, interactive = false, show = false, secrets = [], env = childEnv() } = {}) {
  const capture = !interactive && !show;
  const stdio = [interactive ? "inherit" : input === undefined ? "ignore" : "pipe", capture ? "pipe" : 2, capture ? "pipe" : "inherit"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CONVEX_MAIN, ...args], { cwd: BACKEND_DIR, env, stdio, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(new ConvexCliError(`Cannot start the Convex CLI: ${error.message}`, { cause: error })));
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const said = redact(stripAnsi(`${stderr}\n${stdout}`).trim(), secrets);
      reject(new ConvexCliError(`npx convex ${args[0]} ${args[1] ?? ""} failed (exit ${code})${said ? `:\n${said}` : ""}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** stdout of `convex run` as JSON. */
export function parseRunOutput(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Unexpected answer from ${what}: not JSON`, { cause: error });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(check, { attempts = 15, delayMs = 2000 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await check();
    } catch (error) {
      if (error.final) throw error;
      last = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw last;
}

/** GET /api/v1/openapi.json answers with the OpenAPI description (public). */
export function checkOpenApi(siteUrl, { fetchImpl = fetch, ...timing } = {}) {
  return retry(async () => {
    const response = await fetchImpl(`${siteUrl}/api/v1/openapi.json`, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || typeof body?.openapi !== "string") {
      throw new Error(`${siteUrl}/api/v1/openapi.json answered HTTP ${response.status} without an OpenAPI description`);
    }
    return body.openapi;
  }, timing);
}

/** POST /auth/token with a bogus device token: 401 when the server can sign app tokens, 503 when not. */
export function checkSigning(siteUrl, { fetchImpl = fetch, ...timing } = {}) {
  return retry(async () => {
    const response = await fetchImpl(`${siteUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceToken: "helmdev_x.y" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return true;
    if (response.status === 503) {
      const error = new Error(
        "The server cannot sign app tokens (503 not_configured): DAYHAND_JWT_PRIVATE_JWK is missing or does not match DAYHAND_JWKS. " +
          "See docs/deploy.md, “Moving an existing key from disk into the deployment”.",
      );
      error.final = true;
      throw error;
    }
    throw new Error(`${siteUrl}/auth/token answered HTTP ${response.status}`);
  }, timing);
}

/** POST /mcp initialize with the API key: the server's name and version. */
export function checkMcp(siteUrl, key, { fetchImpl = fetch, ...timing } = {}) {
  return retry(async () => {
    const response = await fetchImpl(`${siteUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "dayhand-setup", version: "1" } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) {
      const error = new Error("The API key was rejected");
      error.status = 401;
      error.final = true;
      throw error;
    }
    const body = await response.json().catch(() => null);
    const info = body?.result?.serverInfo;
    if (response.status !== 200 || info?.name !== "dayhand") throw new Error(`${siteUrl}/mcp answered HTTP ${response.status} without Dayhand's serverInfo`);
    return info;
  }, timing);
}
