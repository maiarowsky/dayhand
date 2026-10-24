// A Backlog.md folder on disk (docs/backlog-md.md): the files `dayhand backlog
// import` sends and the files `dayhand backlog export` writes. The server reads
// and writes the format; this module only finds files and writes an export
// without overwriting anything unasked.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type BacklogFile = { path: string; content: string };

/** Under the server's 256 KiB request limit, with room for the JSON around the files. */
export const IMPORT_BYTES = 200 * 1024;
export const IMPORT_FILES = 200;
/** Longest file the server takes (characters). */
export const FILE_CHARS = 100_000;

const CONFIG = /^(backlog\.)?config\.yml$/i;
const CONFIG_NAMES = ["config.yml", "backlog.config.yml"];
const BACKLOG_DIRS = new Set(["tasks", "drafts", "completed", "archive", "docs", "decisions", "milestones"]);
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

async function configAt(dir: string): Promise<string | undefined> {
  for (const name of CONFIG_NAMES) {
    const config = join(dir, name);
    if ((await stat(config))?.isFile()) return config;
  }
}

async function backlogRoot(selected: string): Promise<{ root: string; config?: string }> {
  const config = await configAt(selected);
  if (config) return { root: selected, config };
  let root = selected;
  while (BACKLOG_DIRS.has(basename(root).toLowerCase())) root = dirname(root);
  return { root, config: root === selected ? undefined : await configAt(root) };
}

export async function readFolder(dir: string): Promise<BacklogFile[]> {
  const selected = resolve(dir);
  const { root, config } = await backlogRoot(selected);
  const paths = (await walk(selected)).filter((path) => !CONFIG.test(basename(path)) || path === config);
  if (config && !paths.includes(config)) paths.push(config);
  const files: BacklogFile[] = [];
  for (const full of paths.sort()) {
    const path = relative(root, full).split(sep).join("/");
    files.push({ path, content: await readFile(full, "utf8") });
  }
  return files;
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
