// Webhooks against the local backend and a local receiver: Standard Webhooks
// signatures, the same webhook-id on every retry, events from MCP and REST
// changes, no event for a dry run, turning off after failing deliveries, the
// delivery log, and the address rules (SSRF). The test deployment retries
// after 0.3 s (HELM_WEBHOOK_RETRY_DELAYS), so a delivery has 4 attempts.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { signWebhook } from "../convex/lib/webhookSign";
import { targetProblem } from "../convex/lib/webhookTarget";
import { admin, callTool, createKey, helm, mcpClient, newUserId, openApiChecker, rest } from "./helpers";

type Received = { path: string; headers: Record<string, string>; body: string };

const received = async (id: string): Promise<Received[]> => (await fetch(`${helm().webhookOrigin}/received/${id}`)).json();

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(value).slice(0, 500)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Verifies a message the way Standard Webhooks specifies, independently of the server's code. */
function verify(secret: string, message: Received, toleranceS = 300): boolean {
  const id = message.headers["webhook-id"]!;
  const timestamp = message.headers["webhook-timestamp"]!;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${message.body}`).digest();
  return message.headers["webhook-signature"]!.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    const given = Buffer.from(signature ?? "", "base64");
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
}

async function setup(behaviour = "ok", events?: string[]) {
  const userId = newUserId();
  const key = await createKey(userId, "integration", "agent");
  const hookId = randomUUID();
  const created = await rest(key, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/${hookId}/${behaviour}`, ...(events ? { events } : {}) } });
  expect(created.status).toBe(201);
  return { userId, key, hookId, webhook: created.body.webhook, secret: created.body.secret as string };
}

describe("webhook signatures", () => {
  test("signWebhook matches the Standard Webhooks test vector", async () => {
    const signature = await signWebhook("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}');
    expect(signature).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });
});

describe("webhook addresses (SSRF)", () => {
  test.each([
    ["http://example.com/hook", /https/],
    ["https://localhost/hook", /public host/],
    ["https://printer.local/hook", /public host/],
    ["https://intranet/hook", /public host/],
    ["https://127.0.0.1/hook", /private/],
    ["https://2130706433/hook", /private/],
    ["https://10.1.2.3/hook", /private/],
    ["https://169.254.169.254/latest/meta-data", /private/],
    ["https://192.168.0.10/hook", /private/],
    ["https://[::1]/hook", /private/],
    ["https://[::ffff:127.0.0.1]/hook", /private/],
    ["https://[fd00::1]/hook", /private/],
    ["https://user:pw@example.com/hook", /user name/],
    ["not a url", /valid URL/],
  ])("%s is refused", (url, reason) => {
    expect(targetProblem(url, [])).toMatch(reason);
  });

  test("public HTTPS addresses and allowed origins are accepted", () => {
    expect(targetProblem("https://hooks.example.com/helm?x=1", [])).toBeNull();
    expect(targetProblem("https://8.8.8.8/hook", [])).toBeNull();
    expect(targetProblem("http://127.0.0.1:9999/hook", ["http://127.0.0.1:9999"])).toBeNull();
  });

  test("POST /webhooks refuses a private address with 422", async () => {
    const key = await createKey(newUserId(), "integration", "agent");
    const refused = await rest(key, "POST", "/webhooks", { body: { url: "https://10.0.0.1/hook" } });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("invalid_argument");
  });
});

describe("webhook deliveries", () => {
  test("a change through REST arrives signed, with type, task, previous values and actor", async () => {
    const { key, hookId, secret, webhook } = await setup();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);
    expect(webhook).toMatchObject({ enabled: true, events: ["task.created", "task.updated", "task.completed", "task.deleted", "task.restored", "now.changed"] });
    const listed = await rest(key, "GET", "/webhooks");
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const task = (await rest(key, "POST", "/tasks", { body: { title: "Dentist", dueDate: "2026-11-03" } })).body;
    await rest(key, "PATCH", `/tasks/${task.ref}`, { body: { title: "Dentist at 15:30" } });
    const messages = await until(() => received(hookId), (m) => m.length >= 2, "two messages");
    for (const message of messages) {
      expect(verify(secret, message)).toBe(true);
      expect(message.headers["webhook-id"]).toMatch(/^msg_/);
      expect(message.headers["content-type"]).toBe("application/json");
      expect(message.headers["user-agent"]).toMatch(/^Helm-Webhooks\//);
    }
    const bodies = messages.map((m) => JSON.parse(m.body));
    const created = bodies.find((b) => b.type === "task.created");
    const updated = bodies.find((b) => b.type === "task.updated");
    expect(created).toMatchObject({ data: { task: { id: task.id, title: "Dentist" } }, previous: {}, actor: { type: "agent", name: "integration" } });
    expect(new Date(created.timestamp).toISOString()).toBe(created.timestamp);
    expect(updated).toMatchObject({ data: { task: { title: "Dentist at 15:30" } }, previous: { title: "Dentist" } });

    // A tampered body or another secret does not verify.
    expect(verify(secret, { ...messages[0]!, body: messages[0]!.body.replace("Dentist", "Dentist!") })).toBe(false);
    expect(verify("whsec_" + Buffer.from("x".repeat(24)).toString("base64"), messages[0]!)).toBe(false);
  });

  test("MCP changes send events too; a dry run sends none; events filter what is sent", async () => {
    const { key, hookId } = await setup("ok", ["task.completed", "now.changed"]);
    const client = await mcpClient(key);
    const task = await callTool(client, "add_task", { title: "Bins" });
    await callTool(client, "add_task", { title: "Preview only", dryRun: true });
    await callTool(client, "set_now", { taskId: task.id });
    await callTool(client, "complete_task", { taskId: task.id });
    await client.close();
    const messages = await until(() => received(hookId), (m) => m.length >= 3, "now and completed messages");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const types = (await received(hookId)).map((m) => JSON.parse(m.body).type).sort();
    expect(types).toEqual(["now.changed", "now.changed", "task.completed"]);
    const now = messages.map((m) => JSON.parse(m.body)).filter((b) => b.type === "now.changed").map((b) => b.data.isNow);
    expect(now.sort()).toEqual([false, true]);
  });

  test("a failing receiver gets the same webhook-id and body on every retry until it succeeds; the log shows each attempt", async () => {
    const { key, hookId, secret, webhook } = await setup("fail-2");
    await rest(key, "POST", "/tasks", { body: { title: "Retry me" } });
    const messages = await until(() => received(hookId), (m) => m.length >= 3, "three attempts");
    expect(new Set(messages.map((m) => m.headers["webhook-id"])).size).toBe(1);
    expect(new Set(messages.map((m) => m.body)).size).toBe(1);
    expect(messages.every((m) => verify(secret, m))).toBe(true);

    const log = await until(
      () => rest(key, "GET", `/webhooks/${webhook.id}/deliveries`),
      (a) => a.body.deliveries[0]?.status === "succeeded",
      "the delivery to succeed",
    );
    const [delivery] = log.body.deliveries;
    expect(delivery).toMatchObject({ type: "task.created", eventId: messages[0]!.headers["webhook-id"], finishedAt: expect.any(Number), nextAttemptAt: null });
    expect(delivery.attempts.map((a: { responseStatus: number }) => a.responseStatus)).toEqual([500, 500, 200]);
    expect(delivery.payload).toMatchObject({ type: "task.created", data: { task: { title: "Retry me" } } });
    expect((await rest(key, "GET", `/webhooks/${webhook.id}`)).body.webhook).toMatchObject({ failureStreak: 0, lastSuccessAt: expect.any(Number) });
  });

  test("a redirect counts as a failure and is not followed", async () => {
    const { key, hookId, webhook } = await setup("redirect");
    await rest(key, "POST", "/tasks", { body: { title: "Go elsewhere" } });
    const log = await until(
      () => rest(key, "GET", `/webhooks/${webhook.id}/deliveries`),
      (a) => a.body.deliveries[0]?.status === "failed",
      "the delivery to fail",
    );
    expect(log.body.deliveries[0].attempts.map((a: { responseStatus: number }) => a.responseStatus)).toEqual([302, 302, 302, 302]);
    // Only the redirecting address was called, never the target of the redirect.
    expect((await received(hookId)).every((m) => m.path.endsWith("/redirect"))).toBe(true);
  });

  test("after 5 deliveries in a row fail on every attempt the webhook is turned off; enable and test bring it back", async () => {
    const { userId, key, hookId, webhook } = await setup("down", ["task.created"]);
    for (let i = 1; i <= 5; i++) await rest(key, "POST", "/tasks", { body: { title: `t${i}` } });
    const off = await until(
      () => rest(key, "GET", `/webhooks/${webhook.id}`),
      (a) => a.body.webhook.enabled === false,
      "the webhook to be turned off",
      30_000,
    );
    expect(off.body.webhook).toMatchObject({ failureStreak: 5, disabledAt: expect.any(Number), disabledReason: expect.stringMatching(/5 deliveries in a row/) });
    expect((await received(hookId)).length).toBe(20);
    const exported: any = await admin().query(internal.ops.exportPlan, { userId, actor: "app", format: "json" });
    expect(exported.content.events.some((e: { action: string }) => e.action === "webhook.disable")).toBe(true);

    // While it is off, changes send nothing.
    await rest(key, "POST", "/tasks", { body: { title: "while off" } });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await received(hookId)).length).toBe(20);

    const test = await rest(key, "POST", `/webhooks/${webhook.id}/test`);
    expect(test.status).toBe(202);
    const withTest = await until(() => received(hookId), (m) => m.length >= 21, "the test message");
    expect(JSON.parse(withTest[20]!.body)).toMatchObject({ type: "webhook.test", data: { webhookId: webhook.id } });
    expect(withTest[20]!.headers["webhook-id"]).toBe(test.body.eventId);

    const on = await rest(key, "POST", `/webhooks/${webhook.id}/enable`);
    expect(on.body.webhook).toMatchObject({ enabled: true, failureStreak: 0, disabledAt: null });
  });

  test("every webhook route answers as the OpenAPI document says", async () => {
    const { conforms } = await openApiChecker();
    const { key, hookId, webhook } = await setup();
    const check = async (method: string, path: string, body?: unknown) => {
      const answer = await rest(key, method, path, body === undefined ? {} : { body });
      expect(conforms(method, path, answer), `${method} ${path}`).toEqual([]);
      return answer;
    };
    await check("GET", "/webhooks");
    await check("GET", `/webhooks/${webhook.id}`);
    await check("POST", `/webhooks/${webhook.id}/test`);
    await until(() => received(hookId), (m) => m.length >= 1, "the test message");
    await until(() => rest(key, "GET", `/webhooks/${webhook.id}/deliveries`), (a) => a.body.deliveries[0]?.status === "succeeded", "a finished delivery");
    await check("GET", `/webhooks/${webhook.id}/deliveries?limit=5`);
    await check("POST", `/webhooks/${webhook.id}/enable`);
    await check("POST", "/webhooks", { url: "http://example.com/x" });
    await check("GET", "/keys");
    await check("POST", "/keys", { name: "n8n", scope: "read" });
    await check("DELETE", `/webhooks/${webhook.id}`);
    await check("GET", `/webhooks/${webhook.id}`);
  });

  test("removing a webhook removes its log; another user's webhook is not found", async () => {
    const { key, webhook } = await setup();
    const stranger = await createKey(newUserId(), "x", "agent");
    expect((await rest(stranger, "GET", `/webhooks/${webhook.id}`)).status).toBe(404);
    expect((await rest(stranger, "DELETE", `/webhooks/${webhook.id}`)).status).toBe(404);
    expect((await rest(key, "DELETE", `/webhooks/${webhook.id}`)).body).toEqual({ id: webhook.id, deleted: true });
    expect((await rest(key, "GET", "/webhooks")).body).toEqual({ webhooks: [] });
    expect((await rest(key, "GET", `/webhooks/${webhook.id}`)).status).toBe(404);
  });

  test("at most 10 webhooks per user; a write key cannot manage webhooks", async () => {
    const userId = newUserId();
    const key = await createKey(userId, "integration", "agent");
    for (let i = 0; i < 10; i++) {
      expect((await rest(key, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/${randomUUID()}/ok` } })).status).toBe(201);
    }
    const eleventh = await rest(key, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/x/ok` } });
    expect(eleventh.status).toBe(422);
    expect(eleventh.body.detail).toMatch(/At most 10 webhooks/);
    const { key: writeKey } = (await admin().action(internal.apiKeys.create, { userId, actor: "app", name: "w", scope: "write" })) as { key: string };
    expect((await rest(writeKey, "GET", "/webhooks")).status).toBe(403);
  });
});
