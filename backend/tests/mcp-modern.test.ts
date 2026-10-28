// MCP 2026-07-28 next to the 2025 revisions on the same endpoint: raw requests
// against the specification's rules, and the official v2 SDK client in both eras.
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "vitest";
import { callTool, createKey, mcpClient, mcpPost, mcpUrl, modern, MODERN, newUserId } from "./helpers";

const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

async function post(key: string, method: string, params: Record<string, unknown> = {}, change?: (h: Record<string, string>) => void) {
  const request = modern(method, params);
  change?.(request.headers);
  const response = await mcpPost(key, request.body, request.headers);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function v2Client(key: string, versionNegotiation?: { mode: "auto" | "legacy" | { pin: string } }) {
  const client = new ModernClient({ name: "helm-tests-v2", version: "0" }, versionNegotiation ? { versionNegotiation } : {});
  const transport = new ModernTransport(mcpUrl(), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  return { client, connect: () => client.connect(transport) };
}

describe("MCP 2026-07-28 on the wire", () => {
  test("server/discover lists both eras, the capabilities, the server and a cache hint", async () => {
    const { status, body } = await post(await createKey(newUserId()), "server/discover");
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [MODERN, "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"],
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: expect.stringContaining("list_today"),
      ttlMs: expect.any(Number),
      cacheScope: "public",
      _meta: { [SERVER_INFO_KEY]: { name: "dayhand", version: expect.any(String) } },
    });
  });

  test("results carry resultType and the server; lists and resources carry cache hints", async () => {
    const key = await createKey(newUserId());
    const tools = await post(key, "tools/list");
    // An agent's list leaves out the owner's tools (0.11.0), so it is the caller's own; a cli key's is everyone's.
    expect(tools.body.result).toMatchObject({ resultType: "complete", ttlMs: 300000, cacheScope: "private" });
    expect(tools.body.result.tools).toHaveLength(32);
    const owners = await post(await createKey(newUserId(), "laptop", "cli"), "tools/list");
    expect(owners.body.result).toMatchObject({ resultType: "complete", ttlMs: 300000, cacheScope: "public" });
    expect(owners.body.result.tools).toHaveLength(39);
    const added = await post(key, "tools/call", { name: "add_task", arguments: { title: "Modern" } });
    expect(added.body.result).toMatchObject({
      resultType: "complete",
      structuredContent: { title: "Modern", ref: 1 },
      _meta: { [SERVER_INFO_KEY]: { name: "dayhand" } },
    });
    expect(added.body.result).not.toHaveProperty("ttlMs");
    const today = await post(key, "resources/read", { uri: "dayhand://today" });
    expect(today.body.result).toMatchObject({ resultType: "complete", ttlMs: 0, cacheScope: "private" });
    for (const method of ["resources/list", "resources/templates/list", "prompts/list"]) {
      expect((await post(key, method)).body.result, method).toMatchObject({ resultType: "complete", cacheScope: "public" });
    }
    const prompt = await post(key, "prompts/get", { name: "weekly_review" });
    expect(prompt.body.result).toMatchObject({ resultType: "complete", messages: expect.any(Array) });
  });

  test("missing or mismatched standard headers are 400 HeaderMismatch (-32020)", async () => {
    const key = await createKey(newUserId());
    const cases: [string, (h: Record<string, string>) => void, Record<string, unknown>?][] = [
      ["no MCP-Protocol-Version", (h) => delete h["MCP-Protocol-Version"]],
      ["other MCP-Protocol-Version", (h) => (h["MCP-Protocol-Version"] = "2025-11-25")],
      ["no Mcp-Method", (h) => delete h["Mcp-Method"]],
      ["other Mcp-Method", (h) => (h["Mcp-Method"] = "tools/list")],
      ["no Mcp-Name", (h) => delete h["Mcp-Name"]],
      ["other Mcp-Name", (h) => (h["Mcp-Name"] = "delete_task")],
      ["broken Base64 Mcp-Name", (h) => (h["Mcp-Name"] = "=?base64?////?=")],
    ];
    for (const [name, change] of cases) {
      const { status, body } = await post(key, "tools/call", { name: "list_today", arguments: {} }, change);
      expect(status, name).toBe(400);
      expect(body, name).toMatchObject({ id: 1, error: { code: -32020, message: expect.stringMatching(/^Header mismatch/) } });
    }
    const encoded = await post(key, "tools/call", { name: "list_today", arguments: {} }, (h) => {
      h["Mcp-Name"] = `=?base64?${btoa("list_today")}?=`;
    });
    expect(encoded.status).toBe(200);
  });

  test("a missing clientCapabilities is -32602 and an unknown version is -32022, both HTTP 400", async () => {
    const key = await createKey(newUserId());
    const request = modern("tools/list");
    delete (request.body.params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientCapabilities"];
    const missing = await mcpPost(key, request.body, request.headers);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: -32602 } });

    const old = modern("tools/list");
    (old.body.params._meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"] = "1900-01-01";
    old.headers["MCP-Protocol-Version"] = "1900-01-01";
    const unsupported = await mcpPost(key, old.body, old.headers);
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({
      error: { code: -32022, data: { supported: expect.arrayContaining([MODERN, "2025-11-25"]), requested: "1900-01-01" } },
    });
  });

  test("unknown methods are HTTP 404 -32601 (ping is gone); a missing resource is -32602", async () => {
    const key = await createKey(newUserId());
    for (const method of ["ping", "subscriptions/listen", "logging/setLevel"]) {
      const { status, body } = await post(key, method);
      expect(status, method).toBe(404);
      expect(body.error.code, method).toBe(-32601);
    }
    const missing = await post(key, "resources/read", { uri: "dayhand://tasks/404" });
    expect(missing.status).toBe(200);
    expect(missing.body.error).toMatchObject({ code: -32602, message: "Resource not found", data: { uri: "dayhand://tasks/404" } });
  });

  test("a 2025 client still gets the 2025 answers", async () => {
    const key = await createKey(newUserId());
    const initialize = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } };
    const init = await (await mcpPost(key, { jsonrpc: "2.0", id: 1, method: "initialize", params: initialize })).json();
    expect(init.result).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "dayhand" } });
    expect(init.result).not.toHaveProperty("resultType");
    const future = await (await mcpPost(key, { jsonrpc: "2.0", id: 2, method: "initialize", params: { ...initialize, protocolVersion: MODERN } })).json();
    expect(future.result.protocolVersion).toBe("2025-11-25");
    const ping = await (await mcpPost(key, { jsonrpc: "2.0", id: 3, method: "ping" }, { "MCP-Protocol-Version": "2025-11-25" })).json();
    expect(ping).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  test("requests from a browser origin that is not allowed get 403", async () => {
    const key = await createKey(newUserId());
    const response = await mcpPost(key, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { Origin: "https://evil.example" });
    expect(response.status).toBe(403);
    const { body } = await post(key, "tools/list");
    expect(body.result.tools).toHaveLength(32);
  });
});

describe("the official v2 SDK client", () => {
  test("pinned to 2026-07-28 it works the plan end to end", async () => {
    const key = await createKey(newUserId());
    const { client, connect } = v2Client(key, { mode: { pin: MODERN } });
    await connect();
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getServerVersion()).toMatchObject({ name: "dayhand" });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(32);
    const project = await client.callTool({ name: "add_project", arguments: { name: "SDK project", color: "cyan" } });
    expect(project.structuredContent).toEqual({ project: expect.objectContaining({ name: "SDK project", color: "cyan" }) });
    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    expect(projects.structuredContent).toEqual({
      result: [expect.objectContaining({ name: "SDK project", color: "cyan", counts: { open: 0, overdue: 0, dueToday: 0, done: 0 } })],
      noProject: { open: 0, overdue: 0 },
    });
    const added = await client.callTool({ name: "add_task", arguments: { title: "From the v2 client", dueDate: "today" } });
    expect(added.structuredContent).toMatchObject({ title: "From the v2 client" });
    const page = await client.callTool({ name: "list_all", arguments: { query: "v2", limit: 1 } });
    expect(page.structuredContent).toMatchObject({ total: 1, nextCursor: null });
    const today = await client.readResource({ uri: "dayhand://today" });
    expect(JSON.parse((today.contents[0] as { text: string }).text).today[0]).toMatchObject({ title: "From the v2 client" });
    const prompt = await client.getPrompt({ name: "plan_day" });
    expect(prompt.messages.length).toBeGreaterThan(0);
    await client.close();
  });

  test("with automatic negotiation it picks 2026-07-28; by default it speaks 2025", async () => {
    const key = await createKey(newUserId());
    const auto = v2Client(key, { mode: "auto" });
    await auto.connect();
    expect(auto.client.getProtocolEra()).toBe("modern");
    await auto.client.close();
    const legacy = v2Client(key);
    await legacy.connect();
    expect(legacy.client.getProtocolEra()).toBe("legacy");
    expect((await legacy.client.listTools()).tools).toHaveLength(32);
    await legacy.client.close();
    // And the v1 client (2025-11-25 handshake) sees the same data.
    const v1 = await mcpClient(key);
    expect(await callTool(v1, "list_all")).toEqual([]);
    const added = await callTool(v1, "add_project", { name: "Shared SDK project" });
    const projects = await callTool(v1, "list_projects");
    expect(projects).toMatchObject({ result: [{ id: added.project.id, name: "Shared SDK project" }], noProject: { open: 0, overdue: 0 } });
    const modern = v2Client(key, { mode: { pin: MODERN } });
    await modern.connect();
    await modern.client.listTools();
    expect((await modern.client.callTool({ name: "list_projects", arguments: {} })).structuredContent).toEqual(projects);
    await Promise.all([v1.close(), modern.client.close()]);
  });
});
