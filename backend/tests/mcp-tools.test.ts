// The tool catalog: titles, behaviour hints, output schemas that every result
// (and every tool error) satisfies, and dry runs that change nothing.
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { renderModule } from "../scripts/gen-output-schemas.mjs";
import { appClient, callTool, createKey, mcpClient, newUserId, openApiChecker, rest } from "./helpers";

const ORDER = [
  "add_task",
  "update_task",
  "set_status",
  "set_now",
  "complete_task",
  "reschedule_task",
  "archive_task",
  "delete_task",
  "restore_task",
  "list_today",
  "list_all",
  "list_projects",
  "add_project",
  "update_project",
  "delete_project",
  "list_trash",
  "board",
  "get_task",
  "export_plan",
  "get_settings",
  "update_settings",
  "list_events",
  "claim_task",
  "renew_claim",
  "release_task",
  "request_approval",
  "get_approval",
  "list_approvals",
  "decide_approval",
  "get_agent_controls",
  "pause_agents",
  "set_tool_policy",
  "accept_proposal",
  "merge_proposal",
  "reject_proposal",
  "agent_brief",
  "import_backlog",
  "export_backlog",
  "plan_health",
];
type McpClient = Awaited<ReturnType<typeof mcpClient>>;

/** A tool call whose result (or tool error) is checked against the tool's outputSchema with Ajv. */
async function checkedCalls(client: McpClient) {
  // listTools makes the SDK client check every later result against its outputSchema too.
  const { tools } = await client.listTools();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validators = new Map(tools.map((t) => [t.name, ajv.compile(t.outputSchema!)]));
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const validate = validators.get(name)!;
    expect(validate(result.structuredContent), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    return result.structuredContent as any;
  };
}

const READ_ONLY = ["list_today", "list_all", "list_projects", "list_trash", "board", "get_task", "export_plan", "get_settings", "list_events", "get_approval", "list_approvals", "get_agent_controls", "agent_brief", "export_backlog", "plan_health"];

describe("tool catalog", () => {
  test("every tool has a title, all four hints and an object output schema, in a fixed order", async () => {
    // A cli key is the owner: it sees every tool, the owner's own too (agents do not).
    const client = await mcpClient(await createKey(newUserId(), "laptop", "cli"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(ORDER);
    expect((await client.listTools()).tools).toEqual(tools);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations).toEqual({
        title: tool.title,
        readOnlyHint: READ_ONLY.includes(tool.name),
        destructiveHint: ["delete_task", "delete_project", "update_settings", "reject_proposal"].includes(tool.name),
        idempotentHint: !["add_task", "add_project"].includes(tool.name),
        openWorldHint: false,
      });
      expect(tool.outputSchema).toMatchObject({ type: "object", anyOf: expect.any(Array), $defs: expect.any(Object) });
      expect(JSON.stringify(tool.outputSchema)).not.toMatch(/"\$ref":"(?!#\/\$defs\/)/);
      const writes = !READ_ONLY.includes(tool.name);
      expect(Object.keys(tool.inputSchema.properties ?? {}).includes("dryRun"), tool.name).toBe(writes);
    }
    await client.close();
  });

  test("the generated output schemas match docs/schemas", () => {
    const generated = readFileSync(new URL("../convex/lib/outputSchemas.ts", import.meta.url), "utf8");
    expect(generated).toBe(renderModule());
  });

  test("every tool's result and a tool error satisfy its outputSchema", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const call = await checkedCalls(client);

    const task = await call("add_task", { title: "Water plants", dueDate: "today", repeat: { every: "week", interval: 1 } });
    await call("update_task", { taskId: task.id, note: "the balcony ones" });
    await call("set_status", { taskId: task.id, status: "doing" });
    await call("set_now", { taskId: task.id, resumeNote: "fill the can" });
    await call("set_now", { taskId: null });
    await call("list_today");
    await call("list_all");
    await call("list_all", { limit: 1 });
    await call("board");
    await call("get_task", { taskId: task.id });
    const done = await call("complete_task", { taskId: task.id });
    expect(done.next).toMatchObject({ title: "Water plants" });
    await call("reschedule_task", { taskId: done.next.id, dueDate: "tomorrow", dueTime: "09:00" });
    await call("archive_task", { taskId: done.next.id });
    await call("delete_task", { taskId: done.next.id });
    await call("list_trash");
    await call("restore_task", { taskId: done.next.id });
    await call("export_plan", { format: "markdown" });
    await call("export_plan", { format: "json" });
    await call("get_settings");
    await call("update_settings", { summaryTime: "06:30" });
    await call("add_task", { title: "Preview", dryRun: true });
    const failed = await call("get_task", { taskId: "#404" });
    expect(failed).toEqual({ error: { code: "not_found", message: "Task #404 not found" } });
    await client.close();
  });

  test("a Markdown export also has structured content", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const result = await client.callTool({ name: "export_plan", arguments: { format: "markdown" } });
    const text = (result.content as any)[0].text as string;
    expect(text).toMatch(/^# Dayhand plan/);
    expect(result.structuredContent).toEqual({ format: "markdown", content: text });
    await client.close();
  });
});

describe("project tools", () => {
  test("delete_project is the owner's: agents neither see nor call it; a cli key does", async () => {
    const userId = newUserId();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    const seen = (await agent.listTools()).tools.map((t) => t.name);
    expect(seen).toEqual(expect.arrayContaining(["list_projects", "add_project", "update_project"]));
    expect(seen).not.toContain("delete_project");
    const garden = await callTool(agent, "add_project", { name: "Garden" });
    const refused = await agent.callTool({ name: "delete_project", arguments: { projectId: garden.project.id } });
    expect(refused.structuredContent).toMatchObject({ error: { code: "forbidden" } });

    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const tools = Object.fromEntries((await cli.listTools()).tools.map((t) => [t.name, t])) as Record<string, any>;
    expect(Object.keys(tools)).toContain("delete_project");
    // Changes the owner's policy can hold back take approvalId; the owner's own tool does not.
    expect(tools.add_project.inputSchema.properties).toHaveProperty("approvalId");
    expect(tools.delete_project.inputSchema.properties).not.toHaveProperty("approvalId");
    expect(tools.add_project.inputSchema.required).toEqual(["name"]);
    expect(tools.add_project.inputSchema.properties.color.enum).toHaveLength(12);
    expect(tools.update_project.inputSchema.properties.color.anyOf).toEqual([expect.objectContaining({ enum: expect.any(Array) }), { type: "null" }]);
    // Labels are gone (0.14.0): still accepted from older clients, but no schema offers them.
    for (const name of ["add_task", "update_task", "list_all"]) expect(tools[name].inputSchema.properties, name).not.toHaveProperty("labels");
    expect(tools.add_project.inputSchema.properties).not.toHaveProperty("fromLabel");
    expect(tools.add_project.inputSchema.properties).not.toHaveProperty("removeLabel");
    for (const name of ["add_task", "update_task", "list_all", "list_today", "board", "import_backlog", "export_backlog"]) {
      expect(tools[name].inputSchema.properties.projectId.description, name).toMatch(/project/);
    }
    expect(await callTool(cli, "delete_project", { projectId: "garden" })).toMatchObject({ project: { name: "Garden" }, moved: [] });
    await Promise.all([agent.close(), cli.close()]);
  });

  test("ask on add_project waits without writing; the same REST call waits on the same approval", async () => {
    const { client: app, userId } = await appClient();
    const key = await createKey(userId, "planner", "agent");
    const agent = await mcpClient(key);
    const call = await checkedCalls(agent);
    const keys = await app.query(api.app.listApiKeys, {});
    const planner = keys.find((k) => k.name === "planner")!;
    await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "add_project", rule: "ask" });
    const input = { name: "Bakery site", color: "amber" };
    const preview = await call("add_project", { ...input, dryRun: true });
    expect(preview).toMatchObject({ project: { name: input.name }, dryRun: true });
    const { error } = await call("add_project", input);
    expect(error).toMatchObject({ code: "approval_required", approvalId: expect.any(String) });
    expect((await call("add_project", input)).error.approvalId).toBe(error.approvalId);
    expect((await call("list_projects")).result).toEqual([]);

    const { conforms } = await openApiChecker();
    const refused = await rest(key, "POST", "/projects", { body: input });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: error.code, detail: error.message, approvalId: error.approvalId });
    expect(conforms("POST", "/projects", refused)).toEqual([]);
    const approval = await call("get_approval", { approvalId: error.approvalId });
    expect(approval).toMatchObject({ source: "policy", tool: "add_project", status: "pending" });
    expect(JSON.parse(approval.arguments)).toEqual(input);
    await app.mutation(api.app.decideApproval, { approvalId: error.approvalId, optionId: "allow" });
    expect(await call("add_project", { ...input, approvalId: error.approvalId })).toMatchObject({ project: { name: input.name } });
    expect((await call("get_approval", { approvalId: error.approvalId })).used).toBe(true);
    expect((await call("list_projects")).result).toHaveLength(1);
    await agent.close();
  });

  test("project changes obey wildcard deny and pause; owner changes and reads still work", async () => {
    const { client: app, userId } = await appClient();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const call = await checkedCalls(agent);
    const { project } = await call("add_project", { name: "Allowed by default" });
    const keys = await app.query(api.app.listApiKeys, {});
    await app.mutation(api.app.setToolPolicy, { apiKeyId: keys.find((k) => k.name === "planner")!.id, toolName: "*", rule: "deny" });
    expect(await call("add_project", { name: "Denied" })).toMatchObject({ error: { code: "forbidden" } });
    expect(await call("update_project", { projectId: project.id, note: "Denied" })).toMatchObject({ error: { code: "forbidden" } });
    await app.mutation(api.app.pauseAgents, { paused: true });
    expect(await call("add_project", { name: "Paused", dryRun: true })).toMatchObject({ error: { code: "agents_paused" } });
    expect(await call("update_project", { projectId: project.id, note: "Paused" })).toMatchObject({ error: { code: "agents_paused" } });
    expect((await call("list_projects")).result.map((p: any) => p.name)).toEqual(["Allowed by default"]);
    expect(await callTool(cli, "update_project", { projectId: project.id, note: "Owner" })).toMatchObject({ note: "Owner" });
    expect(await callTool(cli, "delete_project", { projectId: project.id })).toMatchObject({ project: { note: "Owner" }, moved: [] });
    await Promise.all([agent.close(), cli.close()]);
  });

  test("every result of the project tools, and of task tools with a project, satisfies its outputSchema", async () => {
    const client = await mcpClient(await createKey(newUserId(), "laptop", "cli"));
    const call = await checkedCalls(client);
    expect(await call("list_projects")).toEqual({ result: [], noProject: { open: 0, overdue: 0 } });
    await call("add_task", { title: "Fix the oven", dueDate: "2020-01-02" });
    await call("add_task", { title: "Menu photos", dueDate: "today" });
    const home = await call("add_project", { name: "Home", color: "green", icon: "🏠", note: "The flat", clientId: "p-home" });
    expect(home).toEqual({
      project: expect.objectContaining({ name: "Home", color: "green", icon: "🏠", note: "The flat", position: 1024, archived: false, clientId: "p-home" }),
    });
    expect((await call("update_task", { taskId: "#2", projectId: "home" })).projectId).toBe(home.project.id);

    const preview = await call("add_project", { name: "Bakery", dryRun: true });
    expect(preview).toEqual({ project: expect.objectContaining({ name: "Bakery" }), dryRun: true });
    // fromLabel and removeLabel from a client older than 0.14.0 are accepted and ignored.
    const bakery = await call("add_project", { name: "Bakery", fromLabel: "bakery", removeLabel: true });
    expect(bakery).toEqual({ project: expect.objectContaining({ name: "Bakery" }) });
    await call("update_task", { taskId: "#1", projectId: "Bakery" });
    const listed = await call("list_projects");
    expect(listed.result.map((p: any) => [p.name, p.counts])).toEqual([
      ["Home", { open: 1, overdue: 0, dueToday: 1, done: 0 }],
      ["Bakery", { open: 1, overdue: 1, dueToday: 0, done: 0 }],
    ]);
    expect(listed.noProject).toEqual({ open: 0, overdue: 0 });

    expect((await call("add_task", { title: "Bread order", projectId: "BAKERY" })).projectId).toBe(bakery.project.id);
    const refs = (tasks: { ref: number }[]) => tasks.map((t) => t.ref).sort((a, b) => a - b);
    expect(refs((await call("list_all", { projectId: "bakery" })).result)).toEqual([1, 3]);
    expect((await call("list_all", { projectId: "none", limit: 5 })).total).toBe(0);
    expect((await call("list_today", { projectId: "Home" })).today.map((t: any) => t.ref)).toEqual([2]);
    expect(refs((await call("board", { projectId: bakery.project.id })).todo)).toEqual([1, 3]);

    const renamed = await call("update_project", { projectId: "Bakery", name: "Bakery site", icon: "🥐", color: "amber" });
    expect(renamed).toMatchObject({ name: "Bakery site", icon: "🥐", color: "amber" });
    expect(await call("update_project", { projectId: "bakery site", color: null })).not.toHaveProperty("color");
    expect(await call("update_project", { projectId: home.project.id, archived: true })).toMatchObject({ archived: true, archivedAt: expect.any(Number) });
    expect((await call("list_projects")).result.map((p: any) => p.name)).toEqual(["Bakery site"]);
    expect((await call("list_projects", { includeArchived: true })).result.map((p: any) => p.name)).toEqual(["Home", "Bakery site"]);
    expect((await call("agent_brief")).projects).toMatchObject({ count: 1, items: [{ name: "Bakery site", counts: { open: 2 } }] });
    expect((await call("export_plan", { format: "json" })).content.projects.map((p: any) => p.name)).toEqual(["Home", "Bakery site"]);
    const imported = await call("import_backlog", { files: [{ path: "tasks/task-1 - Flyers.md", content: "---\nid: TASK-1\ntitle: Flyers\nstatus: To Do\n---\n" }], projectId: "Bakery site" });
    expect(imported.tasks[0].projectId).toBe(bakery.project.id);
    const exported = await call("export_backlog", { projectId: "bakery site" });
    expect(exported.total).toBe(3);
    expect(exported.config.content).toMatch(/^project_name: '?Bakery site'?$/m);

    // Errors pass the schema too, including input validation on a read tool.
    expect(await call("list_projects", { includeArchived: "yes" })).toMatchObject({ error: { code: "invalid_argument" } });
    expect(await call("add_project", { name: "bakery site" })).toMatchObject({ error: { code: "invalid_argument" } });
    expect(await call("update_project", { projectId: "Bakery site", note: "Preview", dryRun: true })).toMatchObject({ note: "Preview", dryRun: true });
    expect(await call("add_task", { title: "Paint", projectId: "Home" })).toEqual({
      error: { code: "invalid_argument", message: 'Project "Home" is archived; restore it first' },
    });
    expect(await call("delete_project", { projectId: "Bakery site" })).toEqual({
      error: { code: "precondition_failed", message: 'Project "Bakery site" has 3 tasks: pass moveTasksTo, a project or "none"' },
    });
    const dry = await call("delete_project", { projectId: "Bakery site", moveTasksTo: "none", dryRun: true });
    expect(dry).toMatchObject({ project: { name: "Bakery site" }, dryRun: true });
    expect(dry.moved).toHaveLength(3);
    const deleted = await call("delete_project", { projectId: "Bakery site", moveTasksTo: "none", clientId: "p-del" });
    expect(deleted.moved.map((t: any) => t.ref)).toEqual([1, 3, 4]);
    expect(await call("delete_project", { projectId: "Bakery site", moveTasksTo: "none", clientId: "p-del" })).toEqual(deleted);
    expect(await call("update_project", { projectId: "Bakery site", name: "Again" })).toEqual({ error: { code: "not_found", message: 'Project "Bakery site" not found' } });
    expect((await call("list_projects")).noProject).toEqual({ open: 3, overdue: 1 });
    await client.close();
  });
});

describe("dry runs", () => {
  test("a dry run returns what the change would produce and saves nothing", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const preview = await client.callTool({ name: "add_task", arguments: { title: "Call the accountant", dueDate: "today", dryRun: true } });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({ title: "Call the accountant", status: "todo", ref: 1, dryRun: true });
    expect(JSON.parse((preview.content as any)[0].text)).toMatchObject({ dryRun: true });
    expect(await callTool(client, "list_all")).toEqual([]);
    const exported = await callTool(client, "export_plan", { format: "json" });
    expect(exported.content.events.filter((e: { action: string }) => !e.action.startsWith("apiKey."))).toEqual([]);

    // The number was not used up: the real task gets #1.
    const real = await callTool(client, "add_task", { title: "Call the accountant" });
    expect(real.ref).toBe(1);
    await client.close();
  });

  test("every check runs: a bad change fails its dry run like the real one", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const bad = await client.callTool({ name: "add_task", arguments: { title: "x", dueDate: "someday", dryRun: true } });
    expect(bad.structuredContent).toMatchObject({ error: { code: "invalid_argument", message: /dueDate must be/ } });
    const missing = await client.callTool({ name: "delete_task", arguments: { taskId: "#9", dryRun: true } });
    expect(missing.structuredContent).toMatchObject({ error: { code: "not_found" } });
    await client.close();
  });

  test("dry runs of changes to existing tasks leave them and their history as they were", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const task = await callTool(client, "add_task", { title: "Weekly report", dueDate: "today", repeat: { every: "week", interval: 1 } });
    const before = await callTool(client, "get_task", { taskId: "#1" });

    const done = await client.callTool({ name: "complete_task", arguments: { taskId: "#1", dryRun: true } });
    expect(done.structuredContent).toMatchObject({ task: { status: "done" }, next: { title: "Weekly report", ref: 2 }, dryRun: true });
    const deleted = await client.callTool({ name: "delete_task", arguments: { taskId: task.id, dryRun: true } });
    expect(deleted.structuredContent).toMatchObject({ deletedAt: expect.any(Number), dryRun: true });
    const cleared = await client.callTool({ name: "set_now", arguments: { taskId: null, dryRun: true } });
    expect(cleared.structuredContent).toEqual({ result: null, dryRun: true });
    const settings = await client.callTool({ name: "update_settings", arguments: { timezone: "Europe/Warsaw", dryRun: true } });
    expect(settings.structuredContent).toMatchObject({ timezone: "Europe/Warsaw", dryRun: true });

    expect(await callTool(client, "get_task", { taskId: "#1" })).toEqual(before);
    expect(await callTool(client, "list_all")).toHaveLength(1);
    expect(await callTool(client, "get_settings")).toMatchObject({ timezone: "Europe/London" });
    await client.close();
  });
});
