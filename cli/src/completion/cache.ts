// Task numbers, titles and labels for completion: one list_all call, kept for
// 60 seconds in the cache folder (mode 0600: titles are private). Completion
// must never hang or print errors, so every failure here means "no candidates".
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config/file.js";
import { resolveConnection } from "../config/resolve.js";
import type { Io } from "../core/io.js";
import { credentialStores } from "../credentials/index.js";
import type { Task } from "../render/model.js";
import { readProjects } from "../projects.js";
import { DayhandClient } from "../transport/client.js";

export const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;

export type TaskHints = { tasks: { ref: number; title: string }[]; labels: string[]; projects?: { name: string; archived: boolean }[] };
type Cached = TaskHints & { fetchedAt: number };

const EMPTY: TaskHints = { tasks: [], labels: [], projects: [] };

export async function taskHints(io: Io, cacheDir: string, configDir: string, config: Config, flags: { url?: string; profile?: string }): Promise<TaskHints> {
  try {
    const quiet = () => {};
    const connection = await resolveConnection(flags, io.env, config, quiet, credentialStores(io.env, configDir, quiet));
    const digest = createHash("sha256").update(JSON.stringify([connection.url, connection.key])).digest("hex");
    const file = path.join(cacheDir, `tasks-${digest}.json`);
    const cached = read(file);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && Date.now() >= cached.fetchedAt) return cached;
    const client = new DayhandClient(connection, io.fetch, undefined, FETCH_TIMEOUT_MS);
    const [listed, projects] = await Promise.all([client.callTool("list_all", { includeDone: false }), readProjects(client)]);
    const tasks = (listed.structured as { result?: Task[] } | undefined)?.result ?? [];
    const hints: TaskHints = {
      tasks: tasks.filter((t) => t.ref !== undefined).map((t) => ({ ref: t.ref!, title: t.title })),
      labels: [...new Set(tasks.flatMap((t) => t.labels))].sort(),
      projects: projects.map(({ name, archived }) => ({ name, archived })),
    };
    write(file, { ...hints, fetchedAt: Date.now() });
    return hints;
  } catch {
    return EMPTY;
  }
}

function read(file: string): Cached | undefined {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Cached;
    return Array.isArray(data.tasks) && Array.isArray(data.labels) && Array.isArray(data.projects) && typeof data.fetchedAt === "number" ? data : undefined;
  } catch {
    return undefined;
  }
}

function write(file: string, data: Cached): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // A read-only cache folder only costs a server call next time.
  }
}
