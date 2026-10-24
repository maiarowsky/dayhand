// Connection settings in precedence order. URL: --url, then the profile named
// by --profile, then DAYHAND_URL (or its old names), then the profile from DAYHAND_PROFILE or
// default_profile, then the top-level url in config.toml. Key: DAYHAND_API_KEY
// (or its old names), then the key stored by `dayhand login` for that URL.
// Secrets never come from flags or config.toml.
import { CliError, usageError } from "../core/exit.js";
import { findCredential, type CredentialStore } from "../credentials/store.js";
import { readEnv, type Env, type Warning } from "./env.js";
import type { Config } from "./file.js";
import { displayUrl, normalizeUrl } from "./url.js";

export { displayUrl, normalizeUrl };

export type Target = { url: string; urlSource: string; profile?: string };
export type Connection = Target & { key: string; keySource: string };

/** The profile in use: --profile, DAYHAND_PROFILE, then default_profile. */
export function selectProfile(flags: { profile?: string }, env: Env, config: Config): { name?: string; fromFlag: boolean } {
  const named = flags.profile ?? (env.DAYHAND_PROFILE || undefined);
  const name = named ?? config.defaultProfile;
  if (name !== undefined && !config.profiles[name]) {
    const valid = Object.keys(config.profiles);
    throw usageError(`Unknown profile${valid.length ? "" : `: ${config.file} defines none`}`, valid.length ? { valid } : { hint: "dayhand help config" });
  }
  return { name, fromFlag: flags.profile !== undefined };
}

export function resolveTarget(flags: { url?: string; profile?: string }, env: Env, config: Config, warn: (w: Warning) => void): Target {
  const profile = selectProfile(flags, env, config);
  const profileUrl = profile.name === undefined ? undefined : config.profiles[profile.name]?.url;
  const withProfile = (url: string, urlSource: string): Target => ({ url, urlSource, ...(profile.name ? { profile: profile.name } : {}) });

  if (flags.url) return withProfile(normalizeUrl(flags.url), "--url");
  if (profileUrl && profile.fromFlag) return withProfile(profileUrl, `--profile ${profile.name}`);
  const fromEnv = readEnv(env, "DAYHAND_URL");
  if (fromEnv.value) {
    if (fromEnv.warning) warn(fromEnv.warning);
    return withProfile(normalizeUrl(fromEnv.value), fromEnv.source!);
  }
  if (profileUrl) return withProfile(profileUrl, `profile ${profile.name}`);
  if (config.url) return withProfile(config.url, "config.toml");
  throw usageError("No Dayhand URL: set DAYHAND_URL, pass --url, or run dayhand login --url <url> (e.g. https://<deployment>.convex.site)", {
    hint: "dayhand login --url <url>",
  });
}

export async function resolveConnection(
  flags: { url?: string; profile?: string },
  env: Env,
  config: Config,
  warn: (warning: Warning) => void,
  stores: CredentialStore[],
): Promise<Connection> {
  const target = resolveTarget(flags, env, config, warn);
  const { credential, unavailable } = await findCredential(stores, target.url);
  if (!credential) {
    const why = unavailable.length ? ` (${unavailable.join("; ")})` : "";
    throw new CliError("unauthenticated", `Not signed in to ${displayUrl(target.url)}${why}`, {
      hint: "dayhand login, or set DAYHAND_API_KEY (an API key with kind cli)",
    });
  }
  return { ...target, key: credential.key, keySource: credential.source };
}
