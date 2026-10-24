// The agent contract: every MCP tool is reachable, `--json` and `dayhand call`
// print exactly what the official MCP SDK client gets as structuredContent,
// and every --json output follows docs/schemas.
import { describe, expect, test } from "vitest";
import { flatten } from "../src/registry/index.js";
import { admin, connectAgent, dayhand, dayhandJson, mcpClient, newUser, schemaValidator, sdkCall } from "./helpers.js";

const validate = schemaValidator();
const specOf = (path: string) => flatten().find((c) => c.path === path)!.spec;

/** export_plan's exportedAt is the time of the call; everything else must match exactly. */
const stable = (tool: string, value: any) => {
  if (tool !== "export_plan") return value;
  const { exportedAt, ...content } = value.content;
  return { ...value, content };
};

type Case = { command: string[]; path: string; tool: string; args: Record<string, unknown> };

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
  { path: "archive", command: ["archive", "1", "--client-id", "c-archive"], tool: "archive_task", args: { taskId: "#1", clientId: "c-archive" } },
  { path: "restore", command: ["restore", "1", "--client-id", "c-restore"], tool: "restore_task", args: { taskId: "#1", clientId: "c-restore" } },
  { path: "rm", command: ["rm", "1", "--client-id", "c-rm"], tool: "delete_task", args: { taskId: "#1", clientId: "c-rm" } },
  { path: "trash", command: ["trash"], tool: "list_trash", args: {} },
  { path: "export", command: ["export"], tool: "export_plan", args: { format: "json" } },
];

describe("agent contract", () => {
  test("every one of the 21 MCP tools is reachable by a command", async () => {
    const { key } = await newUser();
    const tools: string[] = (await dayhandJson(key, ["tools"])).tools.map((t: { name: string }) => t.name);
    expect(tools).toHaveLength(21);
    const covered = new Set(flatten().flatMap((c) => c.spec.tools));
    expect(tools.filter((t) => !covered.has(t))).toEqual([]);
    expect(new Set(CASES.map((c) => c.tool))).toEqual(new Set(tools));
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
