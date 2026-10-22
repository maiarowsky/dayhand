// Export of the whole plan as Markdown and JSON.
import { expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { appClient, asUser, callTool, createKey, mcpClient, newUserId, utc } from "./helpers";

test("Markdown export groups the plan into readable sections", async () => {
  const user = asUser(newUserId());
  const now: any = await user.mutation(internal.ops.add, { title: "Focus task", dueDate: "2026-10-22" });
  await user.mutation(internal.ops.setNow, { taskId: now.id, resumeNote: "continue at section 2" });
  await user.mutation(internal.ops.add, { title: "Overdue call", dueDate: "2026-10-20", labels: ["phone"] });
  await user.mutation(internal.ops.add, { title: "Meeting", dueDate: "2026-10-22", dueTime: "13:15" });
  await user.mutation(internal.ops.add, { title: "Later", dueDate: "2026-11-01", links: [{ url: "https://example.com", title: "Spec" }] });
  await user.mutation(internal.ops.add, { title: "Someday", note: "line one\nline two" });
  const trashed: any = await user.mutation(internal.ops.add, { title: "Trashed" });
  await user.mutation(internal.ops.softDelete, { taskId: trashed.id });

  const { content }: any = await user.query(internal.ops.exportPlan, { format: "markdown", at: utc("2026-10-22T10:00") });
  expect(content).toContain("# Helm plan");
  expect(content).toMatch(/## Now\n\n- \[ \] 2026-10-22 Focus task \(in progress\)\n  - Next step: continue at section 2/);
  expect(content).toMatch(/## Overdue\n\n- \[ \] 2026-10-20 Overdue call #phone/);
  // Timed tasks first, as on the Today screen.
  expect(content).toMatch(/## Today \(2026-10-22\)\n\n- \[ \] 2026-10-22 13:15 Meeting\n- \[ \] 2026-10-22 Focus task/);
  expect(content).toMatch(/## Upcoming\n\n- \[ \] 2026-11-01 Later\n  - \[Spec\]\(https:\/\/example.com\)/);
  expect(content).toMatch(/## No date\n\n- \[ \] Someday\n  > line one\n  > line two/);
  expect(content).not.toContain("Trashed");
});

test("JSON export is a full copy with settings, every task (trash included) and history", async () => {
  const userId = newUserId();
  const user = asUser(userId);
  await user.mutation(internal.ops.updateSettings, { timezone: "Europe/Warsaw" });
  const a: any = await user.mutation(internal.ops.add, { title: "A", repeat: { every: "week", interval: 1, weekdays: [1] } });
  const b: any = await user.mutation(internal.ops.add, { title: "B" });
  await user.mutation(internal.ops.softDelete, { taskId: b.id });

  const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
  expect(content.version).toBe(1);
  expect(content.settings).toMatchObject({ timezone: "Europe/Warsaw", summaryTime: "05:00" });
  expect(content.tasks.map((t: any) => t.id).sort()).toEqual([a.id, b.id].sort());
  expect(content.tasks.find((t: any) => t.id === a.id).repeat).toEqual({ every: "week", interval: 1, weekdays: [1] });
  expect(content.events.map((e: any) => e.action)).toEqual(["settings.update", "create", "create", "delete"]);
  expect(JSON.stringify(content)).not.toContain(userId);
});

test("export through MCP returns Markdown text, and through the app the same content", async () => {
  const { client: app, userId } = await appClient();
  await app.mutation(api.app.add, { title: "Shared", dueDate: "today" });
  const agent = await mcpClient(await createKey(userId));
  const markdown = await callTool<string>(agent, "export_plan", { format: "markdown" });
  expect(markdown).toMatch(/## Today \(\d{4}-\d{2}-\d{2}\)\n\n- \[ \] \d{4}-\d{2}-\d{2} Shared/);
  const json = await callTool(agent, "export_plan", { format: "json" });
  expect(json.content.tasks.map((t: any) => t.title)).toEqual(["Shared"]);
  const fromApp = await app.query(api.app.exportPlan, { format: "json" });
  expect(fromApp.content).toMatchObject({ tasks: json.content.tasks });
});
