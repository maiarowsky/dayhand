// Environment variables. Their names are DAYHAND_*; the HLM_* names of the
// hlm command and the HELM_* names of the older helm command are still read
// when the DAYHAND_* name is unset, with a deprecation warning.
import { usageError } from "../core/exit.js";

export type Env = Readonly<Record<string, string | undefined>>;
export type Warning = { code: string; message: string };

/** DAYHAND_<name> → the names it had before, in the order they are tried. */
const OLD_NAMES: Record<string, string[]> = {
  DAYHAND_URL: ["HLM_URL", "HELM_URL"],
  DAYHAND_API_KEY: ["HLM_API_KEY", "HELM_API_KEY"],
  DAYHAND_PROFILE: ["HLM_PROFILE"],
  DAYHAND_FORMAT: ["HLM_FORMAT"],
  DAYHAND_NO_INPUT: ["HLM_NO_INPUT"],
  DAYHAND_CONFIG_DIR: ["HLM_CONFIG_DIR"],
  DAYHAND_CACHE_DIR: ["HLM_CACHE_DIR"],
  DAYHAND_CREDENTIAL_STORE: ["HLM_CREDENTIAL_STORE"],
  DAYHAND_BACKEND_DIR: ["HELM_BACKEND_DIR"],
  DAYHAND_SERVER_CONFIG_DIR: ["HELM_SERVER_CONFIG_DIR"],
};

export type EnvValue = { value?: string; source?: string; warning?: Warning };

const deprecated = (old: string, name: string): Warning => ({ code: "deprecated_env", message: `${old} is deprecated; set ${name} instead` });

/** Where each DAYHAND_* value of a normalized environment came from, when that was an old name. */
const origins = new WeakMap<Env, Record<string, string>>();

/**
 * Reads DAYHAND_<name>, falling back to its old names. Empty strings count as unset. `source` is the
 * variable the value came from, also after normalizeEnv filled in the new name.
 */
export function readEnv(env: Env, name: string): EnvValue {
  const value = env[name];
  if (value) return { value, source: origins.get(env)?.[name] ?? name };
  for (const old of OLD_NAMES[name] ?? []) {
    if (env[old]) return { value: env[old], source: old, warning: deprecated(old, name) };
  }
  return {};
}

/**
 * The environment with every DAYHAND_* name filled in from its old name where only that is set,
 * and one warning per old name in use. The rest of the CLI reads only DAYHAND_* names.
 */
export function normalizeEnv(env: Env): { env: Env; warnings: Warning[] } {
  const filled: Record<string, string | undefined> = { ...env };
  const from: Record<string, string> = {};
  const warnings: Warning[] = [];
  for (const name of Object.keys(OLD_NAMES)) {
    const { value, source, warning } = readEnv(env, name);
    if (!warning) continue;
    filled[name] = value;
    from[name] = source!;
    warnings.push(warning);
  }
  origins.set(filled, from);
  return { env: filled, warnings };
}

const TRUE = new Set(["1", "true", "yes", "on"]);

export function envFlag(env: Env, name: string): boolean {
  return TRUE.has((readEnv(env, name).value ?? "").trim().toLowerCase());
}

export type Format = "human" | "plain" | "json";
const FORMATS: Format[] = ["human", "plain", "json"];

/** DAYHAND_FORMAT=json|plain|human; anything else is a usage error rather than a silent default. */
export function envFormat(env: Env): Format | undefined {
  const { value, source } = readEnv(env, "DAYHAND_FORMAT");
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  if ((FORMATS as string[]).includes(raw)) return raw as Format;
  throw usageError(`${source} must be one of ${FORMATS.join(", ")}`, { valid: FORMATS });
}
