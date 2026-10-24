// A Backlog.md folder on disk (docs/backlog-md.md): the files `dayhand backlog
// import` sends and the files `dayhand backlog export` writes. The server reads
// and writes the format; this module only finds files, orders them so that a
// task's dependencies go first, and writes an export without overwriting anything unasked.
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { FrontmatterError, parseFrontmatter, splitFrontmatter } from "./frontmatter.js";

export type BacklogFile = { path: string; content: string };

/** Under the server's 256 KiB request limit, with room for the JSON around the files. */
export const IMPORT_BYTES = 200 * 1024;
export const IMPORT_FILES = 200;
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
export async function readFolder(dir: string): Promise<BacklogFile[]> {
  const root = resolve(dir);
  const name = basename(root);
  const paths = await walk(root);
  const parentConfig = ["config.yml", "backlog.config.yml"].map((f) => join(dirname(root), f)).find((f) => existsSync(f));
  if (parentConfig && !paths.some((p) => CONFIG.test(basename(p)))) paths.push(parentConfig);
  const files: BacklogFile[] = [];
  for (const full of paths.sort()) {
    const path = full.startsWith(root + sep) ? `${name}/${relative(root, full).split(sep).join("/")}` : basename(full);
    files.push({ path, content: await readFile(full, "utf8") });
  }
  return files;
}

/** The id and the dependencies in a file's YAML header, read just enough to order the files. */
function headerOf(content: string): { id: string | null; dependencies: string[] } {
  try {
    const { front } = splitFrontmatter(content);
    const header = front === null ? {} : parseFrontmatter(front);
    const id = Array.isArray(header.id) ? header.id.join(", ") : header.id;
    const dependencies = Array.isArray(header.dependencies) ? header.dependencies : typeof header.dependencies === "string" ? [header.dependencies] : [];
    return { id: id?.trim().toUpperCase() || null, dependencies: dependencies.map((d) => d.trim().toUpperCase()).filter(Boolean) };
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    return { id: null, dependencies: [] };
  }
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

async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function directory(path: string, root: string): Promise<void> {
  if (!(await stat(path))) await mkdir(path);
  const entry = await lstat(path);
  const resolved = await realpath(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (resolved !== root && !resolved.startsWith(root + sep))) {
    throw new Error(`Refusing an unsafe export directory: ${path}`);
  }
}

export async function writeFolder(dir: string, files: BacklogFile[], force = false): Promise<void> {
  const destination = resolve(dir);
  const targets = files.map((file) => {
    const target = resolve(destination, file.path);
    if (!target.startsWith(destination + sep)) throw new Error(`Refusing to write outside ${dir}: ${file.path}`);
    return { ...file, target };
  });
  const entry = await stat(destination);
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error(`Refusing an unsafe export destination: ${dir}`);
  if (entry && !force && (await readdir(destination)).length) throw new Error(`Files already exist in ${dir}; choose an empty folder or pass --force`);
  await mkdir(destination, { recursive: true });
  const root = await realpath(destination);
  for (const file of targets) {
    let parent = root;
    for (const part of relative(destination, dirname(file.target)).split(sep).filter(Boolean)) {
      parent = join(parent, part);
      await directory(parent, root);
    }
    const target = await stat(file.target);
    if (target && (!target.isFile() || target.isSymbolicLink() || target.nlink > 1)) throw new Error(`Refusing an unsafe export file: ${file.path}`);
  }
  for (const file of targets) {
    const parent = await realpath(dirname(file.target));
    if (parent !== root && !parent.startsWith(root + sep)) throw new Error(`Refusing to write outside ${dir}: ${file.path}`);
    const handle = await open(file.target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (force ? constants.O_TRUNC : constants.O_EXCL));
    try {
      await handle.writeFile(file.content);
    } finally {
      await handle.close();
    }
  }
}
