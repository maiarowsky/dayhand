// The agent contract: every MCP tool is reachable, `--json` and `dayhand call`
// print exactly what the official MCP SDK client gets as structuredContent,
// and every --json output follows docs/schemas.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import { readFolder } from "../src/backlog/folder.js";
import { flatten } from "../src/registry/index.js";
import { admin, connectAgent, createKey, dayhand, dayhandJson, jsonError, mcpClient, newUser, schemaValidator, sdkCall, TEST_HOME } from "./helpers.js";

const validate = schemaValidator();
const specOf = (path: string) => flatten().find((c) => c.path === path)!.spec;

/** A synthetic Backlog.md folder: a config with the project's statuses and two tasks, one waiting for the other. */
function backlogFolder(): string {
  const dir = join(mkdtempSync(join(TEST_HOME, "folder-")), "backlog");
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "config.yml"), 'statuses: ["To Do", "Doing", "Done"]\n');
  writeFileSync(join(dir, "tasks", "task-2 - Print-labels.md"), "---\nid: TASK-2\ntitle: Print labels\nstatus: Doing\ndependencies: [TASK-1]\n---\n");
  writeFileSync(join(dir, "tasks", "task-1 - Buy-a-printer.md"), "---\nid: TASK-1\ntitle: Buy a printer\nstatus: To Do\n---\n\n## Acceptance Criteria\n- [ ] #1 It prints\n");
  return dir;
}

/** The dates in written task files are the minute of the call. */
const undated = (value: any) => ({ ...value, files: value.files.map((f: any) => ({ ...f, content: f.content.replace(/^(created_date|updated_date): .*$/gm, "$1: <time>") })) });

/** export_plan's exportedAt is the time of the call; everything else must match exactly. */
const stable = (tool: string, value: any) => {
  // plan_health states the time it was made.
  if (tool === "plan_health" || tool === "agent_brief") return { ...value, at: "<at>" };
  if (tool !== "export_plan") return value;
  const { exportedAt, ...content } = value.content;
  return { ...value, content };
};

type Case = { command: string[]; path: string; tool: string; args: Record<string, unknown> };

/** Tools whose arguments name a request or a key made during the test, or a folder on disk: their own tests below. */
const BY_ID = ["get_approval", "decide_approval", "set_tool_policy", "import_backlog", "export_backlog"];

// One user's day, in order. Changes carry a clientId, so the SDK call with the
// same arguments is a replay that must return the same result.
const CASES: Case[] = [
  { path: "add", command: ["add", "Write", "report", "--time", "09:00", "-l", "work", "--note", "first", "--client-id", "c-add-1"], tool: "add_task", args: { title: "Write report", dueDate: "today", dueTime: "09:00", labels: ["work"], note: "first", clientId: "c-add-1" } },
  { path: "add", command: ["add", "Water plants", "--every", "week", "--on", "mon,thu", "--client-id", "c-add-2"], tool: "add_task", args: { title: "Water plants", dueDate: "today", repeat: { every: "week", interval: 1, weekdays: [1, 4] }, clientId: "c-add-2" } },
  { path: "add", command: ["add", "Someday", "--no-due", "--link", "https://example.com Docs", "--client-id", "c-add-3"], tool: "add_task", args: { title: "Someday", links: [{ url: "https://example.com", title: "Docs" }], clientId: "c-add-3" } },
  { path: "edit", command: ["edit", "#1", "--title", "Write the report", "--add-label", "urgent", "--client-id", "c-edit"], tool: "update_task", args: { taskId: "#1", title: "Write the report", labels: ["work", "urgent"], clientId: "c-edit" } },
  { path: "add", command: ["add", "Payroll", "--month-weekday", "last fri", "--count", "6", "--item", "check hours", "--item", "send", "--remind", "18:00 -1d", "--client-id", "c-add-4"], tool: "add_task", args: { title: "Payroll", dueDate: "today", repeat: { every: "month", interval: 1, weekdayOfMonth: { nth: -1, weekday: 5 }, count: 6 }, checklist: [{ title: "check hours" }, { title: "send" }], reminders: [{ time: "18:00", daysBefore: 1 }], clientId: "c-add-4" } },
  { path: "edit", command: ["edit", "#4", "--rrule", "FREQ=MONTHLY;BYMONTHDAY=-1", "--no-reminders", "--client-id", "c-edit-2"], tool: "update_task", args: { taskId: "#4", repeat: "FREQ=MONTHLY;BYMONTHDAY=-1", reminders: [], clientId: "c-edit-2" } },
  { path: "checklist", command: ["checklist", "4", "--check", "1", "--add", "file", "--client-id", "c-check"], tool: "update_task", args: { taskId: "#4", checklist: [{ id: "c1", title: "check hours", done: true }, { id: "c2", title: "send", done: false }, { title: "file" }], clientId: "c-check" } },
  { path: "checklist", command: ["checklist", "#4"], tool: "get_task", args: { taskId: "#4" } },
  { path: "note", command: ["note", "1", "second", "line", "--client-id", "c-note"], tool: "update_task", args: { taskId: "#1", note: "first\nsecond line", clientId: "c-note" } },
  { path: "move", command: ["move", "2", "tomorrow", "--time", "08:00", "--client-id", "c-move"], tool: "reschedule_task", args: { taskId: "#2", dueDate: "tomorrow", dueTime: "08:00", clientId: "c-move" } },
  { path: "start", command: ["start", "1", "--client-id", "c-start"], tool: "set_status", args: { taskId: "#1", status: "doing", clientId: "c-start" } },
  { path: "now", command: ["now", "#1", "--note", "outline done", "--client-id", "c-now"], tool: "set_now", args: { taskId: "#1", resumeNote: "outline done", clientId: "c-now" } },
  { path: "today", command: ["today"], tool: "list_today", args: {} },
  { path: "now", command: ["now"], tool: "list_today", args: {} },
  { path: "list", command: ["list", "--done", "-l", "work"], tool: "list_all", args: { includeDone: true, includeArchived: false, labels: ["work"] } },
  { path: "board", command: ["board", "--done-limit", "5"], tool: "board", args: { doneLimit: 5 } },
  { path: "show", command: ["show", "1"], tool: "get_task", args: { taskId: "#1" } },
  { path: "note", command: ["note", "#1"], tool: "get_task", args: { taskId: "#1" } },
  { path: "settings", command: ["settings"], tool: "get_settings", args: {} },
  { path: "settings set", command: ["settings", "set", "summary-time=06:00", "reminders=0,15", "--client-id", "c-settings"], tool: "update_settings", args: { summaryTime: "06:00", defaultReminderMinutes: [0, 15], clientId: "c-settings" } },
  { path: "done", command: ["done", "2", "--client-id", "c-done"], tool: "complete_task", args: { taskId: "#2", clientId: "c-done" } },
  { path: "reopen", command: ["reopen", "2", "--client-id", "c-reopen"], tool: "set_status", args: { taskId: "#2", status: "todo", clientId: "c-reopen" } },
  { path: "stop", command: ["stop", "1", "--client-id", "c-stop"], tool: "set_status", args: { taskId: "#1", status: "todo", clientId: "c-stop" } },
  { path: "now", command: ["now", "--clear", "--client-id", "c-clear"], tool: "set_now", args: { taskId: null, clientId: "c-clear" } },
  { path: "add", command: ["add", "Ship export", "--no-due", "--accept", "CSV opens", "--plan", "write then test", "--depends-on", "2", "--client-id", "c-add-5"], tool: "add_task", args: { title: "Ship export", acceptance: [{ text: "CSV opens" }], plan: "write then test", dependsOn: ["#2"], clientId: "c-add-5" } },
  { path: "criteria", command: ["criteria", "6", "--met", "1", "--add", "Docs", "--client-id", "c-crit"], tool: "update_task", args: { taskId: "#6", acceptance: [{ id: "a1", text: "CSV opens", met: true }, { text: "Docs" }], clientId: "c-crit" } },
  { path: "criteria", command: ["criteria", "#6"], tool: "get_task", args: { taskId: "#6" } },
  { path: "edit", command: ["edit", "6", "--blocked", "waiting", "--client-id", "c-edit-3"], tool: "update_task", args: { taskId: "#6", blockedReason: "waiting", clientId: "c-edit-3" } },
  { path: "list", command: ["list", "--ready"], tool: "list_all", args: { includeDone: false, includeArchived: false, ready: true } },
  { path: "claim", command: ["claim", "6", "--minutes", "30", "--client-id", "c-claim"], tool: "claim_task", args: { taskId: "#6", minutes: 30, clientId: "c-claim" } },
  { path: "renew", command: ["renew", "6", "--client-id", "c-renew"], tool: "renew_claim", args: { taskId: "#6", clientId: "c-renew" } },
  { path: "release", command: ["release", "6", "--note", "half way", "--client-id", "c-release"], tool: "release_task", args: { taskId: "#6", note: "half way", clientId: "c-release" } },
  { path: "log", command: ["log", "--task", "6", "--limit", "3"], tool: "list_events", args: { taskId: "#6", limit: 3 } },
  { path: "done", command: ["done", "6", "--summary", "Shipped", "--check", "tests=pass https://ci.example/1", "--client-id", "c-done-2"], tool: "complete_task", args: { taskId: "#6", proof: { summary: "Shipped", checks: [{ name: "tests", result: "pass", url: "https://ci.example/1" }] }, clientId: "c-done-2" } },
  // Backend 0.11.0: approval requests, the owner's controls, proposals and plan health (a cli key is the owner).
  { path: "ask", command: ["ask", "Send", "the", "report", "--option", "Send: it goes out today", "--option", "Hold", "--task", "3", "--expires", "2h", "--client-id", "c-ask"], tool: "request_approval", args: { action: "Send the report", options: [{ label: "Send", consequence: "it goes out today" }, { label: "Hold" }], reversible: false, taskId: "#3", expiresInMinutes: 120, clientId: "c-ask" } },
  { path: "approvals", command: ["approvals", "--status", "pending"], tool: "list_approvals", args: { status: "pending" } },
  { path: "agents pause", command: ["agents", "pause", "--reason", "quiet hours"], tool: "pause_agents", args: { paused: true, reason: "quiet hours" } },
  { path: "agents", command: ["agents"], tool: "get_agent_controls", args: {} },
  { path: "agents resume", command: ["agents", "resume"], tool: "pause_agents", args: { paused: false } },
  { path: "policy", command: ["policy"], tool: "get_agent_controls", args: {} },
  { path: "add", command: ["add", "Proposed", "fix", "--no-due", "--propose", "--source", "email:m-1", "--requested-by", "Ann", "--client-id", "c-prop-1"], tool: "add_task", args: { title: "Proposed fix", proposal: true, source: { kind: "email", ref: "m-1" }, requestedBy: "Ann", clientId: "c-prop-1" } },
  { path: "add", command: ["add", "Proposed", "merge", "--no-due", "--propose", "--client-id", "c-prop-2"], tool: "add_task", args: { title: "Proposed merge", proposal: true, clientId: "c-prop-2" } },
  { path: "add", command: ["add", "Proposed", "no", "--no-due", "--propose", "--client-id", "c-prop-3"], tool: "add_task", args: { title: "Proposed no", proposal: true, clientId: "c-prop-3" } },
  { path: "proposals", command: ["proposals"], tool: "list_all", args: { proposed: true, limit: 200 } },
  { path: "proposals accept", command: ["proposals", "accept", "7", "--client-id", "c-accept"], tool: "accept_proposal", args: { taskId: "#7", clientId: "c-accept" } },
  { path: "proposals merge", command: ["proposals", "merge", "8", "--into", "6", "--client-id", "c-merge"], tool: "merge_proposal", args: { taskId: "#8", intoTaskId: "#6", clientId: "c-merge" } },
  { path: "proposals reject", command: ["proposals", "reject", "9", "--reason", "not now", "--client-id", "c-reject"], tool: "reject_proposal", args: { taskId: "#9", reason: "not now", clientId: "c-reject" } },
  { path: "health", command: ["health"], tool: "plan_health", args: {} },
  // Backend 0.12.0: the agent brief.
  { path: "prime", command: ["prime"], tool: "agent_brief", args: {} },
  { path: "archive", command: ["archive", "1", "--client-id", "c-archive"], tool: "archive_task", args: { taskId: "#1", clientId: "c-archive" } },
  { path: "restore", command: ["restore", "1", "--client-id", "c-restore"], tool: "restore_task", args: { taskId: "#1", clientId: "c-restore" } },
  { path: "rm", command: ["rm", "1", "--client-id", "c-rm"], tool: "delete_task", args: { taskId: "#1", clientId: "c-rm" } },
  { path: "trash", command: ["trash"], tool: "list_trash", args: {} },
  { path: "export", command: ["export"], tool: "export_plan", args: { format: "json" } },
];

describe("agent contract", () => {
  test("every one of the 35 MCP tools is reachable by a command", async () => {
    const { key } = await newUser();
    const tools: string[] = (await dayhandJson(key, ["tools"])).tools.map((t: { name: string }) => t.name);
    expect(tools).toHaveLength(35);
    const covered = new Set(flatten().flatMap((c) => c.spec.tools));
    expect(tools.filter((t) => !covered.has(t))).toEqual([]);
    expect(new Set([...CASES.map((c) => c.tool), ...BY_ID])).toEqual(new Set(tools));
  });

  test("commands on a request or a key by its id print what the SDK client gets", async () => {
    const { userId, key } = await newUser();
    const sdk = await mcpClient(key);
    const asked = await dayhandJson(key, ["ask", "Rotate", "the", "keys", "--option", "Yes", "--option", "No"]);
    const cases: Case[] = [
      { path: "approval", command: ["approval", asked.id], tool: "get_approval", args: { approvalId: asked.id } },
      { path: "approvals decide", command: ["approvals", "decide", asked.id, "o2", "--note", "next week"], tool: "decide_approval", args: { approvalId: asked.id, optionId: "o2", note: "next week" } },
      { path: "approval", command: ["approval", asked.id, "--wait", "1"], tool: "get_approval", args: { approvalId: asked.id } },
    ];
    const agentKeyId = (await createKey(userId, "worker", "agent")).id;
    cases.push({ path: "policy set", command: ["policy", "set", agentKeyId, "delete_task", "deny"], tool: "set_tool_policy", args: { apiKeyId: agentKeyId, toolName: "delete_task", rule: "deny" } });
    for (const c of cases) {
      const viaCommand = await dayhandJson(key, c.command);
      const viaSdk = await sdkCall(sdk, c.tool, c.args);
      expect(viaSdk.isError, `${c.tool} via SDK`).toBe(false);
      expect(viaCommand, `dayhand ${c.command.join(" ")}`).toEqual(viaSdk.structured);
      expect(validate(specOf(c.path).schema!, viaCommand), `schema of dayhand ${c.path}`).toEqual([]);
    }
    expect(validate(specOf("ask").schema!, asked)).toEqual([]);
    await sdk.close();
  });

  test("--json and dayhand call print the MCP SDK client's structuredContent, valid against docs/schemas", async () => {
    const { key, keyId } = await newUser();
    const sdk = await mcpClient(key);
    for (const [i, c] of CASES.entries()) {
      // Each case makes up to three changes with one key: keep under the 60 a minute.
      if (i % 15 === 0) await admin("mutation", "callLimits:reset", { keyId });
      const viaCommand = await dayhandJson(key, c.command);
      const viaCall = await dayhandJson(key, ["call", c.tool, JSON.stringify(c.args)]);
      const viaSdk = await sdkCall(sdk, c.tool, c.args);
      expect(viaSdk.isError, `${c.tool} via SDK`).toBe(false);
      expect(stable(c.tool, viaCommand), `dayhand ${c.command.join(" ")}`).toEqual(stable(c.tool, viaSdk.structured));
      expect(stable(c.tool, viaCall), `dayhand call ${c.tool}`).toEqual(stable(c.tool, viaSdk.structured));
      expect(validate(specOf(c.path).schema!, viaCommand), `schema of dayhand ${c.path}`).toEqual([]);
    }
    await sdk.close();
  });

  test("dayhand backlog import and export print what the SDK client gets, and follow their schemas", async () => {
    const { key } = await newUser();
    const sdk = await mcpClient(key);
    const dir = backlogFolder();

    const preview = await dayhandJson(key, ["backlog", "import", dir, "--dry-run"]);
    expect(preview).toMatchObject({ dryRun: true, created: 2, files: 3 });
    expect((await dayhandJson(key, ["list"])).total).toBe(0);

    const imported = await dayhandJson(key, ["backlog", "import", dir]);
    expect(validate(specOf("backlog import").schema!, imported)).toEqual([]);
    expect(imported.tasks.map((t: any) => [t.title, t.status])).toEqual([["Buy a printer", "todo"], ["Print labels", "doing"]]);
    expect(imported.tasks[1].dependsOn).toEqual([imported.tasks[0].id]);
    // Again, the command and the SDK with the files the command sends: everything was imported before.
    const files = await readFolder(dir);
    const again = await dayhandJson(key, ["backlog", "import", dir]);
    const viaSdk = await sdkCall(sdk, "import_backlog", { files });
    expect(viaSdk.isError).toBe(false);
    expect(again).toEqual(viaSdk.structured);
    expect(again.skipped.map((s: any) => s.reason)).toEqual(["imported before", "imported before"]);

    const exported = await dayhandJson(key, ["backlog", "export", "--prefix", "shop"]);
    expect(undated(exported)).toEqual(undated((await sdkCall(sdk, "export_backlog", { prefix: "shop" })).structured));
    expect(validate("backlog-export.schema.json", exported)).toEqual([]);
    const target = join(mkdtempSync(join(TEST_HOME, "out-")), "backlog");
    const written = await dayhandJson(key, ["backlog", "export", target]);
    expect(validate(specOf("backlog export").schema!, written)).toEqual([]);
    expect(written).toMatchObject({ directory: target, total: 2, config: "config.yml", written: ["tasks/task-1 - Buy-a-printer.md", "tasks/task-2 - Print-labels.md"] });
    expect(readFileSync(join(target, "tasks", "task-2 - Print-labels.md"), "utf8")).toContain("status: In Progress\nassignee: []");
    const refused = await dayhand(key, ["backlog", "export", target]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("already exist");
    expect((await dayhandJson(key, ["backlog", "export", target, "--force"])).config).toBe("config.yml");
    const theirs = join(mkdtempSync(join(TEST_HOME, "own-")), "backlog");
    mkdirSync(theirs);
    writeFileSync(join(theirs, "config.yml"), "statuses: [A, B]\n");
    expect((await dayhand(key, ["backlog", "export", theirs])).code).toBe(2);
    expect(readFileSync(join(theirs, "config.yml"), "utf8")).toBe("statuses: [A, B]\n");
    expect(existsSync(join(theirs, "tasks"))).toBe(false);
    expect((await dayhandJson(key, ["backlog", "export", theirs, "--force"])).config).toBe("config.yml");
    expect(readFileSync(join(theirs, "config.yml"), "utf8")).toContain("'To Do', 'In Progress', 'Done'");
    expect(existsSync(join(theirs, "tasks", "task-1 - Buy-a-printer.md"))).toBe(true);
    await sdk.close();
  });

  test("backlog subdirectory imports preserve every folder classification and root config", async () => {
    const { key } = await newUser();
    const root = join(mkdtempSync(join(TEST_HOME, "subsets-")), "backlog");
    mkdirSync(root);
    writeFileSync(join(root, "backlog.config.yml"), "statuses: [Queue, Middle, Shipped]\n");
    const cases = [
      { branch: "tasks", expected: { status: "doing" } },
      { branch: "drafts", expected: { status: "todo", proposedAt: expect.any(Number) } },
      { branch: "completed", expected: { status: "done" } },
      { branch: "archive/tasks", expected: { status: "doing", archivedAt: expect.any(Number) } },
      { branch: "archive/drafts", reason: "an archived draft, not a task" },
      { branch: "docs", reason: "a document, not a task" },
      { branch: "decisions", reason: "a decision record, not a task" },
      { branch: "milestones", reason: "a milestone, not a task" },
    ];
    for (const [index, item] of cases.entries()) {
      const selected = join(root, item.branch);
      const nested = join(selected, "nested", "part");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "task.md"), `---\nid: TASK-${index}\ntitle: Case ${index}\nstatus: ${item.branch === "drafts" ? "Queue" : "Middle"}\n---\n`);
      const preview = await dayhandJson(key, ["backlog", "import", selected, "--dry-run"]);
      const imported = await dayhandJson(key, ["backlog", "import", selected]);
      for (const report of [preview, imported]) {
        expect(report.files).toBe(2);
        if (item.reason) {
          expect(report).toMatchObject({ created: 0, skipped: [{ path: `${item.branch}/nested/part/task.md`, reason: item.reason }] });
        } else {
          expect(report).toMatchObject({ created: 1, failed: [], warnings: [], tasks: [item.expected] });
          if (item.branch !== "drafts") expect(report.tasks[0]).not.toHaveProperty("proposedAt");
          if (item.branch !== "archive/tasks") expect(report.tasks[0]).not.toHaveProperty("archivedAt");
        }
      }
    }
    const noConfig = join(mkdtempSync(join(TEST_HOME, "layout-")), "backlog", "archive", "tasks");
    mkdirSync(noConfig, { recursive: true });
    writeFileSync(join(noConfig, "task.md"), "---\nid: TASK-99\ntitle: Configless archive\n---\n");
    expect(await dayhandJson(key, ["backlog", "import", noConfig])).toMatchObject({ created: 1, tasks: [{ archivedAt: expect.any(Number) }] });
  });

  test.each([false, true])("backlog top-level folders retain ownership of nested reserved names (config=%s)", async (configured) => {
    const { key } = await newUser();
    const root = join(mkdtempSync(join(TEST_HOME, "nested-layout-")), "backlog");
    mkdirSync(root);
    if (configured) writeFileSync(join(root, "config.yml"), "statuses: [Queue, Middle, Shipped]\n");
    const cases = [
      { folder: "tasks/docs", expected: { status: "doing" } },
      { folder: "tasks/archive/drafts", expected: { status: "doing" } },
      { folder: "tasks/completed", expected: { status: "doing" } },
      { folder: "drafts/tasks", expected: { status: "todo", proposedAt: expect.any(Number) } },
      { folder: "completed/tasks", expected: { status: "done" } },
      { folder: "archive/tasks/docs", expected: { status: "doing", archivedAt: expect.any(Number) } },
      { folder: "archive/drafts/tasks", reason: "an archived draft, not a task" },
      { folder: "docs/tasks", reason: "a document, not a task" },
      { folder: "decisions/tasks", reason: "a decision record, not a task" },
      { folder: "milestones/tasks", reason: "a milestone, not a task" },
    ];
    for (const [index, item] of cases.entries()) {
      const selected = join(root, item.folder);
      mkdirSync(selected, { recursive: true });
      const status = item.folder.startsWith("drafts/") ? configured ? "Queue" : "To Do" : configured ? "Middle" : "In Progress";
      writeFileSync(join(selected, "task.md"), `---\nid: TASK-${index}\ntitle: Nested ${index}\nstatus: ${status}\n---\n`);
      for (const flags of [["--dry-run"], []]) {
        const report = await dayhandJson(key, ["backlog", "import", selected, ...flags]);
        expect(report.files).toBe(configured ? 2 : 1);
        if (item.reason) expect(report).toMatchObject({ created: 0, skipped: [{ path: `${item.folder}/task.md`, reason: item.reason }] });
        else {
          expect(report).toMatchObject({ created: 1, failed: [], warnings: [], tasks: [item.expected] });
          if (!item.folder.startsWith("drafts/")) expect(report.tasks[0]).not.toHaveProperty("proposedAt");
          if (!item.folder.startsWith("archive/tasks/")) expect(report.tasks[0]).not.toHaveProperty("archivedAt");
        }
      }
    }
  });

  test("backlog roots stop below unrelated docs or tasks ancestors", async () => {
    const { key } = await newUser();
    const base = mkdtempSync(join(TEST_HOME, "bounded-root-"));
    writeFileSync(join(base, "config.yml"), "statuses: [Outside, Finished]\n");
    const cases = [
      { folder: "docs/backlog/tasks", expected: { status: "todo" } },
      { folder: "tasks/backlog/drafts", expected: { status: "todo", proposedAt: expect.any(Number) } },
      { folder: "backlog/archive/tasks", expected: { status: "todo", archivedAt: expect.any(Number) } },
      { folder: "backlog/tasks/docs", expected: { status: "todo" } },
    ];
    for (const [index, item] of cases.entries()) {
      const selected = join(base, item.folder);
      mkdirSync(selected, { recursive: true });
      writeFileSync(join(selected, "task.md"), `---\nid: TASK-${index}\ntitle: Bounded ${index}\n---\n`);
      for (const flags of [["--dry-run"], []]) {
        const report = await dayhandJson(key, ["backlog", "import", selected, ...flags]);
        expect(report).toMatchObject({ files: 1, created: 1, failed: [], skipped: [], warnings: [], tasks: [item.expected] });
        if (!item.folder.endsWith("/drafts")) expect(report.tasks[0]).not.toHaveProperty("proposedAt");
        if (!item.folder.includes("/archive/tasks")) expect(report.tasks[0]).not.toHaveProperty("archivedAt");
      }
    }
  });

  test.each(["agents_paused", "forbidden"] as const)("backlog REST previews preserve the same %s refusal as MCP imports", async (code) => {
    const { userId, key } = await newUser();
    const agent = await createKey(userId, "importer", "agent");
    const dir = backlogFolder();
    if (code === "agents_paused") await dayhandJson(key, ["agents", "pause", "--reason", "lunch"]);
    else await dayhandJson(key, ["policy", "set", agent.id, "import_backlog", "deny"]);
    const ordinary = await dayhand(agent.key, ["backlog", "import", dir, "--json"]);
    const preview = await dayhand(agent.key, ["backlog", "import", dir, "--dry-run", "--json"]);
    for (const run of [ordinary, preview]) {
      expect(run.code).toBe(7);
      expect(run.stdout).toBe("");
      const error = jsonError(run);
      expect(error).toMatchObject({ code, exitCode: 7 });
      expect(error.hint).toBeUndefined();
      expect(validate("error.schema.json", { error })).toEqual([]);
    }
    expect(jsonError(preview).message).toBe(jsonError(ordinary).message);
    expect((await dayhandJson(key, ["list"])).total).toBe(0);
    if (code === "agents_paused") await dayhandJson(key, ["agents", "resume"]);
    else await dayhandJson(key, ["policy", "set", agent.id, "import_backlog", "allow"]);
    expect(await dayhandJson(agent.key, ["backlog", "import", dir, "--dry-run"])).toMatchObject({ dryRun: true, created: 2 });
    expect((await dayhandJson(key, ["list"])).total).toBe(0);
  });

  test("a backlog import under ask uses an exact one-call approval with no replay exception", async () => {
    const { userId, key } = await newUser();
    const agent = await createKey(userId, "importer", "agent");
    await dayhandJson(key, ["policy", "set", agent.id, "import_backlog", "ask"]);
    const dir = backlogFolder();
    const refused = await dayhand(agent.key, ["backlog", "import", dir, "--json"]);
    expect(refused.code).toBe(7);
    const { approvalId } = jsonError(refused);
    expect(typeof approvalId).toBe("string");
    expect(JSON.parse((await dayhandJson(key, ["approval", approvalId])).arguments)).toEqual({ files: await readFolder(dir) });
    expect((await dayhandJson(key, ["list"])).total).toBe(0);
    await dayhandJson(key, ["approvals", "decide", approvalId, "allow"]);
    const imported = await dayhandJson(agent.key, ["backlog", "import", dir, "--approval", approvalId]);
    expect(imported).toMatchObject({ created: 2, failed: [], warnings: [] });
    expect(imported.tasks[1].dependsOn).toEqual([imported.tasks[0].id]);
    const again = await dayhand(agent.key, ["backlog", "import", dir, "--approval", approvalId, "--json"]);
    expect(again.code).toBe(7);
    expect(jsonError(again).message).toContain("already used");
    expect((await dayhandJson(key, ["list"])).total).toBe(2);
  });

  test("backlog folders over one call's count or byte limit are refused without partial imports", async () => {
    const { key } = await newUser();
    const count = join(mkdtempSync(join(TEST_HOME, "count-")), "backlog");
    mkdirSync(count);
    for (let i = 0; i < 201; i++) writeFileSync(join(count, `${i}.md`), `---\nid: TASK-${i}\ntitle: Task ${i}\n---\n`);
    const bytes = join(mkdtempSync(join(TEST_HOME, "bytes-")), "backlog");
    mkdirSync(bytes);
    for (let i = 0; i < 3; i++) writeFileSync(join(bytes, `${i}.md`), `---\nid: TASK-${i}\ntitle: Task ${i}\n---\n${"x".repeat(90_000)}`);
    for (const dir of [count, bytes]) {
      for (const flags of [[], ["--dry-run"]]) {
        const refused = await dayhand(key, ["backlog", "import", dir, ...flags, "--json"]);
        expect(refused.code).toBe(2);
        expect(jsonError(refused).message).toContain("import it by subdirectories");
      }
    }
    expect((await dayhandJson(key, ["list"])).total).toBe(0);
  });

  test("backlog export prints overflow warnings with and without a destination, without truncation", async () => {
    const { key } = await newUser();
    const sdk = await mcpClient(key);
    const note = "n".repeat(20_000);
    const added = await sdkCall(sdk, "add_task", { title: "Long note", note, checklist: [{ title: "Keep this item" }] });
    expect(added.isError).toBe(false);
    const exported = await dayhandJson(key, ["backlog", "export"]);
    expect(validate("backlog-export.schema.json", exported)).toEqual([]);
    const warning = `${exported.files[0].id} (Long note): exported fields exceed Dayhand import limits`;
    expect(exported.notes).toContainEqual(expect.stringContaining(warning));
    expect(exported.files[0].content).toContain(note + "\n\nChecklist:\n- [ ] Keep this item");
    const printed = await dayhand(key, ["backlog", "export"]);
    expect(printed.code).toBe(0);
    expect(printed.stdout).toContain(warning);
    const dir = join(mkdtempSync(join(TEST_HOME, "warning-")), "backlog");
    const written = await dayhand(key, ["backlog", "export", dir]);
    expect(written.code).toBe(0);
    expect(written.stdout).toContain(warning);
    expect(readFileSync(join(dir, exported.files[0].path), "utf8")).toContain(note + "\n\nChecklist:\n- [ ] Keep this item");
    await sdk.close();
  });

  test("backlog export warns about oversized serialized files and still writes all their content", async () => {
    const { key } = await newUser();
    const sdk = await mcpClient(key);
    const task = { title: "Large file", note: "n".repeat(20_000), plan: "p".repeat(20_000), acceptance: Array.from({ length: 50 }, () => ({ text: "c".repeat(500) })), links: Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i}/`.padEnd(2_000, "x") })) };
    expect((await sdkCall(sdk, "add_task", task)).isError).toBe(false);
    const exported = await dayhandJson(key, ["backlog", "export"]);
    const warning = "exported file exceeds Dayhand import limit (100000 characters)";
    expect(exported.notes).toContainEqual(expect.stringContaining(warning));
    const dir = join(mkdtempSync(join(TEST_HOME, "large-")), "backlog");
    const written = await dayhand(key, ["backlog", "export", dir]);
    expect(written.code).toBe(0);
    expect(written.stdout).toContain(warning);
    const content = readFileSync(join(dir, exported.files[0].path), "utf8");
    expect(content.length).toBeGreaterThan(100_000);
    expect(content).toBe(exported.files[0].content);
    const refused = await dayhand(key, ["backlog", "import", dir, "--json"]);
    expect(refused.code).toBe(2);
    expect(jsonError(refused).message).toContain("100000 characters");
    await sdk.close();
  });

  test("backlog export writes a CJK filename within 255 UTF-8 bytes with the longest prefix", async () => {
    const { key } = await newUser();
    const sdk = await mcpClient(key);
    const title = "界".repeat(80);
    expect((await sdkCall(sdk, "add_task", { title })).isError).toBe(false);
    const dir = join(mkdtempSync(join(TEST_HOME, "unicode-")), "backlog");
    const written = await dayhandJson(key, ["backlog", "export", dir, "--prefix", "ABCDEFGHIJKLMNOP"]);
    expect(Buffer.byteLength(basename(written.written[0]), "utf8")).toBeLessThanOrEqual(255);
    expect(readFileSync(join(dir, written.written[0]), "utf8")).toContain(title);
    const target = await newUser();
    expect(await dayhandJson(target.key, ["backlog", "import", dir])).toMatchObject({ created: 1, tasks: [{ title }] });
    await sdk.close();
  });

  test("a Markdown export prints the SDK's text, and its JSON form follows the schema", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Plan", "the", "week"]);
    const sdk = await mcpClient(key);
    const viaSdk = await sdkCall(sdk, "export_plan", { format: "markdown" });
    // The export states when it was made; that line differs between calls.
    const when = (text: string) => text.replace(/^Exported \S+/m, "Exported <at>").trimEnd();
    const text = when((viaSdk.content as { text: string }[])[0]!.text);
    expect(when((await dayhand(key, ["export"])).stdout)).toBe(text);
    expect(when((await dayhand(key, ["call", "export_plan", '{"format":"markdown"}'])).stdout)).toBe(text);
    const json = await dayhandJson(key, ["export", "--format", "md"]);
    expect({ ...json, content: when(json.content) }).toEqual({ format: "markdown", content: text });
    expect(validate("export.schema.json", json)).toEqual([]);
    await sdk.close();
  });

  test("other outputs follow their schemas: several tasks, tools, version, devices, connections", async () => {
    const { userId, key } = await newUser();
    for (const title of ["A", "B", "C"]) await dayhand(key, ["add", title]);
    expect(validate("results.schema.json", await dayhandJson(key, ["done", "1", "2", "3", "--yes"]))).toEqual([]);
    expect(validate("results.schema.json", await dayhandJson(key, ["rm", "1", "2", "3", "--yes"]))).toEqual([]);
    expect(validate(specOf("tools").schema!, await dayhandJson(key, ["tools", "add_task"]))).toEqual([]);
    const version = await dayhandJson(key, ["version"]);
    expect(validate(specOf("version").schema!, version)).toEqual([]);
    expect(version.compatible).toBe(true);
    const pairing = await dayhandJson(key, ["pair"]);
    expect(validate(specOf("pair").schema!, pairing)).toEqual([]);
    const devices = await dayhandJson(key, ["device", "list"]);
    expect(validate(specOf("device list").schema!, devices)).toEqual([]);
    await connectAgent(userId);
    const connections = await dayhandJson(key, ["connection", "list"]);
    expect(connections.connections).toHaveLength(1);
    expect(validate(specOf("connection list").schema!, connections)).toEqual([]);
    const revoked = await dayhandJson(key, ["connection", "revoke", connections.connections[0].id]);
    expect(validate(specOf("connection revoke").schema!, revoked)).toEqual([]);
  });
});
