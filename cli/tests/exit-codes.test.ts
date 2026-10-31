// Exit code matrix (docs/cli.md#exit-codes) against the real local backend.
// Every failure with --json is one {"error":…} line on stderr and nothing on stdout.
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freePort } from "./globalSetup.js";
import { createKey, helm, dayhand, dayhandJson, jsonError, newUser, newUserId, revokeKey, schemaValidator, type Run } from "./helpers.js";

const validate = schemaValidator();

function expectFailure(run: Run, exitCode: number, code: string) {
  expect(run.code, run.stderr).toBe(exitCode);
  expect(run.stdout).toBe("");
  const error = jsonError(run);
  expect(error).toMatchObject({ code, exitCode });
  expect(validate("error.schema.json", { error })).toEqual([]);
  return error;
}

/** A proxy in front of the backend: forwards and then loses the answer (502), or answers by itself. */
type Mode = "lose-answer" | 503 | 429 | 404;
let mode: Mode = "lose-answer";
let proxy: Server;
let proxyUrl: string;

beforeAll(async () => {
  const port = await freePort();
  proxy = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (mode !== "lose-answer") return response.writeHead(mode).end(mode === 404 ? "No matching routes found" : "");
    await fetch(helm().siteUrl + request.url, {
      method: request.method,
      headers: { "Content-Type": "application/json", Authorization: request.headers.authorization ?? "" },
      body: request.method === "POST" ? body : undefined,
    });
    response.writeHead(502).end();
  });
  await new Promise<void>((resolve) => proxy.listen(port, "127.0.0.1", resolve));
  proxyUrl = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((resolve) => proxy.close(() => resolve())));

describe("exit codes", () => {
  test("0: success, also for a change that is already applied", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Once"]);
    expect((await dayhand(key, ["done", "1"])).code).toBe(0);
    expect((await dayhand(key, ["done", "1"])).code).toBe(0);
  });

  test("2: unknown command or flag, bad values and dates, missing --yes", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Task"]);
    const unknownFlag = expectFailure(await dayhand(key, ["list", "--bogus", "--json"]), 2, "usage");
    expect(unknownFlag.valid).toContain("--status");
    expect(unknownFlag.valid).not.toContain("--label");
    expectFailure(await dayhand(key, ["add", "X", "-l", "home", "--json"]), 2, "usage"); // labels are gone
    expectFailure(await dayhand(key, ["edit", "1", "--add-label", "home", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["frobnicate", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["add", "--json"]), 2, "usage"); // missing title
    expectFailure(await dayhand(key, ["add", "X", "--due", "someday", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["move", "1", "2026-13-45", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["add", "X", "--time", "25:00", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["board", "--done-limit", "many", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["add", "X", "--every", "week", "--on", "funday", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["add", "X", "--status", "done", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["list", "--fields", "ref,colour", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["show", "nope", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["rm", "1", "2", "3", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["call", "add_task", "{not json", "--json"]), 2, "usage");
    expectFailure(await dayhand(key, ["call", "no_such_tool", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["settings", "set", "colour=red", "--json"]), 2, "usage");
    const badFormat = await dayhand(key, ["list"], { env: { DAYHAND_FORMAT: "yaml" } });
    expect(badFormat).toMatchObject({ code: 2, stdout: "" });
    expect(badFormat.stderr).toMatch(/^dayhand: DAYHAND_FORMAT must be one of human, plain, json/);
    expectFailure(await dayhand(key, ["list", "--json", "--client-id", "has space"]), 2, "usage");
    expectFailure(await dayhand(undefined, ["list", "--json"], { url: "" }), 2, "usage"); // no DAYHAND_URL
  });

  test("M-01: remote HTTP is a usage error before login or an authenticated call", async () => {
    const key = "dayhand_sample_only";
    const url = "http://192.0.2.1:3211";
    for (const args of [["today", "--json"], ["login", "--with-key", "--json"]]) {
      const run = await dayhand(key, args, { url, input: `${key}\n` });
      expectFailure(run, 2, "usage");
      expect(run.stderr).toContain("HTTPS");
      expect(run.stderr).not.toContain(key);
    }
  });

  test.skipIf(process.platform === "win32")("L-01: a non-private credentials file is a config error, never a silent fallback", async () => {
    const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-private-store-"));
    const { key } = await newUser();
    const env = { DAYHAND_CONFIG_DIR: dir };
    try {
      expect((await dayhand(undefined, ["login", "--with-key", "--store", "file", "--json"], { env, input: `${key}\n` })).code).toBe(0);
      chmodSync(join(dir, "credentials.json"), 0o644);
      const run = await dayhand(undefined, ["today", "--json"], { env });
      expectFailure(run, 2, "config");
      expect(run.stderr).toContain("chmod 600");
      expect(run.stderr).not.toContain(key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("3: missing, wrong or revoked key", async () => {
    const userId = newUserId();
    const { key, id } = await createKey(userId);
    expect((await dayhand(key, ["today"])).code).toBe(0);
    expectFailure(await dayhand(undefined, ["today", "--json"]), 3, "unauthenticated");
    expectFailure(await dayhand("helm_wrong", ["today", "--json"]), 3, "unauthenticated");
    await revokeKey(userId, id);
    const revoked = await dayhand(key, ["add", "After revoke", "--json"]);
    expectFailure(revoked, 3, "unauthenticated");
    expect(revoked.stderr).not.toContain(key);
  });

  test("4: no such task number, now task or device", async () => {
    const { key } = await newUser();
    expectFailure(await dayhand(key, ["show", "999", "--json"]), 4, "not_found");
    expectFailure(await dayhand(key, ["done", "#999", "--json"]), 4, "not_found");
    expectFailure(await dayhand(key, ["done", "now", "--json"]), 4, "not_found");
    expectFailure(await dayhand(key, ["device", "revoke", "nope", "--json"]), 4, "not_found");
    await dayhand(key, ["add", "Real"]);
    const many = expectFailure(await dayhand(key, ["done", "1", "999", "--json"]), 4, "not_found");
    expect(many.ref).toBe("999");
  });

  test("6: another agent holds the claim (conflict), or the acceptance criteria are not met (precondition_failed)", async () => {
    const { userId, key } = await newUser("agent");
    const other = (await createKey(userId, "other-agent", "agent")).key;
    await dayhand(key, ["add", "Shared", "--accept", "It works"]);
    expect((await dayhand(key, ["claim", "1"])).code).toBe(0);
    const conflict = expectFailure(await dayhand(other, ["claim", "1", "--json"]), 6, "conflict");
    expect(conflict.message).toContain("claimed by claude-code");
    expectFailure(await dayhand(other, ["done", "1", "--json"]), 6, "conflict");
    expectFailure(await dayhand(key, ["done", "1", "--summary", "done", "--json"]), 6, "precondition_failed");
    expect((await dayhand(key, ["release", "1"])).code).toBe(0);
    expectFailure(await dayhand(key, ["renew", "1", "--json"]), 6, "precondition_failed");
  });

  test("project failures keep the public error codes and deletion explains --move-tasks-to", async () => {
    const { key, userId } = await newUser();
    await dayhandJson(key, ["project", "add", "Home"]);
    await dayhandJson(key, ["add", "In project", "-p", "Home"]);
    await dayhandJson(key, ["rm", "1"]);
    const required = expectFailure(await dayhand(key, ["project", "rm", "Home", "--json"]), 6, "precondition_failed");
    expect(required.message).toContain('Project "Home" has 1 task (1 in the trash)');
    expect(required.hint).toContain("--move-tasks-to");
    const human = await dayhand(key, ["project", "rm", "Home"]);
    expect(human.code).toBe(6);
    expect(human.stderr).toContain("--move-tasks-to");
    expectFailure(await dayhand(key, ["project", "add", "HOME", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["project", "add", "none", "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["project", "add", "X".repeat(51), "--json"]), 2, "invalid_argument");
    expectFailure(await dayhand(key, ["project", "edit", "Missing", "--note", "x", "--json"]), 4, "not_found");
    expectFailure(await dayhand(key, ["edit", "1", "-p", "Home", "--clear-project", "--json"]), 2, "usage");
    const agent = await createKey(userId, "project-agent", "agent");
    expectFailure(await dayhand(agent.key, ["project", "rm", "Home", "--move-tasks-to", "none", "--json"]), 7, "forbidden");
    const deleted = await dayhandJson(key, ["project", "rm", "Home", "--move-tasks-to", "none"]);
    expect(validate("project-delete.schema.json", deleted)).toEqual([]);
    expect(deleted.moved).toHaveLength(1);
    await dayhandJson(key, ["restore", "1"]);
    expect((await dayhandJson(key, ["show", "1"])).task).not.toHaveProperty("projectId");
  });

  test("7: the owner's controls: agents paused, a policy deny, an approval to wait for", async () => {
    const { userId, key: owner } = await newUser();
    const created = await createKey(userId, "worker", "agent");
    const agent = created.key;
    await dayhand(owner, ["add", "Shared"]);
    expect((await dayhand(owner, ["agents", "pause", "--reason", "lunch"])).code).toBe(0);
    const paused = expectFailure(await dayhand(agent, ["done", "1", "--json"]), 7, "agents_paused");
    expect(paused.message).toContain("lunch");
    expect((await dayhand(agent, ["today"])).code).toBe(0);
    expect((await dayhand(owner, ["agents", "resume"])).code).toBe(0);
    expectFailure(await dayhand(agent, ["agents", "pause", "--json"]), 7, "forbidden");

    expect((await dayhand(owner, ["policy", "set", created.id, "complete_task", "ask"])).code).toBe(0);
    const held = expectFailure(await dayhand(agent, ["done", "1", "--json"]), 7, "approval_required");
    expect(held.approvalId).toEqual(expect.any(String));
    expect(held.hint).toContain(`--approval ${held.approvalId}`);
    expect((await dayhand(owner, ["approvals", "decide", held.approvalId, "allow"])).code).toBe(0);
    expect((await dayhand(agent, ["done", "1", "--approval", held.approvalId])).code).toBe(0);
    expect((await dayhandJson(owner, ["show", "1"])).task.status).toBe("done");
  });

  test("5: backend unreachable, 5xx, or 429 (rate_limited), with a clientId to retry", async () => {
    const { key } = await newUser();
    const closed = `http://127.0.0.1:${await freePort()}`;
    const down = expectFailure(await dayhand(key, ["add", "X", "--json"], { url: closed }), 5, "unavailable");
    expect(down.retryable).toBe(true);
    expect(down.clientId).toMatch(/^[0-9a-f-]{36}$/);
    mode = 503;
    expectFailure(await dayhand(key, ["today", "--json"], { url: proxyUrl }), 5, "unavailable");
    mode = 429;
    const limited = expectFailure(await dayhand(key, ["today", "--json"], { url: proxyUrl }), 5, "rate_limited");
    expect(limited.retryable).toBe(false);
  });

  test("5 then a retry with the same --client-id does not duplicate the change", async () => {
    const { key } = await newUser();
    mode = "lose-answer";
    const lost = expectFailure(await dayhand(key, ["add", "Pay rent", "--client-id", "rent-1", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lost.clientId).toBe("rent-1");
    expect((await dayhand(key, ["add", "Pay rent", "--client-id", "rent-1"])).code).toBe(0);
    // A generated clientId works the same way.
    const generated = expectFailure(await dayhand(key, ["add", "Call mum", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect((await dayhand(key, ["add", "Call mum", "--client-id", generated.clientId])).code).toBe(0);
    // Several tasks: the retry applies the rest once.
    const lostDone = expectFailure(await dayhand(key, ["done", "1", "2", "--client-id", "both", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lostDone.ref).toBe("1");
    const lostCall = expectFailure(await dayhand(key, ["call", "add_task", '{"title":"Via call","clientId":"call-1"}', "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lostCall.clientId).toBe("call-1");
    expect((await dayhand(key, ["call", "add_task", '{"title":"Via call","clientId":"call-1"}'])).code).toBe(0);
    expect((await dayhand(key, ["done", "1", "2", "--client-id", "both"])).code).toBe(0);

    const tasks = (await dayhandJson(key, ["list", "--done"])).result;
    expect(tasks.map((t: { title: string }) => t.title).sort()).toEqual(["Call mum", "Pay rent", "Via call"]);
    expect(tasks.filter((t: { status: string }) => t.status === "done").map((t: { ref: number }) => t.ref)).toEqual([1, 2]);
  });

  test("1: anything else, e.g. no Dayhand backend at the URL", async () => {
    const { key } = await newUser();
    mode = 404;
    expectFailure(await dayhand(key, ["today", "--json"], { url: proxyUrl }), 1, "internal");
  });

  test("errors without --json are one readable line plus a hint, on stderr", async () => {
    const { key } = await newUser();
    const run = await dayhand(key, ["show", "999"]);
    expect(run).toMatchObject({ code: 4, stdout: "" });
    expect(run.stderr).toMatch(/^dayhand: Task #999 not found\n/);
    const down = await dayhand(key, ["add", "X", "--client-id", "abc"], { url: `http://127.0.0.1:${await freePort()}` });
    expect(down.stderr).toContain("Retry safely with: --client-id abc");
  });
});
