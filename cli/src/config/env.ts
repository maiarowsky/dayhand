// Environment variables. New names are HLM_*; the HELM_* names of the old
// `helm` CLI still work for the URL and the key, with a deprecation warning.
import { usageError } from "../core/exit.js";

export type Env = Readonly<Record<string, string | undefined>>;
export type Warning = { code: string; message: string };

/** Old name → new name; read only when the new name is unset. */
const DEPRECATED: Record<string, string> = {
  HLM_URL: "HELM_URL",
  HLM_API_KEY: "HELM_API_KEY",
};

export type EnvValue = { value?: string; warning?: Warning };

/** Reads HLM_<name>, falling back to the deprecated HELM_<name>. Empty strings count as unset. */
export function readEnv(env: Env, name: string): EnvValue {
  const value = env[name];
  if (value) return { value };
  const old = DEPRECATED[name];
  if (old && env[old]) {
    return {
      value: env[old],
      warning: { code: "deprecated_env", message: `${old} is deprecated; set ${name} instead` },
    };
  }
  return {};
}

const TRUE = new Set(["1", "true", "yes", "on"]);

export function envFlag(env: Env, name: string): boolean {
  return TRUE.has((env[name] ?? "").trim().toLowerCase());
}

export type Format = "human" | "plain" | "json";
const FORMATS: Format[] = ["human", "plain", "json"];

/** HLM_FORMAT=json|plain|human; anything else is a usage error rather than a silent default. */
export function envFormat(env: Env): Format | undefined {
  const raw = env.HLM_FORMAT?.trim().toLowerCase();
  if (!raw) return undefined;
  if ((FORMATS as string[]).includes(raw)) return raw as Format;
  throw usageError(`HLM_FORMAT must be one of ${FORMATS.join(", ")}`, { valid: FORMATS });
}
