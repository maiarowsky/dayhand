// The app layer: an authenticated user (JWT) and the agent (API key) are two
// clients of the same operations on the same data.
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { appClient, callTool, helm, mcpClient } from "./helpers";
import { ConvexHttpClient } from "convex/browser";
import { signAppToken } from "../scripts/jwt.mjs";

describe("app layer", () => {
  test("requires sign-in", async () => {
    const anonymous = new ConvexHttpClient(helm().url);
    await expect(anonymous.query(api.app.listToday, {})).rejects.toThrow(/Sign in required/);
    await expect(anonymous.mutation(api.app.add, { title: "x" })).rejects.toThrow(/Sign in required/);
  });

  test("a token with a tampered subject is rejected", async () => {
    const { issuer, privateJwk } = helm();
    const parts = (await signAppToken({ privateJwk, issuer, subject: "alice" })).split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    parts[1] = Buffer.from(JSON.stringify({ ...payload, sub: "intruder" })).toString("base64url");
    const forged = new ConvexHttpClient(helm().url);
    forged.setAuth(parts.join("."));
    await expect(forged.query(api.app.listToday, {})).rejects.toThrow();
  });

  test("app and agent share one task list; history tells who changed what", async () => {
    const { client: app } = await appClient();
    const created = await app.action(api.app.createApiKey, { name: "claude" });
    expect(created.key).toMatch(/^dayhand_[A-Za-z0-9_-]{43}$/);
    const agent = await mcpClient(created.key);

    const task = await app.mutation(api.app.add, { title: "Plan the week", dueDate: "today" });
    const seenByAgent = await callTool(agent, "list_today");
    expect(seenByAgent.today.map((t: any) => t.id)).toEqual([task.id]);

    await callTool(agent, "update_task", { taskId: task.id, resumeNote: "draft is in docs/week.md" });
    await app.mutation(api.app.setNow, { taskId: task.id });
    const details = await app.query(api.app.getTask, { taskId: task.id });
    expect(details.history.map((h) => [h.actor, h.action])).toEqual([
      ["app", "create"],
      ["agent", "update"],
      ["app", "setNow"],
    ]);
    expect(details.task.resumeNote).toBe("draft is in docs/week.md");

    const keys = await app.query(api.app.listApiKeys, {});
    expect(keys.map((k) => k.name)).toEqual(["claude"]);
    await app.mutation(api.app.revokeApiKey, { keyId: created.id });
    await expect(callTool(agent, "list_today")).rejects.toThrow();
  });

  test("one user cannot read another user's task", async () => {
    const { client: alice } = await appClient();
    const { client: bob } = await appClient();
    const task = await alice.mutation(api.app.add, { title: "private" });
    await expect(bob.query(api.app.getTask, { taskId: task.id })).rejects.toThrow(/not found/);
    expect(await bob.query(api.app.listAll, {})).toEqual([]);
  });
});
