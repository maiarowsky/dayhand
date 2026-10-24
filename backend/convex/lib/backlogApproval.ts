import { fail } from "./core";
import { sha256Hex } from "./secrets";

export const MAX_BACKLOG_BATCHES = 256;
const MAX_BATCH_FILES = 200;
export type BacklogRun = { batches: { hash: string; files: number }[] };

export async function checkBacklogRun(input: Record<string, unknown>): Promise<void> {
  if (input.run === undefined) return;
  const run = input.run as BacklogRun;
  if (!run || !Array.isArray(run.batches) || run.batches.length < 2 || run.batches.length > MAX_BACKLOG_BATCHES) {
    fail("invalid_argument", `an import run needs 2 to ${MAX_BACKLOG_BATCHES} batches`);
  }
  for (const batch of run.batches) {
    if (!batch || !/^[a-f0-9]{64}$/.test(batch.hash) || !Number.isInteger(batch.files) || batch.files < 1 || batch.files > MAX_BATCH_FILES) {
      fail("invalid_argument", `each import batch needs a SHA-256 hash and a file count from 1 to ${MAX_BATCH_FILES}`);
    }
  }
  const files = input.files as { path: string; content: string }[];
  const hash = await sha256Hex(JSON.stringify(files.map(({ path, content }) => ({ path, content }))));
  if (!run.batches.some((batch) => batch.hash === hash && batch.files === files.length)) {
    fail("invalid_argument", "these files do not match any batch of the import run");
  }
}
