// Where dayhand keeps its files, following each system's convention:
//   Linux and others  $XDG_CONFIG_HOME/dayhand (~/.config/dayhand), cache $XDG_CACHE_HOME/dayhand (~/.cache/dayhand)
//   macOS             ~/Library/Application Support/dayhand, cache ~/Library/Caches/dayhand
//   Windows           %APPDATA%\dayhand, cache %LOCALAPPDATA%\dayhand\Cache
// DAYHAND_CONFIG_DIR and DAYHAND_CACHE_DIR override both (tests, portable setups).
// Data that dayhand builds and keeps (the copy of the packaged server backend, resolveDataDir):
//   Linux and others  $XDG_DATA_HOME/dayhand-data (~/.local/share/dayhand-data)
//   macOS             ~/Library/Application Support/dayhand-data
//   Windows           %LOCALAPPDATA%\dayhand-data\Data
// The config folder of the hlm command (the same places, named hlm) is used
// while there is no dayhand folder, with a warning that says how to move it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readEnv, type Env, type Warning } from "./env.js";

export type Platform = NodeJS.Platform;

export type Paths = { configDir: string; cacheDir: string; configFile: string; warning?: Warning };

const NAME = "dayhand";
const DATA_NAME = `${NAME}-data`;
const OLD_NAME = "hlm";

export function resolvePaths(
  env: Env,
  platform: Platform = process.platform,
  home: string = homedir(),
  exists: (dir: string) => boolean = existsSync,
): Paths {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const cacheDir = readEnv(env, "DAYHAND_CACHE_DIR").value || defaultCacheDir(env, platform, home, join);
  const explicit = readEnv(env, "DAYHAND_CONFIG_DIR").value;
  let configDir = explicit || defaultConfigDir(env, platform, home, join, NAME);
  let warning: Warning | undefined;
  if (!explicit && !exists(configDir)) {
    const old = defaultConfigDir(env, platform, home, join, OLD_NAME);
    if (exists(old)) {
      warning = { code: "deprecated_config_dir", message: `${old} is the folder of the old hlm command; move it to ${configDir}` };
      configDir = old;
    }
  }
  return { configDir, cacheDir, configFile: join(configDir, "config.toml"), ...(warning ? { warning } : {}) };
}

/** Where dayhand keeps data it makes itself and wants to find again (not config, not a throwaway cache). */
export function resolveDataDir(env: Env, platform: Platform = process.platform, home: string = homedir()): string {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), DATA_NAME, "Data");
  if (platform === "darwin") return join(home, "Library", "Application Support", DATA_NAME);
  return join(absolute(env.XDG_DATA_HOME) ?? join(home, ".local", "share"), DATA_NAME);
}

type Join = (...parts: string[]) => string;

function defaultConfigDir(env: Env, platform: Platform, home: string, join: Join, name: string): string {
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), name);
  if (platform === "darwin") return join(home, "Library", "Application Support", name);
  return join(absolute(env.XDG_CONFIG_HOME) ?? join(home, ".config"), name);
}

function defaultCacheDir(env: Env, platform: Platform, home: string, join: Join): string {
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), NAME, "Cache");
  if (platform === "darwin") return join(home, "Library", "Caches", NAME);
  return join(absolute(env.XDG_CACHE_HOME) ?? join(home, ".cache"), NAME);
}

/** The XDG spec ignores relative paths. */
const absolute = (value: string | undefined) => (value && path.posix.isAbsolute(value) ? value : undefined);
