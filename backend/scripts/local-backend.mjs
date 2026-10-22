#!/usr/bin/env node
// Runs a persistent local Helm backend: the open-source Convex local backend
// binary with data in backend/.local-backend/, this project's functions
// deployed to it, and backend/.env.local pointing the Convex CLI at it.
// Stop with Ctrl+C; data and keys survive restarts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSigningKey } from "./jwt.mjs";
import { BACKEND_DIR, deployFunctions, newInstanceSecret, startLocalBackend } from "./local-backend-lib.mjs";

const STATE_DIR = join(BACKEND_DIR, ".local-backend");
const PORT = Number(process.env.HELM_PORT ?? 3210);
const SITE_PORT = Number(process.env.HELM_SITE_PORT ?? 3211);
const ISSUER = "https://helm.local";

/** Reads a private file from the state dir, creating it on first use. */
async function persisted(name, create) {
  const path = join(STATE_DIR, name);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const value = await create();
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return value;
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  const instanceSecret = await persisted("instance-secret.json", newInstanceSecret);
  const signing = await persisted("app-signing-key.json", generateSigningKey);
  const backend = await startLocalBackend({
    dataDir: join(STATE_DIR, "data"),
    port: PORT,
    sitePort: SITE_PORT,
    instanceName: "helm-local",
    instanceSecret,
  });
  const stop = async () => {
    await backend.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  writeFileSync(
    join(BACKEND_DIR, ".env.local"),
    `CONVEX_SELF_HOSTED_URL=${backend.url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${backend.adminKey}\n`,
    { mode: 0o600 },
  );
  try {
    await deployFunctions({
      url: backend.url,
      adminKey: backend.adminKey,
      envVars: {
        HELM_JWT_ISSUER: ISSUER,
        HELM_JWKS: signing.jwksDataUri,
        HELM_JWT_PRIVATE_JWK: JSON.stringify(signing.privateJwk),
      },
    });
  } catch (error) {
    console.error(error.stderr || error.message);
    await stop();
  }
  console.log(`Helm backend is running.
  Convex API:        ${backend.url}
  HTTP actions/MCP:  ${backend.siteUrl}/mcp
  Convex CLI config: backend/.env.local (admin key; keep it private)

Create a personal API key (shown once) for the app user ${ISSUER}|me:
  npx convex run apiKeys:create '{"userId":"${ISSUER}|me","actor":"app","name":"cli","kind":"cli"}'

Then:
  export HELM_URL=${backend.siteUrl} HELM_API_KEY=<key>
  npx helm today
  npx helm pair      # pairing code for the phone app (same user)

Press Ctrl+C to stop.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
