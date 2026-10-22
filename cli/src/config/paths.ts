// Where hlm keeps its files, following each system's convention:
//   Linux and others  $XDG_CONFIG_HOME/hlm (~/.config/hlm), cache $XDG_CACHE_HOME/hlm (~/.cache/hlm)
//   macOS             ~/Library/Application Support/hlm, cache ~/Library/Caches/hlm
//   Windows           %APPDATA%\hlm, cache %LOCALAPPDATA%\hlm\Cache
// HLM_CONFIG_DIR and HLM_CACHE_DIR override both (tests, portable setups).
import { homedir } from "node:os";
import path from "node:path";
import type { Env } from "./env.js";

export type Platform = NodeJS.Platform;

export type Paths = { configDir: string; cacheDir: string; configFile: string };

export function resolvePaths(env: Env, platform: Platform = process.platform, home: string = homedir()): Paths {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const configDir = env.HLM_CONFIG_DIR || defaultConfigDir(env, platform, home, join);
  const cacheDir = env.HLM_CACHE_DIR || defaultCacheDir(env, platform, home, join);
  return { configDir, cacheDir, configFile: join(configDir, "config.toml") };
}

type Join = (...parts: string[]) => string;

function defaultConfigDir(env: Env, platform: Platform, home: string, join: Join): string {
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "hlm");
  if (platform === "darwin") return join(home, "Library", "Application Support", "hlm");
  return join(absolute(env.XDG_CONFIG_HOME) ?? join(home, ".config"), "hlm");
}

function defaultCacheDir(env: Env, platform: Platform, home: string, join: Join): string {
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "hlm", "Cache");
  if (platform === "darwin") return join(home, "Library", "Caches", "hlm");
  return join(absolute(env.XDG_CACHE_HOME) ?? join(home, ".cache"), "hlm");
}

/** The XDG spec ignores relative paths. */
const absolute = (value: string | undefined) => (value && path.posix.isAbsolute(value) ? value : undefined);
