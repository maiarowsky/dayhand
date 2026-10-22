// config.toml: the deployment URL, named profiles, command aliases and the
// color default. Never the API key (that is `hlm login`). Every problem is
// reported with the file and the key, and nothing in it is ever guessed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, TomlError } from "smol-toml";
import { CliError } from "../core/exit.js";
import { normalizeUrl } from "./url.js";

export type ColorMode = "auto" | "always" | "never";
export const COLOR_MODES: ColorMode[] = ["auto", "always", "never"];

export type Config = {
  file: string;
  exists: boolean;
  url?: string;
  defaultProfile?: string;
  profiles: Record<string, { url?: string }>;
  aliases: Record<string, string>;
  color?: ColorMode;
};

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ALIAS = /^[a-z][a-z0-9-]{0,63}$/;
const SECRET_KEYS = /^(api_?key|key|token|secret|password)$/i;

export const emptyConfig = (file: string): Config => ({ file, exists: false, profiles: {}, aliases: {} });

/** Reads and checks config.toml; a missing file is an empty configuration. */
export function loadConfig(file: string, commands: ReadonlySet<string>): Config {
  if (!existsSync(file)) return emptyConfig(file);
  let data: Record<string, unknown>;
  try {
    data = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TomlError) {
      // Only the first line: the rest quotes the file, which could hold something private.
      const reason = error.message.split("\n")[0]!.replace(/^Invalid TOML document: /, "");
      throw configError(file, `line ${error.line}, column ${error.column}`, `not valid TOML (${reason})`, error);
    }
    throw configError(file, "", `cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`, error);
  }
  return checkConfig(file, data, commands);
}

function checkConfig(file: string, data: Record<string, unknown>, commands: ReadonlySet<string>): Config {
  const config: Config = { ...emptyConfig(file), exists: true };
  const fail = (key: string, message: string) => configError(file, key, message);
  rejectSecrets(data, "", fail);
  for (const [key, value] of Object.entries(data)) {
    if (key === "url") config.url = urlValue(value, key, fail);
    else if (key === "default_profile") config.defaultProfile = stringValue(value, key, fail);
    else if (key === "profiles") config.profiles = profiles(value, fail);
    else if (key === "aliases") config.aliases = aliases(value, commands, fail);
    else if (key === "ui") config.color = ui(value, fail);
    else throw fail(key, "unknown key (valid: url, default_profile, profiles, aliases, ui)");
  }
  if (config.defaultProfile !== undefined && !config.profiles[config.defaultProfile]) {
    throw fail("default_profile", "names a profile that is not defined under [profiles]");
  }
  return config;
}

type Fail = (key: string, message: string) => CliError;

function rejectSecrets(table: Record<string, unknown>, prefix: string, fail: Fail) {
  for (const [key, value] of Object.entries(table)) {
    if (SECRET_KEYS.test(key)) throw fail(prefix + key, "API keys do not belong in config.toml; remove it and run hlm login");
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      rejectSecrets(value as Record<string, unknown>, `${prefix}${key}.`, fail);
    }
  }
}

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

function stringValue(value: unknown, key: string, fail: Fail): string {
  if (typeof value !== "string" || value.trim() === "") throw fail(key, "must be a non-empty string");
  return value.trim();
}

function urlValue(value: unknown, key: string, fail: Fail): string {
  const text = stringValue(value, key, fail);
  try {
    return normalizeUrl(text);
  } catch {
    throw fail(key, "must be an https:// or http:// URL, e.g. https://<deployment>.convex.site");
  }
}

function profiles(value: unknown, fail: Fail): Config["profiles"] {
  if (!isTable(value)) throw fail("profiles", "must be a table: [profiles.<name>]");
  const result: Config["profiles"] = {};
  for (const [name, profile] of Object.entries(value)) {
    const key = `profiles.${name}`;
    if (!NAME.test(name)) throw fail(key, "profile names use letters, digits, - and _");
    if (!isTable(profile)) throw fail(key, "must be a table with url = \"…\"");
    result[name] = {};
    for (const [field, fieldValue] of Object.entries(profile)) {
      if (field !== "url") throw fail(`${key}.${field}`, "unknown key (valid: url)");
      result[name].url = urlValue(fieldValue, `${key}.url`, fail);
    }
  }
  return result;
}

function aliases(value: unknown, commands: ReadonlySet<string>, fail: Fail): Config["aliases"] {
  if (!isTable(value)) throw fail("aliases", "must be a table: name = \"command and options\"");
  const result: Config["aliases"] = {};
  for (const [name, expansion] of Object.entries(value)) {
    const key = `aliases.${name}`;
    if (!ALIAS.test(name)) throw fail(key, "alias names use lower-case letters, digits and -, starting with a letter");
    if (commands.has(name)) throw fail(key, "would hide the built-in command of that name");
    result[name] = stringValue(expansion, key, fail);
  }
  return result;
}

function ui(value: unknown, fail: Fail): ColorMode | undefined {
  if (!isTable(value)) throw fail("ui", "must be a table: [ui]");
  let color: ColorMode | undefined;
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field !== "color") throw fail(`ui.${field}`, "unknown key (valid: color)");
    if (!COLOR_MODES.includes(fieldValue as ColorMode)) throw fail("ui.color", `must be one of ${COLOR_MODES.join(", ")}`);
    color = fieldValue as ColorMode;
  }
  return color;
}

function configError(file: string, key: string, message: string, cause?: unknown): CliError {
  return new CliError("config", `${file}${key ? `: ${key}` : ""}: ${message}`, { hint: "hlm help config" }, { cause });
}

/**
 * Records the URL `hlm login` used: creates config.toml with the profile, or
 * appends the profile when the file has none of that name. An existing
 * profile is never rewritten (that would lose the user's comments).
 */
export function saveProfileUrl(config: Config, profile: string, url: string): "created" | "added" | "unchanged" {
  if (config.profiles[profile]?.url === url) return "unchanged";
  if (config.profiles[profile]) return "unchanged";
  const section = `[profiles.${profile}]\nurl = ${JSON.stringify(url)}\n`;
  if (!config.exists) {
    mkdirSync(path.dirname(config.file), { recursive: true, mode: 0o700 });
    writeFileSync(config.file, `# hlm settings; see hlm help config\ndefault_profile = ${JSON.stringify(profile)}\n\n${section}`, { mode: 0o600 });
    return "created";
  }
  appendFileSync(config.file, `\n${section}`);
  return "added";
}
