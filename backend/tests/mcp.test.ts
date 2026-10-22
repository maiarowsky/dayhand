// The MCP endpoint through the official @modelcontextprotocol/sdk client.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, callTool, createKey, mcpClient, mcpUrl, newUserId } from "./helpers";

const EXPECTED_TOOLS = [
  "add_task",
  "archive_task",
  "board",
  "complete_task",
  "delete_task",
  "export_plan",
  "get_settings",
  "get_task",
  "list_all",
  "list_today",
  "list_trash",
  "reschedule_task",
  "restore_task",
  "set_now",
  "set_status",
  "update_settings",
  "update_task",
];

const rpc = (key: string | null, body: unknown, extraHeaders: Record<string, string> = {}) =>
  fetch(mcpUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

describe("MCP over Streamable HTTP", () => {
  test("initialize, list tools with schemas, and run a task through its life", async () => {
    const userId = newUserId();
    const client = await mcpClient(await createKey(userId));
    expect(client.getServerVersion()).toMatchObject({ name: "helm" });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    const add = tools.find((t) => t.name === "add_task")!;
    expect(add.description).toBeTruthy();
    expect(add.inputSchema).toMatchObject({ type: "object", required: ["title"] });
    expect(add.inputSchema.properties).not.toHaveProperty("userId");
    expect(add.inputSchema.properties).not.toHaveProperty("actor");

    const task = await callTool(client, "add_task", { title: "Call the accountant", dueDate: "today", labels: ["admin"] });
    await callTool(client, "set_now", { taskId: task.id, resumeNote: "find the invoice first" });
    const today = await callTool(client, "list_today");
    expect(today.now).toMatchObject({ id: task.id, resumeNote: "find the invoice first" });
    expect(today.today.map((t: any) => t.id)).toEqual([task.id]);

    await callTool(client, "complete_task", { taskId: task.id });
    const details = await callTool(client, "get_task", { taskId: task.id });
    expect(details.history.map((h: any) => h.actor)).toEqual(["agent", "agent", "agent"]);
    await client.close();
  });

  test("the agent cannot claim another identity through arguments", async () => {
    const userId = newUserId();
    const victim = newUserId();
    const client = await mcpClient(await createKey(userId));
    const result = await client.callTool({ name: "add_task", arguments: { title: "x", userId: victim, actor: "app" } });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toMatch(/set by the server/);
    const victimTasks = await admin().query(internal.ops.listAll, { userId: victim, actor: "app" });
    expect(victimTasks).toEqual([]);
    await client.close();
  });

  test("domain and validation errors come back as tool errors without internals", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const bad = await client.callTool({ name: "add_task", arguments: { title: "x", dueDate: "someday" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as any)[0].text).toMatch(/dueDate must be YYYY-MM-DD/);
    const missing = await client.callTool({ name: "get_task", arguments: {} });
    expect(missing.isError).toBe(true);
    expect((missing.content as any)[0].text).toMatch(/Invalid arguments/);
    await expect(client.callTool({ name: "no_such_tool", arguments: {} })).rejects.toThrow(/Unknown tool/);
    await client.close();
  });

  test("tool errors carry a code in structuredContent next to the text", async () => {
    const key = await createKey(newUserId());
    const client = await mcpClient(key);
    const notFound = await client.callTool({ name: "get_task", arguments: { taskId: "#404" } });
    expect(notFound).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Task #404 not found" }],
      structuredContent: { error: { code: "not_found", message: "Task #404 not found" } },
    });
    const badDate = await client.callTool({ name: "add_task", arguments: { title: "x", dueDate: "someday" } });
    expect(badDate.structuredContent).toEqual({
      error: { code: "invalid_argument", message: (badDate.content as any)[0].text },
    });
    expect((badDate.content as any)[0].text).toMatch(/dueDate must be YYYY-MM-DD/);
    const missing = await client.callTool({ name: "get_task", arguments: {} });
    expect(missing.structuredContent).toMatchObject({ error: { code: "invalid_argument", message: /Invalid arguments/ } });
    const identity = await client.callTool({ name: "add_task", arguments: { title: "x", actor: "app" } });
    expect(identity.structuredContent).toMatchObject({ error: { code: "invalid_argument", message: /set by the server/ } });
    const notObject = await rpc(key, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_all", arguments: [] },
    });
    expect(await notObject.json()).toMatchObject({
      result: { isError: true, structuredContent: { error: { code: "invalid_argument" } } },
    });
    await client.close();
  });

  test("serverInfo.version is the backend package version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const client = await mcpClient(await createKey(newUserId()));
    expect(client.getServerVersion()).toEqual({ name: "helm", version: pkg.version });
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    await client.close();
  });

  test("idempotent add through MCP with a clientId", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const a = await callTool(client, "add_task", { title: "once", clientId: "mcp-1" });
    const b = await callTool(client, "add_task", { title: "once", clientId: "mcp-1" });
    expect(b.id).toBe(a.id);
    expect(await callTool(client, "list_all")).toHaveLength(1);
    await client.close();
  });

  test("notifications get 202, GET gets 405, unknown methods get JSON-RPC errors", async () => {
    const key = await createKey(newUserId());
    const note = await rpc(key, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    const get = await fetch(mcpUrl(), { headers: { Authorization: `Bearer ${key}` } });
    expect(get.status).toBe(405);
    const unknown = await rpc(key, { jsonrpc: "2.0", id: 7, method: "resources/list" });
    expect(unknown.headers.get("content-type")).toMatch(/application\/json/);
    expect(await unknown.json()).toMatchObject({ id: 7, error: { code: -32601 } });
  });
});

describe("MCP authentication", () => {
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

  test("missing or wrong key gets HTTP 401", async () => {
    expect((await rpc(null, initialize)).status).toBe(401);
    const wrong = await rpc("helm_not-a-real-key", initialize);
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  test("a revoked key gets HTTP 401 and the SDK client cannot connect", async () => {
    const userId = newUserId();
    const key = await createKey(userId);
    expect((await rpc(key, initialize)).status).toBe(200);

    const [stored] = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as any[];
    await admin().mutation(internal.apiKeys.revoke, { userId, actor: "app", keyId: stored.id });

    expect((await rpc(key, initialize)).status).toBe(401);
    await expect(mcpClient(key)).rejects.toThrow();
  });

  test("only the hash of a key is stored", async () => {
    const userId = newUserId();
    const key = await createKey(userId, "laptop");
    const exported: any = await admin().query(internal.ops.exportPlan, { userId, actor: "app", format: "json" });
    expect(JSON.stringify(exported)).not.toContain(key);
    const listed = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as any[];
    expect(listed).toEqual([
      { id: expect.any(String), name: "laptop", kind: "agent", createdAt: expect.any(Number), revokedAt: null },
    ]);
    expect(JSON.stringify(listed)).not.toContain(key);
  });
});
