// Signing in: `dayhand login` checks an API key against the server and stores it
// for the deployment URL in the OS keychain (or a 0600 file when there is
// none); `dayhand logout` removes it; `dayhand whoami` says what dayhand would use.
// The key is typed at a hidden prompt or piped on stdin, never a flag, and
// it never appears in any output.
import { saveProfileUrl } from "../config/file.js";
import { displayUrl, normalizeUrl } from "../config/url.js";
import { CliError, usageError } from "../core/exit.js";
import { readStdin } from "../core/io.js";
import { StoreUnavailable, type KeyStore } from "../credentials/store.js";
import { STORE_CHOICES } from "../credentials/index.js";
import type { CommandSpec, Opts, RunContext } from "./types.js";

const KEY = /^[\x21-\x7e]{8,512}$/;

export const PROFILE = /^[A-Za-z0-9_-]{1,64}$/;

/** The URL to sign in to: --url, DAYHAND_URL, config.toml, or asked for on a terminal. */
async function loginTarget(ctx: RunContext): Promise<{ url: string; urlSource: string; profile?: string }> {
  if (ctx.flags.url) return { url: normalizeUrl(ctx.flags.url), urlSource: "--url" };
  try {
    return ctx.target();
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== "usage" || !ctx.interactive) throw error;
    const typed = (await ctx.prompt("Dayhand URL (https://<deployment>.convex.site): ")).trim();
    return { url: normalizeUrl(typed), urlSource: "prompt" };
  }
}

async function readKey(ctx: RunContext, opts: Opts): Promise<string> {
  let key: string;
  if (opts.withKey) key = (await readStdin(ctx.io.stdin)).split(/\r?\n/)[0] ?? "";
  else if (ctx.interactive) key = await ctx.prompt("API key (input hidden): ", true);
  else throw usageError("No terminal to type the key into: pipe it with --with-key", { hint: "dayhand login --with-key < key-file" });
  key = key.trim();
  if (!KEY.test(key)) throw usageError("That does not look like an API key (expected one word, e.g. dayhand_…)");
  return key;
}

/** --store, else the first store that accepts the key; the keychain is preferred. Also used by dayhand server. */
export async function storeKey(ctx: RunContext, url: string, key: string, choice: unknown): Promise<KeyStore> {
  const stores = ctx.keyStores().filter((s) => choice === undefined || s.name === choice);
  if (stores.length === 0) throw usageError(`--store ${String(choice)} is not allowed by DAYHAND_CREDENTIAL_STORE`);
  const reasons: string[] = [];
  for (const candidate of stores) {
    try {
      await candidate.set(url, key);
      if (reasons.length) {
        ctx.out.warn({ code: "keychain_unavailable", message: `${reasons.join("; ")}; the key is stored in ${candidate.location} (readable only by you)` });
      }
      return candidate;
    } catch (error) {
      if (!(error instanceof StoreUnavailable)) throw error;
      reasons.push(error.message);
    }
  }
  throw new CliError("internal", `Cannot store the key: ${reasons.join("; ")}`, { hint: "DAYHAND_CREDENTIAL_STORE=file dayhand login" });
}

const login: CommandSpec = {
  name: "login",
  schema: "login.schema.json",
  summary: "Store an API key for the deployment in the OS keychain (or a private file)",
  description:
    "Create a key with kind cli in the app (Settings → API keys) or with `npx convex run apiKeys:create`. " +
    "The key is checked against the server first; DAYHAND_API_KEY, when set, still wins over the stored key.",
  options: [
    { flags: "--with-key", description: "Read the key from stdin instead of a hidden prompt" },
    { flags: "--store <store>", description: "Where to keep the key (default: keychain, else file)", choices: STORE_CHOICES },
  ],
  tools: ["get_settings"],
  dryRun: false,
  examples: ["dayhand login --url https://<deployment>.convex.site", "dayhand login --with-key < ~/dayhand-key.txt", "dayhand --profile work login"],
  run: async (ctx, _args, opts) => {
    const target = await loginTarget(ctx);
    const key = await readKey(ctx, opts);
    const settings = (await ctx.clientFor(target.url, key).callTool("get_settings")).structured as { timezone?: string };
    const used = await storeKey(ctx, target.url, key, opts.store);
    // A URL given on the command line or at the prompt is remembered in config.toml.
    const config = ctx.config();
    const profile = ctx.flags.profile ?? target.profile ?? config.defaultProfile ?? "default";
    if (!PROFILE.test(profile)) throw usageError("Profile names use letters, digits, - and _");
    const remember = target.urlSource === "--url" || target.urlSource === "prompt";
    const configChange = remember ? saveProfileUrl(config, profile, target.url) : "unchanged";
    if (ctx.env.DAYHAND_API_KEY) ctx.out.warn({ code: "env_key_wins", message: "DAYHAND_API_KEY is set and is used instead of the stored key" });
    const value = { url: target.url, store: used.name, location: used.location, profile: remember ? profile : (target.profile ?? null), config: configChange, timezone: settings.timezone ?? null };
    const lines = [`Signed in to ${displayUrl(target.url)}; the key is in ${used.location}`];
    if (configChange !== "unchanged") lines.push(`Saved the URL as profile ${profile} in ${config.file}`);
    return { value, view: { kind: "text", text: lines.join("\n") } };
  },
};

const logout: CommandSpec = {
  name: "logout",
  schema: "logout.schema.json",
  summary: "Remove the stored API key for the deployment (keychain and file)",
  tools: [],
  dryRun: false,
  examples: ["dayhand logout", "dayhand --profile work logout --json"],
  run: async (ctx) => {
    const target = ctx.target();
    const removed: string[] = [];
    const problems: string[] = [];
    for (const candidate of ctx.keyStores()) {
      try {
        if (await candidate.delete(target.url)) removed.push(candidate.name);
      } catch (error) {
        if (!(error instanceof StoreUnavailable)) throw error;
        problems.push(error.message);
      }
    }
    if (ctx.env.DAYHAND_API_KEY) ctx.out.warn({ code: "env_key_wins", message: "DAYHAND_API_KEY is still set in the environment" });
    const where = displayUrl(target.url);
    const text = removed.length ? `Signed out of ${where} (removed from: ${removed.join(", ")})` : `No stored key for ${where}`;
    if (!removed.length && problems.length) throw new CliError("internal", `Cannot reach the key store: ${problems.join("; ")}`);
    return { value: { url: target.url, removed }, view: { kind: "text", text } };
  },
};

const whoami: CommandSpec = {
  name: "whoami",
  schema: "whoami.schema.json",
  summary: "Which deployment, profile, key source and config file dayhand uses, checked against the server",
  tools: ["initialize", "get_settings"],
  examples: ["dayhand whoami", "dayhand whoami --json"],
  run: async (ctx) => {
    const client = await ctx.client();
    const connection = client.connection;
    const [server, settings] = await Promise.all([client.initialize(), client.callTool("get_settings")]);
    const config = ctx.config();
    const value = {
      url: connection.url,
      urlSource: connection.urlSource,
      profile: connection.profile ?? null,
      keySource: connection.keySource ?? "unknown",
      configFile: config.file,
      configFound: config.exists,
      server,
      timezone: (settings.structured as { timezone?: string } | undefined)?.timezone ?? null,
    };
    const rows: [string, unknown][] = [
      ["url", `${displayUrl(value.url)} (from ${value.urlSource})`],
      ["profile", value.profile ?? "-"],
      ["key", `from ${KEY_SOURCES[value.keySource] ?? value.keySource}`],
      ["config", `${value.configFile}${value.configFound ? "" : " (not found)"}`],
      ["server", `${server.name} ${server.version}`],
      ["timezone", value.timezone ?? "-"],
    ];
    return { value, view: { kind: "pairs", pairs: rows } };
  },
};

const KEY_SOURCES: Record<string, string> = {
  DAYHAND_API_KEY: "DAYHAND_API_KEY",
  HLM_API_KEY: "HLM_API_KEY (deprecated)",
  HELM_API_KEY: "HELM_API_KEY (deprecated)",
  keychain: "the OS keychain (dayhand login)",
  file: "the credentials file (dayhand login)",
};

export const authCommands: CommandSpec[] = [login, logout, whoami];
