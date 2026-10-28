#!/usr/bin/env node
// The labels backup of the upgrade to 0.14.0 (docs/deploy.md#upgrading-to-0140).
// Before migrations:dropLabels removes the stored labels, `export` writes every
// task's labels to a new JSON file; `restore` puts them back when rolling back.
//
//   node scripts/labels-backup.mjs export <file> [convex run options]
//   node scripts/labels-backup.mjs restore <file> [convex run options]
//
// The options go to `npx convex run`, e.g. --env-file "<folder>/cloud/convex.env"
// or --prod; without them the Convex CLI acts on the deployment it is set up for.
// The file holds the user's labels: keep it outside the repository.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runConvexCli } from "./local-backend-lib.mjs";

export const BACKUP_KIND = "dayhand-labels-backup";
// migrations:restoreLabels takes at most this many tasks at a time.
const RESTORE_BATCH = 200;

/** Runs a deployment function with the Convex CLI (`convex run`) and parses its JSON result. */
export function cliRunner(options = [], env = process.env) {
  return async (name, args) => {
    const { stdout } = await runConvexCli(["run", name, JSON.stringify(args), ...options], env);
    return JSON.parse(stdout);
  };
}

/** Every task with labels, page by page from migrations:exportLabels. */
export async function collectLabels(run) {
  const items = [];
  let cursor = null;
  for (;;) {
    const page = await run("migrations:exportLabels", { cursor });
    items.push(...page.items);
    if (page.done) return items;
    cursor = page.cursor;
  }
}

/** Writes the backup to `file`, which must not exist yet; returns what it holds. */
export async function exportBackup(file, run, now = Date.now()) {
  const items = await collectLabels(run);
  const backup = { kind: BACKUP_KIND, exportedAt: new Date(now).toISOString(), items };
  writeFileSync(file, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { tasks: items.length, labels: items.reduce((sum, item) => sum + item.labels.length, 0) };
}

/** Puts the labels of a backup back on their tasks; tasks no longer there are counted in missing. */
export async function restoreBackup(file, run) {
  const backup = JSON.parse(readFileSync(file, "utf8"));
  if (backup?.kind !== BACKUP_KIND || !Array.isArray(backup.items)) throw new Error(`${file} is not a Dayhand labels backup`);
  let restored = 0;
  let missing = 0;
  for (let start = 0; start < backup.items.length; start += RESTORE_BATCH) {
    const items = backup.items.slice(start, start + RESTORE_BATCH).map(({ taskId, labels }) => ({ taskId, labels }));
    const result = await run("migrations:restoreLabels", { items });
    restored += result.restored;
    missing += result.missing;
  }
  return { restored, missing };
}

async function main() {
  const [command, file, ...options] = process.argv.slice(2);
  if ((command !== "export" && command !== "restore") || !file) {
    console.error("Usage: labels-backup.mjs export|restore <file> [convex run options]");
    process.exit(2);
  }
  const run = cliRunner(options);
  if (command === "export") {
    const { tasks, labels } = await exportBackup(file, run);
    console.log(`Wrote ${labels} label(s) of ${tasks} task(s) to ${file}`);
  } else {
    const { restored, missing } = await restoreBackup(file, run);
    console.log(`Restored the labels of ${restored} task(s); ${missing} task(s) of the backup no longer exist`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
