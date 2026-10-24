// The tool catalog: titles, behaviour hints, output schemas that every result
// (and every tool error) satisfies, and dry runs that change nothing.
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { renderModule } from "../scripts/gen-output-schemas.mjs";
import { callTool, createKey, mcpClient, newUserId } from "./helpers";

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
  "list_trash",
  "board",
  "get_task",
  "export_plan",
  "get_settings",
  "update_settings",
];
const READ_ONLY = ["list_today", "list_all", "list_trash", "board", "get_task", "export_plan", "get_settings"];

describe("tool catalog", () => {
  test("every tool has a title, all four hints and an object output schema, in a fixed order", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(ORDER);
    expect((await client.listTools()).tools).toEqual(tools);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations).toEqual({
        title: tool.title,
        readOnlyHint: READ_ONLY.includes(tool.name),
        destructiveHint: ["delete_task", "update_settings"].includes(tool.name),
        idempotentHint: tool.name !== "add_task",
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
    // listTools makes the SDK client check every later result against its outputSchema too.
    const { tools } = await client.listTools();
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validators = new Map(tools.map((t) => [t.name, ajv.compile(t.outputSchema!)]));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const validate = validators.get(name)!;
      expect(validate(result.structuredContent), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      return result.structuredContent as any;
    };

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
