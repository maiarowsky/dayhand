#!/usr/bin/env node
// Issues an app token (ES256 JWT) for the Helm Android app, signed with a
// private key kept outside the repository. The token is printed to stdout
// only, so it can be copied once and pasted into the app's Settings.
//
//   npm run app-token                        # local backend key, subject "me"
//   npm run app-token -- --subject me --days 90
//   npm run app-token -- --generate ~/helm-signing-key.json   # new key pair for your own deployment
//
// The default key file is backend/.local-backend/app-signing-key.json, which
// `npm run backend:start` creates (git-ignored). For another deployment set
// HELM_SIGNING_KEY_FILE and HELM_JWT_ISSUER to that deployment's values.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateSigningKey, signAppToken } from "./jwt.mjs";
import { BACKEND_DIR } from "./local-backend-lib.mjs";

export const DEFAULT_KEY_FILE = join(BACKEND_DIR, ".local-backend", "app-signing-key.json");
export const DEFAULT_ISSUER = "https://helm.local";
const DEFAULT_DAYS = 90;
const MAX_DAYS = 366;
const SUBJECT_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Signs an app token with the private key in `keyFile`; returns the token and the user id it maps to. */
export async function issueAppToken({ keyFile, issuer, subject, days }) {
  if (!SUBJECT_RE.test(subject)) throw new Error("subject must be 1-64 letters, digits, dots, dashes or underscores");
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`days must be 1 to ${MAX_DAYS}`);
  if (!existsSync(keyFile)) throw new Error(`signing key not found: ${keyFile} (run npm run backend:start first)`);
  const { privateJwk } = JSON.parse(readFileSync(keyFile, "utf8"));
  if (!privateJwk?.d) throw new Error(`${keyFile} has no private key`);
  const token = await signAppToken({ privateJwk, issuer, subject, ttlSeconds: days * 24 * 60 * 60 });
  return { token, userId: `${issuer}|${subject}` };
}

/** Writes a new signing key pair to `keyFile` (mode 600) and returns the public JWKS data URI. */
export async function generateKeyFile(keyFile) {
  if (existsSync(keyFile)) throw new Error(`${keyFile} already exists; refusing to overwrite a signing key`);
  const signing = await generateSigningKey();
  writeFileSync(keyFile, JSON.stringify(signing), { mode: 0o600 });
  return signing.jwksDataUri;
}

async function main() {
  const { values } = parseArgs({
    options: {
      subject: { type: "string", default: "me" },
      days: { type: "string", default: String(DEFAULT_DAYS) },
      generate: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.error("Usage: app-token [--subject NAME] [--days N] | --generate KEY_FILE");
    return;
  }
  if (values.generate) {
    const jwks = await generateKeyFile(values.generate);
    console.error(`Private key written to ${values.generate} (keep it outside the repository).`);
    console.error("Set these on your deployment:");
    console.log(`HELM_JWKS=${jwks}`);
    return;
  }
  const issuer = process.env.HELM_JWT_ISSUER ?? DEFAULT_ISSUER;
  const keyFile = process.env.HELM_SIGNING_KEY_FILE ?? DEFAULT_KEY_FILE;
  const { token, userId } = await issueAppToken({ keyFile, issuer, subject: values.subject, days: Number(values.days) });
  console.error(`App token for user ${userId}, valid ${values.days} days. Paste it into Helm > Settings.`);
  console.error(`To let the agent and CLI see the same tasks, create the API key for the same user:`);
  console.error(`  npx convex run apiKeys:create '{"userId":"${userId}","actor":"app","name":"cli"}'`);
  console.log(token);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
