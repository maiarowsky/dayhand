// The Dayhand backend that the dayhand package carries (cli/backend, copied from the repository by
// prepack: scripts/pack-files.mjs). The package folder may be read-only or must not change (Homebrew
// keg, global npm prefix) and the setup script installs the backend's dependencies and downloads the
// Convex local backend into its own folder, so dayhand server runs it from a copy in the data folder,
// one per dayhand version, made once and reused.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "../core/exit.js";

/** src/registry and dist/registry are both two levels below the package folder. */
export const PACKAGED_BACKEND = fileURLToPath(new URL("../../backend", import.meta.url));

/** What the setup script makes inside its folder; a copy never takes these along. */
const NOT_COPIED = new Set(["node_modules", ".local-backend"]);

/** The folder of one dayhand version's copy. */
export const backendCopyDir = (dataDir: string, version: string) => path.join(dataDir, "backend", version.replace(/[^0-9A-Za-z.+-]/g, "_"));

const isCopy = (dir: string) => existsSync(path.join(dir, "package.json"));

/** Copies a folder tree, leaving every file writable by its owner whatever the source allows. */
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (NOT_COPIED.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else {
      copyFileSync(source, target);
      chmodSync(target, 0o644);
    }
  }
}

export type WritableBackend = { dir: string; copied: boolean; inPlace: boolean };

/**
 * The folder to run the setup script from for the packaged backend `source`: this version's copy in
 * `dataDir`, made now when there is none. With create=false (--dry-run, which must change nothing) a
 * missing copy is not made and the packaged folder is used in place; the script only reads it then.
 * The copy is made beside its place and renamed into it, so a stopped copy never looks complete.
 */
export function writableBackend(source: string, version: string, dataDir: string, create: boolean): WritableBackend {
  const target = backendCopyDir(dataDir, version);
  if (isCopy(target)) return { dir: target, copied: false, inPlace: false };
  if (!create) return { dir: source, copied: false, inPlace: true };
  const partial = `${target}.partial-${process.pid}`;
  try {
    rmSync(partial, { recursive: true, force: true });
    copyTree(source, partial);
    renameSync(partial, target);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    // Another dayhand may have made the same copy in the meantime.
    if (isCopy(target)) return { dir: target, copied: false, inPlace: false };
    throw new CliError(
      "internal",
      `Cannot copy the packaged Dayhand backend to ${target}: ${(error as Error).message}`,
      { hint: "Check that your system's data folder is writable, or pass --backend <folder> of a Dayhand repository" },
      { cause: error },
    );
  }
  return { dir: target, copied: true, inPlace: false };
}
