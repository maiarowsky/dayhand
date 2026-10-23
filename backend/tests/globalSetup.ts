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
 * deployment accepts this origin only because the test sets HELM_OAUTH_CIMD_ORIGINS.
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
  const server = createHttpServer((request, response) => {
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

export default async function setup(project: TestProject) {
  const workDir = mkdtempSync(join(process.env.HELM_TEST_TMPDIR ?? tmpdir(), "helm-test-"));
  const cimdPort = await freePort();
  const cimd = await startCimdServer(cimdPort);
  const cimdOrigin = `http://127.0.0.1:${cimdPort}`;
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
      envVars: {
        HELM_JWT_ISSUER: ISSUER,
        HELM_JWKS: signing.jwksDataUri,
        HELM_JWT_PRIVATE_JWK: JSON.stringify(signing.privateJwk),
        HELM_OAUTH_CIMD_ORIGINS: `https://claude.ai,${cimdOrigin}`,
      },
    });
    project.provide("helm", {
      url: backend.url,
      siteUrl: backend.siteUrl,
      adminKey: backend.adminKey,
      issuer: ISSUER,
      privateJwk: signing.privateJwk,
      cimdOrigin,
    });
  } catch (error) {
    cimd.close();
    await backend.stop();
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    cimd.close();
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
    };
  }
}
