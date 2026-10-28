#!/usr/bin/env node
// The labels backup of the upgrade to 0.14.0 (docs/deploy.md#upgrading-to-0140).
// Before migrations:dropLabels removes the stored labels, `export` writes every
// task's labels to a new JSON file, kept as the record of them.
//
//   node scripts/labels-backup.mjs export <file> [convex run options]
//
// The options go to `npx convex run`, e.g. --env-file "<folder>/cloud/convex.env"
// or --prod; without them the Convex CLI acts on the deployment it is set up for.
// The file holds the user's labels: keep it outside the repository.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runConvexCli } from "./local-backend-lib.mjs";

export const BACKUP_KIND = "dayhand-labels-backup";

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

async function main() {
  const [command, file, ...options] = process.argv.slice(2);
  if (command !== "export" || !file) {
    console.error("Usage: labels-backup.mjs export <file> [convex run options]");
    process.exit(2);
  }
  const { tasks, labels } = await exportBackup(file, cliRunner(options));
  console.log(`Wrote ${labels} label(s) of ${tasks} task(s) to ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
