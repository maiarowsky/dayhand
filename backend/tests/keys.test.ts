// API key scopes and expiry (0.8.0): a read key only reads on /mcp, write and
// read keys cannot manage the account, an expired key is rejected, and a key
// created with another key dies with it.
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, callTool, createKey, helm, importRows, mcpClient, mcpPost, newUserId } from "./helpers";

type Created = { id: string; key: string; scope: string; expiresAt: number | null };

const create = (userId: string, fields: Record<string, unknown>, keyId?: string) =>
  admin().action(internal.apiKeys.create, { userId, actor: "app", name: "k", ...(keyId ? { keyId } : {}), ...fields }) as Promise<Created>;

const listTools = (key: string) => mcpPost(key, { jsonrpc: "2.0", id: 1, method: "tools/list" });
const addTask = (key: string) =>
  mcpPost(key, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_task", arguments: { title: "x" } } });

describe("API key scopes and expiry", () => {
  test("a key without a scope is a full key, as every key before 0.8.0", async () => {
    const userId = newUserId();
    await createKey(userId, "old");
    const [listed] = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as any[];
    expect(listed).toMatchObject({ scope: "full", expiresAt: null, createdWith: null });
  });

  test("a read key lists only the reading tools and gets 403 insufficient_scope on a change", async () => {
    const userId = newUserId();
    const { key } = await create(userId, { scope: "read" });
    const tools = (await (await listTools(key)).json()).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("list_today");
    expect(tools).not.toContain("add_task");
    const refused = await addTask(key);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toMatch(/insufficient_scope/);
    const client = await mcpClient(key);
    expect((await callTool(client, "list_today")).today).toEqual([]);
    await client.close();
  });

  test("a write key changes tasks but cannot manage devices, connections or the calendar feed", async () => {
    const userId = newUserId();
    const { key } = await create(userId, { scope: "write" });
    expect((await addTask(key)).status).toBe(200);
    for (const [method, path] of [
      ["GET", "/devices"],
      ["POST", "/devices/pairing-code"],
      ["GET", "/connections"],
      ["POST", "/calendar/feed"],
    ]) {
      const response = await fetch(`${helm().siteUrl}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect((await response.json()).error).toBe("insufficient_scope");
    }
  });

  test("an expired key gets 401 everywhere", async () => {
    const userId = newUserId();
    const { key } = await create(userId, { expiresAt: Date.now() + 60_000 });
    expect((await listTools(key)).status).toBe(200);
    // A key whose time has passed, written as stored data.
    const expired = `helm_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(expired).digest("hex");
    await importRows("apiKeys", [{ userId, name: "old", kind: "cli", scope: "full", hash, createdAt: 1, expiresAt: Date.now() - 1 }]);
    expect((await listTools(expired)).status).toBe(401);
    const devices = await fetch(`${helm().siteUrl}/devices`, { headers: { Authorization: `Bearer ${expired}` } });
    expect(devices.status).toBe(401);
  });

  test("expiresAt must be in the future", async () => {
    await expect(create(newUserId(), { expiresAt: Date.now() - 1000 })).rejects.toThrow(/expiresAt must be a time in the future/);
  });

  test("a key created with a key reads or writes only, expires no later, and stops when its parent is revoked", async () => {
    const userId = newUserId();
    const parent = await create(userId, { scope: "full", expiresAt: Date.now() + 3_600_000 });
    await expect(create(userId, { scope: "full" }, parent.id)).rejects.toThrow(/only have scope read or write/);
    await expect(create(userId, { scope: "read" }, parent.id)).rejects.toThrow(/expire no later/);
    const child = await create(userId, { scope: "write", expiresAt: Date.now() + 60_000 }, parent.id);
    const listed = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as any[];
    expect(listed.find((k) => k.id === child.id)).toMatchObject({ scope: "write", createdWith: parent.id });
    expect((await addTask(child.key)).status).toBe(200);

    await admin().mutation(internal.apiKeys.revoke, { userId, actor: "app", keyId: parent.id });
    expect((await listTools(child.key)).status).toBe(401);
  });
});
