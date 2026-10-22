// Starts one Convex local backend for the whole test run, deploys the
// functions with a freshly generated app-signing key, and stops it after.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { generateSigningKey } from "../scripts/jwt.mjs";
import { deployFunctions, newInstanceSecret, startLocalBackend } from "../scripts/local-backend-lib.mjs";

export const ISSUER = "https://helm.test";

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
      envVars: { HELM_JWT_ISSUER: ISSUER, HELM_JWKS: signing.jwksDataUri },
    });
    project.provide("helm", {
      url: backend.url,
      siteUrl: backend.siteUrl,
      adminKey: backend.adminKey,
      issuer: ISSUER,
      privateJwk: signing.privateJwk,
    });
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
    helm: {
      url: string;
      siteUrl: string;
      adminKey: string;
      issuer: string;
      privateJwk: JsonWebKey & { kid: string };
    };
  }
}
