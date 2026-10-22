// Connection settings in precedence order: flag > environment > (batch 2:
// profile in config.toml) > none. Secrets never come from flags.
import { CliError, usageError } from "../core/exit.js";
import { EnvCredentialStore, findCredential, type CredentialStore } from "../credentials/store.js";
import { readEnv, type Env, type Warning } from "./env.js";

export type Connection = { url: string; key: string };

/** Deployment HTTP actions URL without a trailing slash or /mcp. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usageError("The Helm URL is not a valid URL (expected e.g. https://<deployment>.convex.site)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError("The Helm URL must start with https:// or http://");
  }
  return raw.replace(/\/+$/, "").replace(/\/mcp$/, "");
}

/** The URL for messages: no user info, no query. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return "the Helm URL";
  }
}

export async function resolveConnection(
  flags: { url?: string },
  env: Env,
  warn: (warning: Warning) => void,
  stores: CredentialStore[] = [new EnvCredentialStore(env, warn)],
): Promise<Connection> {
  let raw = flags.url;
  if (!raw) {
    const fromEnv = readEnv(env, "HLM_URL");
    if (fromEnv.warning) warn(fromEnv.warning);
    raw = fromEnv.value;
  }
  if (!raw) {
    throw usageError("HLM_URL is not set (the deployment HTTP actions URL, e.g. https://<deployment>.convex.site)", {
      hint: "export HLM_URL=<url>",
    });
  }
  const url = normalizeUrl(raw);
  const credential = await findCredential(stores, url);
  if (!credential) {
    throw new CliError("unauthenticated", "HLM_API_KEY is not set", {
      hint: "Create an API key with kind cli in the app (or apiKeys:create) and export HLM_API_KEY",
    });
  }
  return { url, key: credential.key };
}
