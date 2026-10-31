// Security review regressions, on a disposable local backend with sample data only.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, callTool, createKey, helm, mcpClient, mcpPost, newUserId, rest } from "./helpers";

describe("agent account boundaries", () => {
  test.each(["allow", "deny", "ask"])("H-01: an agent with %s cannot mint an unrestricted child", async (rule) => {
    const userId = newUserId();
    const key = await createKey(userId, "parent", "agent");
    const identity = { userId, actor: "app" };
    const [parent] = await admin().query(internal.apiKeys.list, identity);
    await admin().mutation(internal.ops.setToolPolicy, { ...identity, apiKeyId: parent.id, toolName: "*", rule });
    const client = await mcpClient(key);
    try {
      if (rule !== "allow") await expect(callTool(client, "add_task", { title: "Sample" })).rejects.toThrow();
      for (const scope of ["read", "write", "full"]) {
        const child = await rest(key, "POST", "/keys", { body: { name: "child", kind: "agent", scope } });
        expect(child).toMatchObject({ status: 403, body: { code: "forbidden" } });
        expect(child.body).not.toHaveProperty("key");
      }
      expect(await admin().query(internal.apiKeys.list, identity)).toHaveLength(1);
      expect(await callTool(client, "list_all")).toEqual([]);
      // The same operation remains available to the owner.
      const owner = await createKey(userId, "owner", "cli");
      const child = await rest(owner, "POST", "/keys", { body: { name: "owned", scope: "write" } });
      expect(child.status).toBe(201);
      const delegated = await mcpClient(child.body.key);
      try { expect((await callTool(delegated, "add_task", { title: "Owner delegated" })).title).toBe("Owner delegated"); }
      finally { await delegated.close(); }
    } finally {
      await client.close();
    }
  });

  test.each(["deny", "ask"])("H-02: an agent with %s cannot import tasks or projects", async (rule) => {
    const userId = newUserId();
    const key = await createKey(userId, "import-agent", "agent");
    const identity = { userId, actor: "app" };
    const [agent] = await admin().query(internal.apiKeys.list, identity);
    await admin().mutation(internal.ops.setToolPolicy, { ...identity, apiKeyId: agent.id, toolName: "*", rule });
    const content = JSON.stringify({ version: 1, projects: [{ id: "sample", name: "Sample" }], tasks: [{ title: "Sample import", projectId: "sample" }] });
    for (const path of ["/import", "/import?dryRun=true"]) {
      expect(await rest(key, "POST", path, { body: { content } })).toMatchObject({ status: 403, body: { code: "forbidden" } });
    }
    // The guard also lives in the mutation, not just the HTTP adapter.
    await expect(admin().mutation(internal.ops.importTasks, {
      userId, actor: "agent", keyId: agent.id, items: [{ key: "sample", title: "Sample import" }],
    })).rejects.toThrow(/Only the owner/);
    expect((await rest(key, "GET", "/tasks")).body.total).toBe(0);
    expect((await rest(key, "GET", "/projects")).body.result).toEqual([]);
    const owner = await createKey(userId, "owner", "cli");
    expect(await rest(owner, "POST", "/import", { body: { content } })).toMatchObject({ status: 200, body: { created: 1 } });
  });
});

test("L-02: REST, MCP, pairing and OAuth reject multibyte bodies above their byte budgets", async () => {
  const key = await createKey(newUserId(), "sample", "cli");
  const title = "ą".repeat(140_000); // <256K UTF-16 units, >256K UTF-8 bytes.
  expect((await rest(key, "POST", "/tasks", { body: { title } })).status).toBe(413);
  expect((await mcpPost(key, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_task", arguments: { title } } })).status).toBe(413);
  const pairing = await fetch(`${helm().siteUrl}/auth/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ą".repeat(3000) }),
  });
  expect(pairing.status).toBe(400); // Rejected as a body, not checked as a pairing code (401).
  const token = await fetch(`${helm().siteUrl}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=sample&grant_type=refresh_token&refresh_token=sample&padding=${"ą".repeat(5000)}`,
  });
  expect(token.status).toBe(400);
  expect(await token.json()).toMatchObject({ error: "invalid_request", error_description: expect.stringContaining("body must be") });
});
