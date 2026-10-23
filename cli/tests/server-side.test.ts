// What hlm leaves to a 0.4 backend (list filters and pages, dry-run checks)
// and how it still works with a 0.3 backend, played here by a small fake
// that rejects the arguments 0.3 did not know.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { hlm, hlmJson, jsonError, newUser, schemaValidator } from "./helpers.js";

const validate = schemaValidator();

describe("with a 0.4 backend", () => {
  test("--limit pages on the server and --cursor continues", async () => {
    const { key } = await newUser();
    for (const title of ["One", "Two", "Three"]) await hlm(key, ["add", title, "--due", "today"]);
    const first = await hlmJson(key, ["list", "--limit", "2"]);
    expect(validate("task-list.schema.json", first)).toEqual([]);
    expect(first).toMatchObject({ total: 3, nextCursor: expect.any(String) });
    expect(first.result.map((t: { title: string }) => t.title)).toEqual(["One", "Two"]);
    const rest = await hlmJson(key, ["list", "--limit", "2", "--cursor", first.nextCursor]);
    expect(rest).toMatchObject({ total: 3, nextCursor: null, result: [{ title: "Three" }] });
    expect(jsonError(await hlm(key, ["list", "--cursor", "garbage", "--json"]))).toMatchObject({ code: "invalid_argument", exitCode: 2 });
    expect((await hlm(key, ["list", "--limit", "0"])).code).toBe(2);
  });

  test("--dry-run gets the backend's preview, and a change the backend rejects fails the dry run", async () => {
    const { key } = await newUser();
    const run = await hlmJson(key, ["add", "Pay", "rent", "--due", "tomorrow", "--dry-run", "--client-id", "c9"]);
    expect(validate("dry-run.schema.json", run)).toEqual([]);
    expect(run.calls[0].result).toMatchObject({ title: "Pay rent", status: "todo", dryRun: true });
    const human = await hlm(key, ["add", "Pay", "--dry-run"]);
    expect(human.stdout).toMatch(/^Dry run: nothing was changed\. Would call:\n {2}add_task \{.*\}\n {4}→ #1 Pay \(todo\)\n$/);
    const tooLong = await hlm(key, ["add", "x".repeat(600), "--dry-run", "--json"]);
    expect(jsonError(tooLong)).toMatchObject({ code: "invalid_argument", exitCode: 2, message: /title is longer/ });
    expect((await hlmJson(key, ["list"])).result).toEqual([]);
  });
});

// ---- A fake backend: 0.3.0, or one that refuses every call as rate limited ----

type Mode = "old" | "limited" | "http429";

const TASKS = [
  { id: "a", ref: 1, title: "Call the accountant", status: "todo", isNow: false, labels: [], links: [], createdAt: 1, updatedAt: 1, dueDate: "2026-10-20", overdue: true },
  { id: "b", ref: 2, title: "Water plants", status: "todo", isNow: false, labels: [], links: [], createdAt: 2, updatedAt: 2 },
];
const NEW_ARGS = ["query", "status", "dueBefore", "dueAfter", "overdue", "limit", "cursor", "dryRun"];

function toolResult(name: string, args: Record<string, unknown>, mode: Mode) {
  if (mode === "limited") {
    const error = { code: "rate_limited", message: "Too many changes with this API key: at most 60 a minute. Try again in 12 s.", retryAfterMs: 11_500 };
    return { content: [{ type: "text", text: error.message }], structuredContent: { error }, isError: true };
  }
  const extra = Object.keys(args).find((k) => NEW_ARGS.includes(k));
  if (extra) {
    const message = `Invalid arguments: ArgumentValidationError: Object contains extra field \`${extra}\` that is not in the validator.`;
    return { content: [{ type: "text", text: message }], structuredContent: { error: { code: "invalid_argument", message } }, isError: true };
  }
  if (name === "get_settings") return { content: [], structuredContent: { timezone: "Europe/London", summaryTime: "05:00", defaultReminderMinutes: [0] } };
  if (name === "list_all") return { content: [], structuredContent: { result: TASKS } };
  return { content: [], structuredContent: { ...TASKS[0], title: String(args.title ?? TASKS[0]!.title) } };
}

let server: Server;
let mode: Mode = "old";
let calls: { name: string; args: Record<string, unknown> }[] = [];
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (mode === "http429") {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "7" }).end("{}");
        return;
      }
      const message = JSON.parse(body);
      const { name, arguments: args = {} } = message.params ?? {};
      calls.push({ name, args });
      const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "helm", version: "0.3.0" } } : toolResult(name, args, mode);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const fake = (args: string[], as: Mode = "old") => {
  mode = as;
  calls = [];
  return hlm("helm_fake", args, { url });
};

describe("with a 0.3 backend", () => {
  test("list filters fall back to filtering the full list here", async () => {
    const run = await fake(["list", "--search", "ACCOUNT", "--json"]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ result: [TASKS[0]] });
    expect(calls.map((c) => c.args.query)).toEqual(["ACCOUNT", undefined]);
    expect(JSON.parse((await fake(["list", "--overdue", "--limit", "5", "--json"])).stdout).result).toEqual([TASKS[0]]);
    expect(jsonError(await fake(["list", "--cursor", "x", "--json"]))).toMatchObject({ code: "usage", message: /needs backend 0\.4\.0/ });
  });

  test("--dry-run only lists the change it would send", async () => {
    const run = await fake(["add", "Pay", "--no-due", "--dry-run", "--json", "--client-id", "c1"]);
    expect(JSON.parse(run.stdout)).toEqual({ dryRun: true, calls: [{ tool: "add_task", arguments: { title: "Pay", clientId: "c1" } }] });
    expect(calls).toEqual([{ name: "add_task", args: { title: "Pay", clientId: "c1", dryRun: true } }]);
  });
});

describe("rate limits", () => {
  test("a rate_limited tool error and HTTP 429 exit with 5 and say how long to wait", async () => {
    const limited = jsonError(await fake(["add", "Pay", "--json"], "limited"));
    expect(limited).toMatchObject({ code: "rate_limited", exitCode: 5, message: /at most 60 a minute/, hint: "run the same command again in 12 s" });
    const http = jsonError(await fake(["today", "--json"], "http429"));
    expect(http).toMatchObject({ code: "rate_limited", exitCode: 5, message: "Too many requests with this API key; try again in 7 s" });
  });
});
