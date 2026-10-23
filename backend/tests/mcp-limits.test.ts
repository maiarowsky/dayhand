// Calls per API key: 60 changes and 120 reads a minute, refused with a
// readable error and Retry-After.
import { describe, expect, test } from "vitest";
import { callTool, createKey, mcpClient, mcpPost, newUserId } from "./helpers";

const WRITES = 60;
const READS = 120;

const toolCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("call limits per key", () => {
  test("the 61st change in a minute is refused with rate_limited and Retry-After; reads go on", async () => {
    const key = await createKey(newUserId());
    const client = await mcpClient(key);
    const task = await callTool(client, "add_task", { title: "Toggle me" });
    for (let i = 1; i < WRITES; i++) {
      await callTool(client, "set_status", { taskId: task.id, status: i % 2 ? "doing" : "todo" });
    }
    const refused = await mcpPost(key, toolCall(2, "set_status", { taskId: task.id, status: "todo" }));
    expect(refused.status).toBe(200);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    const body = await refused.json();
    expect(body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/Too many changes with this API key: at most 60 a minute\. Try again in \d+ s\./) }],
      structuredContent: { error: { code: "rate_limited", retryAfterMs: expect.any(Number) } },
    });
    expect(body.result.structuredContent.error.retryAfterMs).toBeLessThanOrEqual(60_000);

    // The refused change did not happen, reads still work, and another key has its own budget.
    const details = await callTool(client, "get_task", { taskId: task.id });
    expect(details.history).toHaveLength(WRITES);
    const other = await mcpClient(await createKey(newUserId()));
    await callTool(other, "add_task", { title: "Fine" });
    await client.close();
    await other.close();
  });

  test("reads of data over the limit get HTTP 429 outside tools too", async () => {
    const key = await createKey(newUserId());
    for (let i = 0; i < READS; i++) {
      const ok = await mcpPost(key, toolCall(i, "get_settings", {}));
      expect(ok.status).toBe(200);
    }
    const tool = await (await mcpPost(key, toolCall(500, "list_today", {}))).json();
    expect(tool.result.structuredContent.error).toMatchObject({ code: "rate_limited", message: /Too many reads/ });
    const resource = await mcpPost(key, { jsonrpc: "2.0", id: 501, method: "resources/read", params: { uri: "helm://today" } });
    expect(resource.status).toBe(429);
    expect(resource.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await resource.json()).toMatchObject({ id: 501, error: { code: 429, message: /Too many reads/, data: { retryAfterMs: expect.any(Number) } } });
    // Static lists and the guide are not counted.
    const guide = await mcpPost(key, { jsonrpc: "2.0", id: 502, method: "resources/read", params: { uri: "helm://guide" } });
    expect(guide.status).toBe(200);
    const tools = await mcpPost(key, { jsonrpc: "2.0", id: 503, method: "tools/list" });
    expect(tools.status).toBe(200);
  });
});
