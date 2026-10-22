// The CLI's own version and its compatibility rule with the backend.
import { createRequire } from "node:module";

// src/core and dist/core are both two levels below package.json.
export const CLI_VERSION: string = createRequire(import.meta.url)("../../package.json").version;

/** Oldest backend this CLI is written for: task numbers and error codes arrived in 0.3.0. */
export const MIN_SERVER_VERSION = "0.3.0";

const parse = (version: string) => version.split(/[.+-]/).slice(0, 3).map(Number);

/** Same major, and not older than MIN_SERVER_VERSION (docs/mcp.md#versions). */
export function isCompatible(serverVersion: string, min = MIN_SERVER_VERSION): boolean {
  const [major, minor, patch] = parse(serverVersion);
  const [minMajor, minMinor, minPatch] = parse(min);
  if (major === undefined || Number.isNaN(major) || major !== minMajor) return false;
  return minor! > minMinor! || (minor === minMinor && patch! >= minPatch!);
}
