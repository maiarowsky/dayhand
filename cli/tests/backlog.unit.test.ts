// dayhand backlog and dayhand prime without a backend: the order and size of the
// import calls, merging their reports, and the brief as text.
import { describe, expect, test } from "vitest";
import { BATCH_BYTES, batches, dependenciesFirst, type BacklogFile } from "../src/backlog/folder.js";
import { primeText, type AgentBrief } from "../src/registry/agents.js";
import { importText, mergeReports } from "../src/registry/backlog.js";

const task = (path: string, header: string): BacklogFile => ({ path, content: `---\n${header}\n---\n` });

describe("import calls", () => {
  test("the config goes first, then each task after the tasks it depends on", () => {
    const files = [
      task("b/tasks/c.md", "id: TASK-3\ntitle: C\ndependencies:\n  - task-2 # B first\n  - 'TASK-9'"),
      task("b/tasks/b.md", "id: TASK-2\ntitle: B\ndependencies: [TASK-1]"),
      task("b/tasks/a.md", 'id: "TASK-1"\ntitle: A'),
      { path: "b/config.yml", content: "statuses: [To Do, Done]\n" },
      task("b/tasks/x.md", "id: TASK-8\ntitle: X\ndependencies: [TASK-7]"),
      task("b/tasks/y.md", "id: TASK-7\ntitle: Y\ndependencies: [TASK-8]"),
    ];
    expect(dependenciesFirst(files).map((f) => f.path)).toEqual(["b/config.yml", "b/tasks/a.md", "b/tasks/b.md", "b/tasks/c.md", "b/tasks/x.md", "b/tasks/y.md"]);
  });

  test("calls stay under 200 files and the byte limit, each with the config", () => {
    const config = { path: "b/config.yml", content: "statuses: [To Do, Done]\n" };
    const many = Array.from({ length: 450 }, (_, i) => task(`b/tasks/t${i}.md`, `id: TASK-${i}\ntitle: T${i}`));
    const calls = batches([config, ...many]);
    expect(calls.map((c) => c.length)).toEqual([200, 200, 53]);
    for (const call of calls) expect(call[0]).toBe(config);
    const big = Array.from({ length: 5 }, (_, i) => ({ path: `b/tasks/big${i}.md`, content: "x".repeat(90_000) }));
    const sized = batches(big);
    expect(sized.map((c) => c.length)).toEqual([2, 2, 1]);
    for (const call of sized) expect(Buffer.byteLength(JSON.stringify(call))).toBeLessThan(BATCH_BYTES);
    expect(batches([])).toEqual([[]]);
  });

  test("one call's report is the tool's; several add up, with the files left out locally", () => {
    const report = (n: number, dryRun = false) => ({
      format: "backlog-md" as const,
      dryRun,
      files: n + 1,
      created: n,
      tasks: Array.from({ length: n }, (_, i) => ({ ref: i + 1, title: `T${i}` })),
      skipped: [{ path: "b/tasks/readme.md", reason: "no YAML header (--- … ---), so not a task file" }],
      failed: [],
      warnings: [{ path: null, message: "Not carried over, Dayhand has no field for them: priority (1 file)" }],
    });
    const one = report(2);
    expect(mergeReports([one], 3, [])).toBe(one);
    const merged = mergeReports([report(2), report(1)], 5, ["b/tasks/huge.md"]);
    expect(merged).toMatchObject({ files: 6, created: 3, dryRun: false });
    expect(merged.skipped.at(-1)).toEqual({ path: "b/tasks/huge.md", reason: "longer than 100000 characters" });
    expect(importText(report(1, true))).toBe(
      [
        "Dry run: nothing was stored. Would import 1 task(s) from 2 file(s) (backlog-md).",
        "  would create: #1 T0",
        "  skipped: b/tasks/readme.md (no YAML header (--- … ---), so not a task file)",
        "  note: Not carried over, Dayhand has no field for them: priority (1 file)",
      ].join("\n"),
    );
  });
});

describe("dayhand prime", () => {
  const empty = { count: 0, items: [] };
  const brief: AgentBrief = {
    date: "2026-10-24",
    timezone: "Europe/London",
    now: null,
    overdue: [],
    today: [],
    doneToday: [],
    agentsPaused: false,
    pausedReason: null,
    policies: [{ tool: "delete_task", rule: "ask" }],
    claims: {
      active: { count: 1, items: [{ ref: 4, title: "Ship it", claimedBy: "builder", claimExpiresAt: Date.parse("2026-10-24T13:30:00Z"), mine: true }] },
      expired: empty,
    },
    approvals: {
      pending: { count: 1, items: [{ id: "a1", action: "Deploy", ref: 4, expiresAt: Date.parse("2026-10-25T09:00:00Z"), mine: true, decision: null }] },
      decided: empty,
    },
    ready: { count: 12, items: [{ ref: 5, title: "Next one" }] },
    nextSteps: ["You hold #4 Ship it until 2026-10-24 14:30: renew_claim while you work."],
  };

  test("the brief comes after Today, in the user's time zone, then the next steps and the rules", () => {
    const text = primeText(brief);
    expect(text).toContain(
      [
        "## Agent brief",
        "Agents: running",
        "Your tool policies: delete_task ask",
        "Claims:",
        "  #4 Ship it, you, until 2026-10-24 14:30",
        "Waiting for the owner:",
        '  "Deploy" (#4), yours, until 2026-10-25 09:00', // the clocks went back that night
        "Ready to work on (12 in all):",
        "  #5 Next one",
        "",
        "## Next steps",
        "- You hold #4 Ship it until 2026-10-24 14:30: renew_claim while you work.",
        "",
        "## Using dayhand",
      ].join("\n"),
    );
    expect(primeText({ ...brief, agentsPaused: true, pausedReason: "quiet hours" })).toContain("Agents: PAUSED by the owner (quiet hours)");
  });
});
