// Database reads per poll. On the Free plan Convex disables the whole team once
// the month's database I/O passes 1 GB; in November 2026 a terminal UI polling
// plan_health once a minute reached that in a day, because every call read the
// user's whole task history. Reads of the polled views must not grow with it.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { asUser, helm, importRows, newUserId } from "./helpers";

const DAY_MS = 86_400_000;

type LogEntry = { kind: string; identifier: string; cachedResult?: boolean; usageStats?: { databaseReadDocuments: number } };

async function functionLogs(cursor: number): Promise<{ entries: LogEntry[]; newCursor: number }> {
  const response = await fetch(`${helm().url}/api/stream_function_logs?cursor=${cursor}`, {
    headers: { Authorization: `Convex ${helm().adminKey}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

/** Documents the one execution of `identifier` started by `run` read, from the backend's function log. */
async function documentsRead(identifier: string, run: () => Promise<unknown>): Promise<number> {
  const { newCursor } = await functionLogs(0);
  await run();
  const end = Date.now() + 10_000;
  for (;;) {
    const done = (await functionLogs(newCursor)).entries.filter((e) => e.kind === "Completion" && !e.cachedResult && e.identifier === identifier);
    if (done.length > 0) return done[done.length - 1]!.usageStats!.databaseReadDocuments;
    if (Date.now() > end) throw new Error(`no completed ${identifier} in the function log`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let nextRef = 1;

/** Tasks finished long ago: the history that piles up over months of use. */
async function finishedLongAgo(userId: string, count: number) {
  const at = Date.now() - 90 * DAY_MS;
  await importRows(
    "tasks",
    Array.from({ length: count }, () => ({
      userId,
      ref: nextRef++,
      title: "Done in the summer",
      status: "done",
      isNow: false,
      links: [],
      completedAt: at,
      createdAt: at,
      updatedAt: at,
    })),
  );
}

describe("reads of the polled views do not grow with finished tasks", () => {
  test.each([
    ["plan_health", "ops:planHealth", internal.ops.planHealth],
    ["list_today", "ops:listToday", internal.ops.listToday],
  ])("%s", async (_tool, identifier, ref) => {
    const userId = newUserId();
    const user = asUser(userId);
    await user.mutation(internal.ops.add, { title: "Pay the rent", dueDate: "2020-01-05" });
    await user.mutation(internal.ops.add, { title: "Write the report", status: "doing" });
    await finishedLongAgo(userId, 5);
    const before = await documentsRead(identifier, () => user.query(ref, { at: Date.now() }));

    await finishedLongAgo(userId, 100);
    expect(await documentsRead(identifier, () => user.query(ref, { at: Date.now() }))).toBe(before);
  });
});
