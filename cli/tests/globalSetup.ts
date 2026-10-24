// Starts one real Convex local backend for the test run with the backend's
// own scripts (backend/ needs `npm ci --ignore-scripts`), deploys the
// functions, and stops it after. The CLI is tested as the built binary.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { generateSigningKey } from "../../backend/scripts/jwt.mjs";
import { deployFunctions, newInstanceSecret, startLocalBackend } from "../../backend/scripts/local-backend-lib.mjs";

export const ISSUER = "https://helm.test";

export function freePort(): Promise<number> {
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
  if (!existsSync(new URL("../dist/bin/dayhand.js", import.meta.url))) throw new Error("Build first: npm run build");
  if (!existsSync(new URL("../../backend/node_modules/.bin/convex", import.meta.url))) {
    throw new Error("Install the backend first: (cd backend && npm ci --ignore-scripts)");
  }
  const workDir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-test-"));
  const backend = await startLocalBackend({
    dataDir: join(workDir, "data"),
    port: await freePort(),
    sitePort: await freePort(),
    instanceName: "dayhand-test",
    instanceSecret: newInstanceSecret(),
  });
  try {
    const signing = await generateSigningKey();
    await deployFunctions({
      url: backend.url,
      adminKey: backend.adminKey,
      home: join(workDir, "home"),
      envVars: {
        DAYHAND_JWT_ISSUER: ISSUER,
        DAYHAND_JWKS: signing.jwksDataUri,
        DAYHAND_JWT_PRIVATE_JWK: JSON.stringify(signing.privateJwk),
      },
    });
    project.provide("helm", { url: backend.url, siteUrl: backend.siteUrl, adminKey: backend.adminKey, issuer: ISSUER });
  } catch (error) {
    await backend.stop();
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    await backend.stop();
    rmSync(workDir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    helm: { url: string; siteUrl: string; adminKey: string; issuer: string };
  }
}
