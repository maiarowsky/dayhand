// Resources (dayhand://today, dayhand://projects, dayhand://tasks/{ref}, dayhand://guide) and the prompts.
import { describe, expect, test } from "vitest";
import { callTool, createKey, mcpClient, mcpPost, modern, newUserId, rest } from "./helpers";

const textOf = (contents: object[]) => (contents[0] as { text: string }).text;

describe("MCP resources", () => {
  test("the server lists its resources and the task template", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "dayhand://today",
      "dayhand://projects",
      "dayhand://activity",
      "dayhand://guide",
      "dayhand://workflow/intake",
      "dayhand://workflow/execution",
      "dayhand://workflow/finalization",
    ]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates).toEqual([
      expect.objectContaining({ uriTemplate: "dayhand://activity{?since}", mimeType: "application/json" }),
      expect.objectContaining({ uriTemplate: "dayhand://tasks/{ref}", mimeType: "application/json" }),
    ]);
    await client.close();
  });

  test("dayhand://today is list_today and dayhand://tasks/{ref} is get_task", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    await callTool(client, "add_task", { title: "Call the accountant", dueDate: "today" });
    await callTool(client, "set_now", { taskId: "#1", resumeNote: "find the invoice" });

    const today = await client.readResource({ uri: "dayhand://today" });
    expect(today.contents[0]).toMatchObject({ uri: "dayhand://today", mimeType: "application/json" });
    expect(JSON.parse(textOf(today.contents))).toEqual(await callTool(client, "list_today"));

    const task = await client.readResource({ uri: "dayhand://tasks/1" });
    expect(JSON.parse(textOf(task.contents))).toEqual(await callTool(client, "get_task", { taskId: "#1" }));
    await client.close();
  });

  test("dayhand://projects is list_projects, a private read counted against the shared limit", async () => {
    const key = await createKey(newUserId());
    const client = await mcpClient(key);
    const empty = await client.readResource({ uri: "dayhand://projects" });
    expect(empty.contents[0]).toMatchObject({ uri: "dayhand://projects", mimeType: "application/json" });
    expect(JSON.parse(textOf(empty.contents))).toEqual({ result: [], noProject: { open: 0, overdue: 0 } });
    const afterRead = await rest(key, "GET", "/projects");
    expect(afterRead.status).toBe(200);
    expect(afterRead.headers.get("x-ratelimit-remaining")).toBe("118");

    await callTool(client, "add_project", { name: "Garden", icon: "🌱" });
    await callTool(client, "add_project", { name: "Old flat" });
    await callTool(client, "update_project", { projectId: "Old flat", archived: true });
    await callTool(client, "add_task", { title: "Plant tulips", dueDate: "today", projectId: "garden" });
    await callTool(client, "add_task", { title: "Call the bank" });
    const projects = JSON.parse(textOf((await client.readResource({ uri: "dayhand://projects" })).contents));
    expect(projects).toEqual(await callTool(client, "list_projects"));
    expect(projects.result).toEqual([expect.objectContaining({ name: "Garden", icon: "🌱", counts: { open: 1, overdue: 0, dueToday: 1, done: 0 } })]);
    expect(projects.noProject).toEqual({ open: 1, overdue: 0 });
    const { body, headers } = modern("resources/read", { uri: "dayhand://projects" });
    const modernRead = await (await mcpPost(key, body, headers)).json();
    expect(modernRead.result).toMatchObject({ cacheScope: "private", ttlMs: 0 });
    expect(JSON.parse(modernRead.result.contents[0].text)).toEqual(projects);
    await client.close();
  });

  test("dayhand://guide is Markdown for agents", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const guide = await client.readResource({ uri: "dayhand://guide" });
    expect(guide.contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect(textOf(guide.contents)).toMatch(/^# Working with Dayhand/);
    expect(textOf(guide.contents)).toContain("dryRun");
    expect(textOf(guide.contents)).toContain("## Projects and labels");
    await client.close();
  });

  test("the helm:// addresses from before the rename still read the same resources", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    await callTool(client, "add_task", { title: "Water the plants", dueDate: "today" });
    const today = await client.readResource({ uri: "helm://today" });
    expect(today.contents[0]).toMatchObject({ uri: "helm://today", mimeType: "application/json" });
    expect(JSON.parse(textOf(today.contents))).toEqual(await callTool(client, "list_today"));
    const task = await client.readResource({ uri: "helm://tasks/1" });
    expect(JSON.parse(textOf(task.contents))).toEqual(await callTool(client, "get_task", { taskId: "#1" }));
    expect(textOf((await client.readResource({ uri: "helm://guide" })).contents)).toMatch(/^# Working with Dayhand/);
    await client.close();
  });

  test("a missing resource is a JSON-RPC error, -32002 for 2025 clients", async () => {
    const key = await createKey(newUserId());
    for (const uri of ["dayhand://tasks/404", "dayhand://nothing", "https://example.com/"]) {
      const response = await (await mcpPost(key, { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri } })).json();
      expect(response, uri).toMatchObject({ id: 1, error: { code: -32002, message: "Resource not found", data: { uri } } });
    }
  });
});

describe("MCP prompts", () => {
  test("four prompts with their arguments", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["plan_day", "weekly_review", "triage_overdue", "plan_health"]);
    expect(prompts[0]!.arguments).toEqual([{ name: "focus", description: expect.any(String), required: false }]);
    await client.close();
  });

  test("plan_day embeds the Today screen and the focus", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    await callTool(client, "add_task", { title: "Call the accountant", dueDate: "today" });
    const prompt = await client.getPrompt({ name: "plan_day", arguments: { focus: "taxes" } });
    expect(prompt.messages).toHaveLength(2);
    const [instructions, today] = prompt.messages as any[];
    expect(instructions.content.text).toMatch(/plan today/);
    expect(instructions.content.text).toContain("My focus today: taxes");
    expect(today.content).toMatchObject({ type: "resource", resource: { uri: "dayhand://today", mimeType: "application/json" } });
    expect(JSON.parse(today.content.resource.text).today[0]).toMatchObject({ title: "Call the accountant" });
    await client.close();
  });

  test("weekly_review names the days and triage_overdue lists the overdue tasks", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    await callTool(client, "add_task", { title: "Renew the passport", dueDate: "2020-01-01" });
    const review = await client.getPrompt({ name: "weekly_review" });
    expect((review.messages[0] as any).content.text).toMatch(/today is \d{4}-\d{2}-\d{2}, Europe\/London/);
    expect((review.messages[0] as any).content.text).toContain("call list_projects");
    const triage = await client.getPrompt({ name: "triage_overdue" });
    const listed = (triage.messages[1] as any).content.text as string;
    expect(listed).toContain("Renew the passport");
    await client.close();
  });

  test("unknown prompts and arguments are invalid params", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    await expect(client.getPrompt({ name: "nope" })).rejects.toThrow(/Unknown prompt/);
    await expect(client.getPrompt({ name: "weekly_review", arguments: { days: "3" } })).rejects.toThrow(/Unknown argument/);
    await client.close();
  });
});
