// dayhand backlog and dayhand prime without a backend: the order and size of the
// import call and its report, and the brief as text.
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { dependenciesFirst, readFolder, writeFolder, type BacklogFile } from "../src/backlog/folder.js";
import { primeText, type AgentBrief } from "../src/registry/agents.js";
import { backlogCommands, importText } from "../src/registry/backlog.js";
import type { RunContext } from "../src/registry/types.js";

const importCommand = backlogCommands[0]!.subcommands!.find((command) => command.name === "import")!;

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

  test.each([
    "dependencies: [TASK-200] # prerequisite",
    "dependencies: # prerequisite\n  - 'TASK-200' # quoted",
    'dependencies: ["TASK-200"] # quoted',
    "dependencies: >-\n  TASK-200",
  ])("ordering uses the supported YAML for %s", (dependencies) => {
    const files = [task("a.md", `id: TASK-1\ntitle: Dependent\n${dependencies}`), task("z.md", "id: 'Task-200' # source\ntitle: Prerequisite")];
    expect(dependenciesFirst(files).map((file) => file.path)).toEqual(["z.md", "a.md"]);
  });

  test("quoted hashes and doubled quotes identify the same dependency in lists and scalars", () => {
    const files = [task("a.md", "id: TASK-1\ntitle: Dependent\ndependencies: ['O''Brien #42'] # outside"), task("z.md", "id: 'O''Brien #42' # outside\ntitle: Prerequisite")];
    expect(dependenciesFirst(files).map((file) => file.path)).toEqual(["z.md", "a.md"]);
  });

  test.each(["config.yml", "backlog.config.yml", undefined])("selected subdirectories keep backlog paths and project config (%s)", async (configName) => inFolder(async (base) => {
    const root = join(base, "project", "backlog");
    const branches = ["tasks", "drafts", "completed", "archive/tasks", "archive/drafts", "docs", "decisions", "milestones"];
    const fixtures = branches.map((branch, index) => task(`${branch}/nested/part/task-${index}.md`, `id: TASK-${index}\ntitle: T${index}\nstatus: Review`));
    const loose = task("subsets/sprint/part/loose.md", "id: TASK-99\ntitle: Loose subset");
    for (const file of [...fixtures, loose]) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), file.content);
    }
    const config = { path: configName!, content: "statuses: [Queue, Review, Shipped]\n" };
    if (configName) await writeFile(join(root, configName), config.content);
    for (const [index, branch] of branches.entries()) {
      for (const subset of [branch, `${branch}/nested/part`]) {
        const files = await readFolder(join(root, subset));
        expect(files).toHaveLength(configName ? 2 : 1);
        expect(files).toContainEqual(fixtures[index]);
        if (configName) expect(files).toContainEqual(config);
      }
    }
    const subset = await readFolder(join(root, "subsets", "sprint", "part"));
    expect(subset).toHaveLength(configName ? 2 : 1);
    expect(subset).toContainEqual(loose);
    const archived = await readFolder(join(root, "archive"));
    expect(archived.filter((file) => file.path.endsWith(".md"))).toEqual(fixtures.slice(3, 5).sort((a, b) => a.path.localeCompare(b.path)));
    const all = await readFolder(root);
    expect(all.filter((file) => file.path.endsWith(".md"))).toHaveLength(fixtures.length + 1);
  }));

  test.each([false, true])("over-limit folders fail before any request (dryRun=%s)", async (dryRun) => inFolder(async (root) => {
    const client = vi.fn();
    const ctx = { dryRun, client } as unknown as RunContext;
    const count = join(root, "count");
    await mkdir(count);
    await Promise.all(Array.from({ length: 201 }, (_, i) => writeFile(join(count, `${i}.md`), `---\nid: TASK-${i}\ntitle: T${i}\n---\n`)));
    await expect(importCommand.run!(ctx, { dir: count }, {})).rejects.toThrow(/import it by subdirectories/);
    const bytes = join(root, "bytes");
    await mkdir(bytes);
    await Promise.all(["a.md", "b.md"].map((path) => writeFile(join(bytes, path), "ą".repeat(60_000))));
    await expect(importCommand.run!(ctx, { dir: bytes }, {})).rejects.toThrow(/import it by subdirectories/);
    const long = join(root, "long");
    await mkdir(long);
    await writeFile(join(long, "task.md"), "x".repeat(100_001));
    await expect(importCommand.run!(ctx, { dir: long }, {})).rejects.toThrow(/longer than 100000 characters/);
    expect(client).not.toHaveBeenCalled();
  }));

  test.each([false, true])("one invocation sends exactly one dependency-ordered call (dryRun=%s)", async (dryRun) => inFolder(async (root) => {
    const report = { format: "backlog-md", dryRun, files: 2, created: 0, tasks: [], skipped: [], failed: [], warnings: [] };
    await writeFile(join(root, "a.md"), "---\nid: TASK-1\ntitle: Dependent\ndependencies: [TASK-2] # prerequisite\n---\n");
    await writeFile(join(root, "z.md"), "---\nid: Task-2\ntitle: Prerequisite\n---\n");
    const callTool = vi.fn(async () => ({ structured: report }));
    const request = vi.fn(async () => report);
    const client = vi.fn(async () => ({ callTool, request }));
    const ctx = { dryRun, client } as unknown as RunContext;
    const outcome = await importCommand.run!(ctx, { dir: root }, {});
    expect(outcome.value).toBe(report);
    expect(client).toHaveBeenCalledTimes(1);
    const files = dependenciesFirst(await readFolder(root));
    if (dryRun) {
      expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/v1/import/backlog?dryRun=true", { files });
      expect(callTool).not.toHaveBeenCalled();
    } else {
      expect(callTool).toHaveBeenCalledExactlyOnceWith("import_backlog", { files });
      expect(request).not.toHaveBeenCalled();
    }
  }));

  test("the import report prints created tasks, skips and warnings", () => {
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

async function inFolder(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(process.cwd(), ".backlog-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const exportFiles = [{ path: "config.yml", content: "statuses: [To Do, In Progress, Done]\n" }, { path: "tasks/task-1.md", content: "private task\n" }];

describe("export folders", () => {
  test("missing and empty destinations get the config and tasks; existing contents require force", async () => inFolder(async (root) => {
    const out = join(root, "out");
    await writeFolder(out, exportFiles);
    expect(await readFile(join(out, "tasks/task-1.md"), "utf8")).toBe("private task\n");
    const existing = join(root, "existing");
    await mkdir(existing);
    await writeFile(join(existing, "config.yml"), "statuses: [A, B]\n");
    await expect(writeFolder(existing, exportFiles)).rejects.toThrow(/already exist/);
    expect(await readdir(existing)).toEqual(["config.yml"]);
    expect(await readFile(join(existing, "config.yml"), "utf8")).toBe("statuses: [A, B]\n");
    await writeFolder(existing, exportFiles, true);
    expect(await readFile(join(existing, "config.yml"), "utf8")).toBe(exportFiles[0].content);
    const empty = join(root, "empty");
    await mkdir(empty);
    await writeFolder(empty, exportFiles);
    expect(await readFile(join(empty, "tasks/task-1.md"), "utf8")).toBe("private task\n");
  }));

  test.each([false, true])("a directory symlink cannot redirect an export (force=%s)", async (force) => inFolder(async (root) => {
    const out = join(root, "out");
    const outside = join(root, "outside");
    await mkdir(out);
    await mkdir(outside);
    await symlink(outside, join(out, "tasks"));
    await expect(writeFolder(out, exportFiles, force)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(out)).toEqual(["tasks"]);
    await symlink(outside, join(root, "alias"));
    await expect(writeFolder(join(root, "alias"), exportFiles, force)).rejects.toThrow(/unsafe/);
    expect(await readdir(outside)).toEqual([]);
  }));

  test.each(["config.yml", "tasks/task-1.md"])("existing and dangling file symlinks are refused: %s", async (path) => inFolder(async (root) => {
    const out = join(root, "out");
    const outside = join(root, "outside.md");
    await mkdir(join(out, "tasks"), { recursive: true });
    await symlink(outside, join(out, path));
    await expect(writeFolder(out, exportFiles, true)).rejects.toThrow(/unsafe/);
    await expect(readFile(outside)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(outside, "untouched");
    await expect(writeFolder(out, exportFiles, true)).rejects.toThrow(/unsafe/);
    expect(await readFile(outside, "utf8")).toBe("untouched");
  }));

  test("relative traversal is refused before writing anything", async () => inFolder(async (root) => {
    await expect(writeFolder(join(root, "out"), [{ path: "../escape.md", content: "private" }], true)).rejects.toThrow(/outside/);
    expect(await readdir(root)).toEqual([]);
  }));
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
