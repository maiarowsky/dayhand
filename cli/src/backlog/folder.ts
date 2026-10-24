// A Backlog.md folder on disk (docs/backlog-md.md): the files `dayhand backlog
// import` sends and the files `dayhand backlog export` writes. The server reads
// and writes the format; this module only finds files, orders them so that a
// task's dependencies go first, cuts them into calls that fit the server's
// request limit, and writes an export without overwriting anything unasked.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type BacklogFile = { path: string; content: string };

/** Under the server's 256 KiB request limit, with room for the JSON around the files. */
export const BATCH_BYTES = 200 * 1024;
export const BATCH_FILES = 200;
/** Longest file the server takes (characters). */
export const FILE_CHARS = 100_000;

const CONFIG = /^(backlog\.)?config\.yml$/i;
const SKIP_DIRS = new Set([".git", "node_modules"]);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) found.push(...(await walk(full)));
    else if (entry.isFile() && (/\.md$/i.test(entry.name) || CONFIG.test(entry.name))) found.push(full);
  }
  return found;
}

/**
 * The Markdown files below `dir` and its config.yml (also the one next to it,
 * for dayhand backlog import backlog/tasks). Paths start with the folder's own
 * name ("backlog/tasks/task-1 - x.md"), so the server sees which folder a file is in.
 */
export async function readFolder(dir: string): Promise<{ files: BacklogFile[]; tooLong: string[] }> {
  const root = resolve(dir);
  const name = basename(root);
  const paths = await walk(root);
  const parentConfig = ["config.yml", "backlog.config.yml"].map((f) => join(dirname(root), f)).find((f) => existsSync(f));
  if (parentConfig && !paths.some((p) => CONFIG.test(basename(p)))) paths.push(parentConfig);
  const files: BacklogFile[] = [];
  const tooLong: string[] = [];
  for (const full of paths.sort()) {
    const path = full.startsWith(root + sep) ? `${name}/${relative(root, full).split(sep).join("/")}` : basename(full);
    const content = await readFile(full, "utf8");
    if (content.length > FILE_CHARS) tooLong.push(path);
    else files.push({ path, content });
  }
  return { files, tooLong };
}

/** The id and the dependencies in a file's YAML header, read just enough to order the files. */
function headerOf(content: string): { id: string | null; dependencies: string[] } {
  const header = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  const clean = (v: string) => v.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const id = /^id:\s*(.+?)\s*$/m.exec(header)?.[1];
  const flow = /^dependencies:\s*\[(.*)\]\s*$/m.exec(header)?.[1];
  const block = /^dependencies:\s*\r?\n((?:[ \t]*-.*\r?\n?)*)/m.exec(header)?.[1];
  const dependencies = flow !== undefined ? flow.split(",") : (block ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, "").replace(/\s+#.*$/, ""));
  return { id: id ? clean(id) : null, dependencies: dependencies.map(clean).filter(Boolean) };
}

/** Config first, then every task after the tasks it depends on (a cycle keeps its order). */
export function dependenciesFirst(files: BacklogFile[]): BacklogFile[] {
  const config = files.filter((f) => CONFIG.test(basename(f.path)));
  const pending = files.filter((f) => !config.includes(f)).map((file) => ({ file, ...headerOf(file.content) }));
  const ids = new Set(pending.map((p) => p.id).filter((id): id is string => id !== null));
  const placed = new Set<string>();
  const ordered: BacklogFile[] = [...config];
  while (pending.length) {
    const index = pending.findIndex((p) => p.dependencies.every((d) => !ids.has(d) || placed.has(d)));
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    if (next!.id) placed.add(next!.id);
    ordered.push(next!.file);
  }
  return ordered;
}

/** Calls of at most BATCH_FILES files and BATCH_BYTES of JSON, in order; the config goes with each. */
export function batches(ordered: BacklogFile[]): BacklogFile[][] {
  const config = ordered.filter((f) => CONFIG.test(basename(f.path)));
  const size = (f: BacklogFile) => Buffer.byteLength(JSON.stringify(f));
  const base = config.reduce((n, f) => n + size(f), 0);
  const result: BacklogFile[][] = [];
  let current: BacklogFile[] = [];
  let bytes = base;
  for (const file of ordered.filter((f) => !config.includes(f))) {
    if (current.length > 0 && (bytes + size(file) > BATCH_BYTES || current.length + config.length >= BATCH_FILES)) {
      result.push([...config, ...current]);
      current = [];
      bytes = base;
    }
    current.push(file);
    bytes += size(file);
  }
  if (current.length > 0 || result.length === 0) result.push([...config, ...current]);
  return result;
}

/** The export's paths that already exist in `dir`. */
export function existing(dir: string, paths: string[]): string[] {
  return paths.filter((path) => existsSync(join(dir, path)));
}

/** Writes the files below `dir`, making folders as needed. */
export async function writeFolder(dir: string, files: BacklogFile[]): Promise<void> {
  for (const file of files) {
    const target = join(dir, ...file.path.split("/"));
    if (!resolve(target).startsWith(resolve(dir) + sep)) throw new Error(`Refusing to write outside ${dir}: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}
