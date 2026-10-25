// Export of the whole plan as Markdown and JSON.
import { expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { appClient, asUser, callTool, createKey, mcpClient, newUserId, rest, utc } from "./helpers";

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
  expect(content).toContain("# Dayhand plan");
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

test("exports carry projects; a JSON export imported elsewhere makes them again by name (0.13.0)", async () => {
  const source = asUser(newUserId());
  await source.mutation(internal.ops.addProject, { name: "Strona piekarni", color: "amber", icon: "🥐", note: "Site and menu" });
  await source.mutation(internal.ops.addProject, { name: "Old" });
  await source.mutation(internal.ops.addProject, { name: "Empty" });
  await source.mutation(internal.ops.add, { title: "Menu", dueDate: "2026-10-22", labels: ["web"], projectId: "Strona piekarni" });
  await source.mutation(internal.ops.add, { title: "Old thing", projectId: "Old" });
  await source.mutation(internal.ops.add, { title: "Loose" });
  await source.mutation(internal.ops.updateProject, { projectId: "Old", archived: true });

  const markdown: any = await source.query(internal.ops.exportPlan, { format: "markdown", at: utc("2026-10-22T10:00") });
  expect(markdown.content).toContain("- [ ] 2026-10-22 Menu +Strona-piekarni #web");
  const { content }: any = await source.query(internal.ops.exportPlan, { format: "json" });
  expect(content.version).toBe(1);
  expect(content.projects.map((p: any) => [p.name, p.archived])).toEqual([
    ["Strona piekarni", false],
    ["Old", true],
    ["Empty", false],
  ]);

  // Into an empty account: the projects come back by name, with color, icon, note and archive.
  const emptyId = newUserId();
  const intoEmpty = await rest(await createKey(emptyId, "cli", "cli"), "POST", "/import", { body: { content: JSON.stringify(content) } });
  expect(intoEmpty.status).toBe(200);
  const made: any = await asUser(emptyId).query(internal.ops.listProjects, { includeArchived: true });
  expect(made.result.map((p: any) => ({ name: p.name, color: p.color, icon: p.icon, note: p.note, archived: p.archived }))).toEqual([
    { name: "Strona piekarni", color: "amber", icon: "🥐", note: "Site and menu", archived: false },
    { name: "Old", archived: true },
    { name: "Empty", archived: false },
  ]);
  const projectOf = (tasks: any[], title: string) => made.result.find((p: any) => p.id === tasks.find((t) => t.title === title).projectId)?.name ?? null;
  const tasks: any[] = await asUser(emptyId).query(internal.ops.listAll, { includeArchived: true });
  expect(["Menu", "Old thing", "Loose"].map((title) => projectOf(tasks, title))).toEqual(["Strona piekarni", "Old", null]);

  // Into an account that has the project already, in another case: no second one.
  const otherId = newUserId();
  const existing: any = (await asUser(otherId).mutation(internal.ops.addProject, { name: "strona PIEKARNI" })).project;
  expect((await rest(await createKey(otherId, "cli", "cli"), "POST", "/import", { body: { content: JSON.stringify(content) } })).status).toBe(200);
  const other: any = await asUser(otherId).query(internal.ops.listProjects, { includeArchived: true });
  expect(other.result.map((p: any) => p.name)).toEqual(["strona PIEKARNI", "Old", "Empty"]);
  const menu = ((await asUser(otherId).query(internal.ops.listAll, {})) as any[]).find((t) => t.title === "Menu");
  expect(menu.projectId).toBe(existing.id);
});
