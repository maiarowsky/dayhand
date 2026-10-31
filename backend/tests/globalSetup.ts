// Starts one Convex local backend for the whole test run, deploys the
// functions with a freshly generated app-signing key, and stops it after.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { generateSigningKey } from "../scripts/jwt.mjs";
import { deployFunctions, newInstanceSecret, startLocalBackend } from "../scripts/local-backend-lib.mjs";

export const ISSUER = "https://helm.test";

/** Path of the test client's metadata document on the local CIMD server. */
export const CIMD_PATH = "/oauth/test-client.json";
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/**
 * Serves Client ID Metadata Documents for the OAuth tests, as Anthropic serves Claude's. The
 * deployment accepts this origin only because the test sets DAYHAND_OAUTH_CIMD_ORIGINS.
 */
async function startCimdServer(port: number): Promise<Server> {
  const origin = `http://127.0.0.1:${port}`;
  const documents: Record<string, unknown> = {
    [CIMD_PATH]: {
      client_id: `${origin}${CIMD_PATH}`,
      client_name: "Claude (test)",
      redirect_uris: [CLAUDE_CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    "/oauth/other-id.json": { client_id: `${origin}/oauth/somebody-else.json`, redirect_uris: [CLAUDE_CALLBACK] },
    "/oauth/evil-redirect.json": { client_id: `${origin}/oauth/evil-redirect.json`, redirect_uris: ["https://evil.example/cb"] },
    "/oauth/with-secret.json": {
      client_id: `${origin}/oauth/with-secret.json`,
      redirect_uris: [CLAUDE_CALLBACK],
      token_endpoint_auth_method: "client_secret_basic",
    },
  };
  const fetches = new Map<string, number>();
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/fetch-count") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fetches.get(url.searchParams.get("path") ?? "") ?? 0));
      return;
    }
    fetches.set(url.pathname, (fetches.get(url.pathname) ?? 0) + 1);
    if (request.url === "/oauth/redirect.json") {
      response.writeHead(302, { Location: `${origin}${CIMD_PATH}` }).end();
      return;
    }
    if (request.url === "/oauth/huge.json") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ pad: "x".repeat(64 * 1024) }));
      return;
    }
    const document = documents[request.url ?? ""];
    if (!document) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(document));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

/**
 * A webhook receiver for the webhook tests. POST /hook/<id>/<behaviour> answers by behaviour:
 * ok (200), fail-<n> (500 for the first n requests of that id, then 200), down (always 500),
 * redirect (302 to .../ok). GET /received/<id> returns what each <id> got, oldest first.
 */
async function startWebhookReceiver(port: number): Promise<Server> {
  const received = new Map<string, { path: string; headers: Record<string, string>; body: string }[]>();
  const server = createHttpServer((request, response) => {
    const url = request.url ?? "";
    const read = /^\/received\/([\w-]+)$/.exec(url);
    if (request.method === "GET" && read) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(received.get(read[1]!) ?? []));
      return;
    }
    const hook = /^\/hook\/([\w-]+)\/([\w-]+)$/.exec(url);
    if (request.method !== "POST" || !hook) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const [, id, behaviour] = hook as unknown as [string, string, string];
      const list = received.get(id) ?? [];
      const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, String(v)]));
      list.push({ path: url, headers, body });
      received.set(id, list);
      const failFirst = /^fail-(\d+)$/.exec(behaviour);
      if (behaviour === "redirect") response.writeHead(302, { Location: `/hook/${id}/ok` }).end();
      else if (behaviour === "down" || (failFirst && list.length <= Number(failFirst[1]))) response.writeHead(500).end("broken");
      else response.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * The deployment's variables under their DAYHAND_* names, or with DAYHAND_TEST_OLD_ENV=1 under the
 * HELM_* names of a deployment from before the rename, so the whole suite can check that those still work.
 */
function deploymentEnv(values: Record<string, string>): Record<string, string> {
  const prefix = process.env.DAYHAND_TEST_OLD_ENV === "1" ? "HELM_" : "DAYHAND_";
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [prefix + name, value]));
}

export default async function setup(project: TestProject) {
  const workDir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "helm-test-"));
  const cimdPort = await freePort();
  const cimd = await startCimdServer(cimdPort);
  const cimdOrigin = `http://127.0.0.1:${cimdPort}`;
  const receiverPort = await freePort();
  const receiver = await startWebhookReceiver(receiverPort);
  const webhookOrigin = `http://127.0.0.1:${receiverPort}`;
  const backend = await startLocalBackend({
    dataDir: join(workDir, "data"),
    port: await freePort(),
    sitePort: await freePort(),
    instanceName: "helm-test",
    instanceSecret: newInstanceSecret(),
  });
  try {
    const signing = await generateSigningKey();
    await deployFunctions({
      url: backend.url,
      adminKey: backend.adminKey,
      home: join(workDir, "home"),
      envVars: deploymentEnv({
        JWT_ISSUER: ISSUER,
        JWKS: signing.jwksDataUri,
        JWT_PRIVATE_JWK: JSON.stringify(signing.privateJwk),
        OAUTH_CIMD_ORIGINS: `https://claude.ai,${cimdOrigin}`,
        WEBHOOK_ALLOWED_ORIGINS: webhookOrigin,
        WEBHOOK_RETRY_DELAYS: "0.3,0.3,0.3",
      }),
    });
    project.provide("helm", {
      url: backend.url,
      siteUrl: backend.siteUrl,
      adminKey: backend.adminKey,
      issuer: ISSUER,
      privateJwk: signing.privateJwk,
      cimdOrigin,
      webhookOrigin,
    });
  } catch (error) {
    cimd.close();
    receiver.close();
    await backend.stop();
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    cimd.close();
    receiver.close();
    await backend.stop();
    rmSync(workDir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    helm: {
      url: string;
      siteUrl: string;
      adminKey: string;
      issuer: string;
      privateJwk: JsonWebKey & { kid: string };
      /** Origin of the local Client ID Metadata Document server. */
      cimdOrigin: string;
      /** Origin of the local webhook receiver (exempt from the HTTPS rule by DAYHAND_WEBHOOK_ALLOWED_ORIGINS). */
      webhookOrigin: string;
    };
  }
}
