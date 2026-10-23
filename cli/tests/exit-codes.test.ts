// Exit code matrix (docs/cli.md#exit-codes) against the real local backend.
// Every failure with --json is one {"error":…} line on stderr and nothing on stdout.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freePort } from "./globalSetup.js";
import { createKey, helm, hlm, hlmJson, jsonError, newUser, newUserId, revokeKey, schemaValidator, type Run } from "./helpers.js";

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
    await hlm(key, ["add", "Once"]);
    expect((await hlm(key, ["done", "1"])).code).toBe(0);
    expect((await hlm(key, ["done", "1"])).code).toBe(0);
  });

  test("2: unknown command or flag, bad values and dates, missing --yes", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Task"]);
    const unknownFlag = expectFailure(await hlm(key, ["list", "--bogus", "--json"]), 2, "usage");
    expect(unknownFlag.valid).toContain("--label");
    expectFailure(await hlm(key, ["frobnicate", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["add", "--json"]), 2, "usage"); // missing title
    expectFailure(await hlm(key, ["add", "X", "--due", "someday", "--json"]), 2, "invalid_argument");
    expectFailure(await hlm(key, ["move", "1", "2026-13-45", "--json"]), 2, "invalid_argument");
    expectFailure(await hlm(key, ["add", "X", "--time", "25:00", "--json"]), 2, "invalid_argument");
    expectFailure(await hlm(key, ["board", "--done-limit", "many", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["add", "X", "--every", "week", "--on", "funday", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["add", "X", "--status", "done", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["list", "--fields", "ref,colour", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["show", "nope", "--json"]), 2, "invalid_argument");
    expectFailure(await hlm(key, ["rm", "1", "2", "3", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["call", "add_task", "{not json", "--json"]), 2, "usage");
    expectFailure(await hlm(key, ["call", "no_such_tool", "--json"]), 2, "invalid_argument");
    expectFailure(await hlm(key, ["settings", "set", "colour=red", "--json"]), 2, "usage");
    const badFormat = await hlm(key, ["list"], { env: { HLM_FORMAT: "yaml" } });
    expect(badFormat).toMatchObject({ code: 2, stdout: "" });
    expect(badFormat.stderr).toMatch(/^hlm: HLM_FORMAT must be one of human, plain, json/);
    expectFailure(await hlm(key, ["list", "--json", "--client-id", "has space"]), 2, "usage");
    expectFailure(await hlm(undefined, ["list", "--json"], { url: "" }), 2, "usage"); // no HLM_URL
  });

  test("3: missing, wrong or revoked key", async () => {
    const userId = newUserId();
    const { key, id } = await createKey(userId);
    expect((await hlm(key, ["today"])).code).toBe(0);
    expectFailure(await hlm(undefined, ["today", "--json"]), 3, "unauthenticated");
    expectFailure(await hlm("helm_wrong", ["today", "--json"]), 3, "unauthenticated");
    await revokeKey(userId, id);
    const revoked = await hlm(key, ["add", "After revoke", "--json"]);
    expectFailure(revoked, 3, "unauthenticated");
    expect(revoked.stderr).not.toContain(key);
  });

  test("4: no such task number, now task or device", async () => {
    const { key } = await newUser();
    expectFailure(await hlm(key, ["show", "999", "--json"]), 4, "not_found");
    expectFailure(await hlm(key, ["done", "#999", "--json"]), 4, "not_found");
    expectFailure(await hlm(key, ["done", "now", "--json"]), 4, "not_found");
    expectFailure(await hlm(key, ["device", "revoke", "nope", "--json"]), 4, "not_found");
    await hlm(key, ["add", "Real"]);
    const many = expectFailure(await hlm(key, ["done", "1", "999", "--json"]), 4, "not_found");
    expect(many.ref).toBe("999");
  });

  test("5: backend unreachable, 5xx, or 429 (rate_limited), with a clientId to retry", async () => {
    const { key } = await newUser();
    const closed = `http://127.0.0.1:${await freePort()}`;
    const down = expectFailure(await hlm(key, ["add", "X", "--json"], { url: closed }), 5, "unavailable");
    expect(down.retryable).toBe(true);
    expect(down.clientId).toMatch(/^[0-9a-f-]{36}$/);
    mode = 503;
    expectFailure(await hlm(key, ["today", "--json"], { url: proxyUrl }), 5, "unavailable");
    mode = 429;
    const limited = expectFailure(await hlm(key, ["today", "--json"], { url: proxyUrl }), 5, "rate_limited");
    expect(limited.retryable).toBe(false);
  });

  test("5 then a retry with the same --client-id does not duplicate the change", async () => {
    const { key } = await newUser();
    mode = "lose-answer";
    const lost = expectFailure(await hlm(key, ["add", "Pay rent", "--client-id", "rent-1", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lost.clientId).toBe("rent-1");
    expect((await hlm(key, ["add", "Pay rent", "--client-id", "rent-1"])).code).toBe(0);
    // A generated clientId works the same way.
    const generated = expectFailure(await hlm(key, ["add", "Call mum", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect((await hlm(key, ["add", "Call mum", "--client-id", generated.clientId])).code).toBe(0);
    // Several tasks: the retry applies the rest once.
    const lostDone = expectFailure(await hlm(key, ["done", "1", "2", "--client-id", "both", "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lostDone.ref).toBe("1");
    const lostCall = expectFailure(await hlm(key, ["call", "add_task", '{"title":"Via call","clientId":"call-1"}', "--json"], { url: proxyUrl }), 5, "unavailable");
    expect(lostCall.clientId).toBe("call-1");
    expect((await hlm(key, ["call", "add_task", '{"title":"Via call","clientId":"call-1"}'])).code).toBe(0);
    expect((await hlm(key, ["done", "1", "2", "--client-id", "both"])).code).toBe(0);

    const tasks = (await hlmJson(key, ["list", "--done"])).result;
    expect(tasks.map((t: { title: string }) => t.title).sort()).toEqual(["Call mum", "Pay rent", "Via call"]);
    expect(tasks.filter((t: { status: string }) => t.status === "done").map((t: { ref: number }) => t.ref)).toEqual([1, 2]);
  });

  test("1: anything else, e.g. no Helm backend at the URL", async () => {
    const { key } = await newUser();
    mode = 404;
    expectFailure(await hlm(key, ["today", "--json"], { url: proxyUrl }), 1, "internal");
  });

  test("errors without --json are one readable line plus a hint, on stderr", async () => {
    const { key } = await newUser();
    const run = await hlm(key, ["show", "999"]);
    expect(run).toMatchObject({ code: 4, stdout: "" });
    expect(run.stderr).toMatch(/^hlm: Task #999 not found\n/);
    const down = await hlm(key, ["add", "X", "--client-id", "abc"], { url: `http://127.0.0.1:${await freePort()}` });
    expect(down.stderr).toContain("Retry safely with: --client-id abc");
  });
});
