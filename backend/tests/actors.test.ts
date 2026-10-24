// Who changed what: API keys have a kind (cli or agent) and a name, and the
// history records changes made with a key under that kind and name.
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { admin, appClient, callTool, createKey, helm, importRows, mcpClient, newUserId } from "./helpers";

async function history(client: Awaited<ReturnType<typeof mcpClient>>, taskId: string) {
  return (await callTool(client, "get_task", { taskId })).history as any[];
}

describe("actor by API key", () => {
  test("history tells the app, the CLI and a named agent apart", async () => {
    const { client: app, userId } = await appClient();
    const cli = await mcpClient(await createKey(userId, "macbook", "cli"));
    const agent = await mcpClient(await createKey(userId, "claude-code", "agent"));

    const task: any = await app.mutation(api.app.add, { title: "Plan the week" });
    await callTool(cli, "set_now", { taskId: task.id });
    await callTool(agent, "complete_task", { taskId: `#${task.ref}` });

    const events = await history(cli, task.id);
    expect(events.map((e) => [e.action, e.actor, e.actorName, e.by])).toEqual([
      ["create", "app", null, "app"],
      ["setNow", "cli", "macbook", "cli"],
      ["complete", "agent", "claude-code", "agent: claude-code"],
    ]);
    // The app sees the same history through its own layer.
    const viaApp: any = await app.query(api.app.getTask, { taskId: task.id });
    expect(viaApp.history.map((e: any) => e.by)).toEqual(["app", "cli", "agent: claude-code"]);
    await cli.close();
    await agent.close();
  });

  test("keys are agent keys unless created as cli; the kind is listed and recorded", async () => {
    const { client: app, userId } = await appClient();
    const made: any = await app.action(api.app.createApiKey, { name: "terminal", kind: "cli" });
    expect(made).toMatchObject({ name: "terminal", kind: "cli", key: expect.stringMatching(/^dayhand_/) });
    await createKey(userId, "bot");
    const keys: any[] = await app.query(api.app.listApiKeys, {});
    expect(keys.map((k) => [k.name, k.kind])).toEqual([
      ["terminal", "cli"],
      ["bot", "agent"],
    ]);
    const exported: any = await app.query(api.app.exportPlan, { format: "json" });
    const created = exported.content.events.filter((e: any) => e.action === "apiKey.create");
    expect(created.map((e: any) => e.after.kind)).toEqual(["cli", "agent"]);
    await expect(app.action(api.app.createApiKey, { name: "x", kind: "robot" as any })).rejects.toThrow();
  });

  test("the key's identity cannot be set through tool arguments", async () => {
    const client = await mcpClient(await createKey(newUserId(), "agent-1"));
    for (const field of ["actorName", "keyId"]) {
      const result = await client.callTool({ name: "add_task", arguments: { title: "x", [field]: "app" } });
      expect(result.structuredContent).toMatchObject({ error: { code: "invalid_argument" } });
    }
    expect(await callTool(client, "list_all")).toEqual([]);
    await client.close();
  });

  test("device changes made with a cli key are recorded as cli", async () => {
    const { client: app, userId } = await appClient();
    const key = await createKey(userId, "macbook", "cli");
    const created = await fetch(`${helm().siteUrl}/devices/pairing-code`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(created.status).toBe(201);
    const exported: any = await app.query(api.app.exportPlan, { format: "json" });
    const event = exported.content.events.find((e: any) => e.action === "device.pairingCode");
    expect(event).toMatchObject({ actor: "cli", actorName: "macbook", after: { createdBy: 'API key "macbook"' } });
  });

  test("a key from an older version works as an agent key and the migration marks it agent", async () => {
    const userId = newUserId();
    const key = `helm_${randomBytes(32).toString("base64url")}`;
    await importRows("apiKeys", [
      { userId, name: "old-agent", hash: createHash("sha256").update(key).digest("hex"), createdAt: 1_000 },
    ]);
    const client = await mcpClient(key);
    const task = await callTool(client, "add_task", { title: "from the old key" });
    expect((await history(client, task.id)).map((e) => e.by)).toEqual(["agent: old-agent"]);

    expect(await admin().query(internal.migrations.status, {})).toMatchObject({ keysWithoutKind: 1 });
    expect(await admin().mutation(internal.migrations.backfillKeyKinds, {})).toEqual({ updated: 1 });
    expect(await admin().query(internal.migrations.status, {})).toMatchObject({ keysWithoutKind: 0 });
    const [listed] = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as any[];
    expect(listed).toMatchObject({ name: "old-agent", kind: "agent", revokedAt: null });
    // The key keeps working after the migration.
    expect(await callTool(client, "list_all")).toHaveLength(1);
    await client.close();
  });
});
