// Phone pairing against the local backend: POST /devices/pairing-code (what
// `dayhand pair` calls) -> POST /auth/pair -> POST /auth/token -> the app layer
// through the Convex client with that JWT.
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { admin, callTool, createKey, helm, mcpClient } from "./helpers";

/** The device management endpoints with a personal API key, as `dayhand pair`, `devices` and `revoke` use them. */
async function devices(key: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${helm().siteUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${helm().siteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

/** An app user (issuer|subject) with a personal API key. */
async function owner() {
  const subject = randomUUID();
  const userId = `${helm().issuer}|${subject}`;
  return { subject, userId, key: await createKey(userId, "cli") };
}

async function pairingCode(key: string): Promise<string> {
  const result = await devices(key, "POST", "/devices/pairing-code");
  expect(result.status).toBe(201);
  return result.body.code;
}

const INVALID = { error: "invalid_grant", error_description: "The code or token is not valid" };

afterEach(async () => {
  await admin().mutation(internal.devices.resetPairLimit, {});
});

describe("phone pairing", () => {
  test("pairing code -> /auth/pair -> /auth/token -> app queries as the owner", async () => {
    const { subject, userId, key } = await owner();
    const pairing = await devices(key, "POST", "/devices/pairing-code");
    expect(pairing).toMatchObject({ status: 201, body: { expiresIn: 600 } });
    const code: string = pairing.body.code;
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const paired = await post("/auth/pair", { code: code.toLowerCase(), deviceName: "Pixel 9" });
    expect(paired.status).toBe(200);
    expect(paired.headers.get("cache-control")).toBe("no-store");
    expect(paired.body).toMatchObject({ deviceName: "Pixel 9", convexUrl: helm().url });
    expect(paired.body.deviceToken).toMatch(/^helmdev_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);

    const issued = await post("/auth/token", { deviceToken: paired.body.deviceToken });
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ tokenType: "Bearer", expiresIn: 3600 });
    const [header, payload] = issued.body.token
      .split(".")
      .slice(0, 2)
      .map((part: string) => JSON.parse(Buffer.from(part, "base64url").toString()));
    expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: helm().privateJwk.kid });
    expect(payload).toMatchObject({ iss: helm().issuer, sub: subject, aud: "helm" });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(issued.body.expiresAt).toBe(payload.exp * 1000);

    // The agent adds a task; the phone, signed in with the issued JWT, sees it.
    const agent = await mcpClient(key);
    const task = await callTool(agent, "add_task", { title: "Buy milk", dueDate: "today" });
    const phone = new ConvexHttpClient(paired.body.convexUrl);
    phone.setAuth(issued.body.token);
    const today = await phone.query(api.app.listToday, {});
    expect(today.today.map((t) => t.id)).toEqual([task.id]);
    const added = await phone.mutation(api.app.add, { title: "From the phone" });
    const details = await admin().query(internal.ops.getTask, { userId, actor: "app", taskId: added.id });
    expect(details.history[0].actor).toBe("app");

    const listed = (await devices(key, "GET", "/devices")).body.devices;
    expect(listed).toEqual([
      expect.objectContaining({ id: paired.body.deviceId, name: "Pixel 9", pairedBy: 'API key "cli"', revokedAt: null }),
    ]);
    expect(listed[0].lastUsedAt).toBeGreaterThan(0);
  });

  test("a code works once; used, expired, unknown and malformed codes get the same answer", async () => {
    const { key, userId } = await owner();
    const code = await pairingCode(key);
    expect((await post("/auth/pair", { code })).status).toBe(200);
    const reused = await post("/auth/pair", { code });
    expect(reused).toMatchObject({ status: 401, body: INVALID });

    const expiring = (await admin().action(internal.devices.createPairingCode, { userId, actor: "app", ttlMs: 1 })) as {
      code: string;
    };
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await post("/auth/pair", { code: expiring.code })).toMatchObject({ status: 401, body: INVALID });

    expect(await post("/auth/pair", { code: "ZZZZ-ZZZZ-ZZZZ" })).toMatchObject({ status: 401, body: INVALID });
    expect(await post("/auth/pair", { code: "not a code" })).toMatchObject({ status: 401, body: INVALID });
    expect(await post("/auth/pair", { nope: 1 })).toMatchObject({ status: 400, body: { error: "invalid_request" } });
    expect(await post("/auth/pair", "{")).toMatchObject({ status: 400 });
    expect(await post("/auth/pair", { code, deviceName: " " })).toMatchObject({ status: 400 });
  });

  test("the deployment admin can create a code without an API key", async () => {
    const { userId } = await owner();
    const created = (await admin().action(internal.devices.createPairingCode, { userId, actor: "app" })) as {
      code: string;
      expiresAt: number;
    };
    expect(created.expiresAt - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    const paired = await post("/auth/pair", { code: created.code });
    expect(paired.body.deviceName).toBe("Phone");
    const devices = await admin().query(internal.devices.list, { userId, actor: "app" });
    expect(devices[0].pairedBy).toBe("admin");
  });

  test("five wrong secrets for one code burn it", async () => {
    const { key } = await owner();
    const code = await pairingCode(key);
    const wrong = code.slice(0, 5) + (code[5] === "0" ? "1" : "0") + code.slice(6);
    for (let i = 0; i < 5; i++) expect((await post("/auth/pair", { code: wrong })).status).toBe(401);
    expect(await post("/auth/pair", { code })).toMatchObject({ status: 401, body: INVALID });
  });

  test("after ten failures in ten minutes pairing is refused, even with a valid code", async () => {
    const { key } = await owner();
    const code = await pairingCode(key);
    for (let i = 0; i < 10; i++) expect((await post("/auth/pair", { code: "ZZZZ-ZZZZ-ZZZZ" })).status).toBe(401);
    const limited = await post("/auth/pair", { code });
    expect(limited).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(500);
    await admin().mutation(internal.devices.resetPairLimit, {});
    expect((await post("/auth/pair", { code })).status).toBe(200);
  });

  test("a revoked device gets no new tokens", async () => {
    const { key } = await owner();
    const paired = (await post("/auth/pair", { code: await pairingCode(key), deviceName: "Old phone" })).body;
    expect((await post("/auth/token", { deviceToken: paired.deviceToken })).status).toBe(200);

    const revoked = await devices(key, "POST", "/devices/revoke", { deviceId: paired.deviceId });
    expect(revoked.status).toBe(200);
    expect(await post("/auth/token", { deviceToken: paired.deviceToken })).toMatchObject({ status: 401, body: INVALID });
    expect((await devices(key, "GET", "/devices")).body.devices).toEqual([
      expect.objectContaining({ id: paired.deviceId, name: "Old phone", revokedAt: expect.any(Number) }),
    ]);

    const stranger = await owner();
    expect((await devices(stranger.key, "POST", "/devices/revoke", { deviceId: paired.deviceId })).status).toBe(404);
    expect(await devices(stranger.key, "POST", "/devices/revoke", { deviceId: "nope" })).toMatchObject({
      status: 404,
      body: { error_description: expect.stringMatching(/not found/) },
    });
  });

  test("wrong, malformed and missing device tokens are rejected alike", async () => {
    const { key } = await owner();
    const paired = (await post("/auth/pair", { code: await pairingCode(key) })).body;
    const [selector] = paired.deviceToken.split(".");
    const wrongSecret = `${selector}.${"A".repeat(43)}`;
    for (const deviceToken of [wrongSecret, "helmdev_x.y", "helm_notadevice"]) {
      expect(await post("/auth/token", { deviceToken })).toMatchObject({ status: 401, body: INVALID });
    }
    expect(await post("/auth/token", {})).toMatchObject({ status: 400 });
    expect((await post("/auth/token", { deviceToken: paired.deviceToken })).status).toBe(200);
  });

  test("while agents are paused an agent key cannot pair a phone or change the account, a cli key can", async () => {
    const { userId, key: agent } = await owner();
    const cli = await createKey(userId, "terminal", "cli");
    await admin().mutation(internal.ops.pauseAgents, { userId, actor: "app", paused: true });
    const paused = { status: 403, body: { error: "agents_paused" } };
    expect(await devices(agent, "POST", "/devices/pairing-code")).toMatchObject(paused);
    expect(await devices(agent, "POST", "/devices/revoke", { deviceId: "nope" })).toMatchObject(paused);
    expect(await devices(agent, "POST", "/connections/revoke", { connectionId: "nope" })).toMatchObject(paused);
    for (const path of ["/calendar/feed", "/calendar/feed/rotate", "/calendar/feed/revoke"]) {
      expect(await devices(agent, "POST", path)).toMatchObject(paused);
    }
    expect((await devices(agent, "GET", "/devices")).status).toBe(200);
    expect((await devices(cli, "POST", "/devices/pairing-code")).status).toBe(201);
  });

  test("device management needs an API key; a key of a non-app user cannot pair", async () => {
    const anonymous = await fetch(`${helm().siteUrl}/devices`);
    expect(anonymous.status).toBe(401);
    const noKey = await fetch(`${helm().siteUrl}/devices/pairing-code`, { method: "POST" });
    expect(noKey.status).toBe(401);

    const agentOnly = await createKey(`elsewhere|${randomUUID()}`);
    const refused = await devices(agentOnly, "POST", "/devices/pairing-code");
    expect(refused).toMatchObject({ status: 400, body: { error_description: expect.stringMatching(/cannot sign in to the app/) } });
  });
});
