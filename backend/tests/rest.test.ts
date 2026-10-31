// The REST API /api/v1 against the local backend: authentication and scopes,
// problem details, Idempotency-Key, ETag and If-Match, dry runs, limits,
// API keys made with a key, and the public OpenAPI document.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, createKey, helm, newUserId, rest } from "./helpers";

async function owner(scope?: "read" | "write" | "full") {
  const userId = newUserId();
  const key = scope
    ? ((await admin().action(internal.apiKeys.create, { userId, actor: "app", name: "integration", kind: "agent", scope })) as { key: string }).key
    : await createKey(userId, "integration", "agent");
  return { userId, key };
}

const expectProblem = (answer: { status: number; headers: Headers; body: any }, status: number, code: string) => {
  expect(answer.status).toBe(status);
  expect(answer.headers.get("content-type")).toBe("application/problem+json");
  expect(answer.body).toMatchObject({ type: `https://schemas.dayhand.invalid/problems/${code}`, status, code, title: expect.any(String), detail: expect.any(String) });
};

describe("REST API: who may call", () => {
  test("no key, a wrong key or an OAuth token get 401 problem details", async () => {
    expectProblem(await rest(null, "GET", "/today"), 401, "unauthenticated");
    const wrong = await rest("helm_nope", "GET", "/today");
    expectProblem(wrong, 401, "unauthenticated");
    expect(wrong.headers.get("www-authenticate")).toBe('Bearer realm="dayhand"');
    const oauth = await rest("helmat_abc.def", "GET", "/today");
    expectProblem(oauth, 401, "unauthenticated");
    expect(oauth.body.detail).toMatch(/only for \/mcp/);
  });

  test("a read key reads but cannot change; a write key cannot manage keys", async () => {
    const read = await owner("read");
    expect((await rest(read.key, "GET", "/today")).status).toBe(200);
    expectProblem(await rest(read.key, "POST", "/tasks", { body: { title: "x" } }), 403, "insufficient_scope");
    const write = await owner("write");
    expect((await rest(write.key, "POST", "/tasks", { body: { title: "x" } })).status).toBe(201);
    expectProblem(await rest(write.key, "GET", "/keys"), 403, "insufficient_scope");
  });

  test("unknown routes are 404 and other methods 405 with Allow", async () => {
    const { key } = await owner();
    expectProblem(await rest(key, "GET", "/nope"), 404, "not_found");
    const wrongMethod = await rest(key, "DELETE", "/today");
    expectProblem(wrongMethod, 405, "method_not_allowed");
    expect(wrongMethod.headers.get("allow")).toBe("GET");
  });

  test("the OpenAPI document needs no key and names this deployment", async () => {
    const answer = await rest(null, "GET", "/openapi.json");
    expect(answer.status).toBe(200);
    expect(answer.body.openapi).toBe("3.1.0");
    expect(answer.body.servers).toEqual([{ url: `${helm().siteUrl}/api/v1` }]);
    expect(answer.body.paths["/tasks/{taskId}"].patch["x-mcp-tool"]).toBe("update_task");
  });
});

describe("REST API: tasks", () => {
  test("POST /tasks is 201 with Location and ETag; GET by number or id gives the same task", async () => {
    const { key } = await owner();
    const created = await rest(key, "POST", "/tasks", { body: { title: "Dentist", dueDate: "2026-11-03", dueTime: "15:30" } });
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`/api/v1/tasks/${created.body.ref}`);
    expect(created.headers.get("etag")).toBe(`"${created.body.updatedAt}"`);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const byRef = await rest(key, "GET", `/tasks/${created.body.ref}`);
    const byId = await rest(key, "GET", `/tasks/${created.body.id}`);
    const byHash = await rest(key, "GET", `/tasks/%23${created.body.ref}`);
    expect(byRef.body.task).toMatchObject({ id: created.body.id, title: "Dentist" });
    expect(byId.body).toEqual(byRef.body);
    expect(byHash.body).toEqual(byRef.body);
    expect(byRef.headers.get("etag")).toBe(created.headers.get("etag"));
  });

  test("validation errors are 422 with the domain's message; bad JSON 400; another type 415", async () => {
    const { key } = await owner();
    const bad = await rest(key, "POST", "/tasks", { body: { title: "x", dueDate: "someday" } });
    expectProblem(bad, 422, "invalid_argument");
    expect(bad.body.detail).toBe('dueDate must be YYYY-MM-DD, "today" or "tomorrow", got "someday"');
    expectProblem(await rest(key, "POST", "/tasks", { body: { title: "x", colour: "red" } }), 422, "invalid_argument");
    expectProblem(await rest(key, "POST", "/tasks", { body: { title: "x", userId: "someone|else" } }), 422, "invalid_argument");
    expectProblem(await rest(key, "GET", "/tasks?colour=red"), 422, "invalid_argument");
    expectProblem(await rest(key, "GET", "/tasks?limit=many"), 422, "invalid_argument");
    expectProblem(await rest(key, "POST", "/tasks", { body: "{nope" }), 400, "invalid_argument");
    const text = await rest(key, "POST", "/tasks", { body: "title=x", headers: { "Content-Type": "text/plain" } });
    expectProblem(text, 415, "unsupported_media_type");
    expectProblem(await rest(key, "GET", "/tasks/404"), 404, "not_found");
  });

  test("a repeated Idempotency-Key does not create a second task", async () => {
    const { key } = await owner();
    const headers = { "Idempotency-Key": "8a6f6b2e-2d1c-4f52-9a43-6c1e0f3b7d10" };
    const first = await rest(key, "POST", "/tasks", { body: { title: "Once" }, headers });
    const again = await rest(key, "POST", "/tasks", { body: { title: "Once" }, headers });
    expect(again.body.id).toBe(first.body.id);
    expect((await rest(key, "GET", "/tasks")).body.total).toBe(1);
    expectProblem(await rest(key, "POST", "/tasks", { body: { title: "Once", clientId: "other" }, headers }), 422, "invalid_argument");
  });

  test("If-Match: the current ETag applies the change, an old one gets 412; If-None-Match gives 304", async () => {
    const { key } = await owner();
    const created = await rest(key, "POST", "/tasks", { body: { title: "Draft" } });
    const ref = created.body.ref;
    const v1 = created.headers.get("etag")!;
    const patched = await rest(key, "PATCH", `/tasks/${ref}`, {
      body: { title: "Final", note: "ready" },
      headers: { "If-Match": v1, "Content-Type": "application/merge-patch+json", "Idempotency-Key": "patch-1" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ title: "Final", note: "ready" });
    const v2 = patched.headers.get("etag")!;
    expect(v2).not.toBe(v1);

    const stale = await rest(key, "PATCH", `/tasks/${ref}`, { body: { title: "Lost update" }, headers: { "If-Match": v1 } });
    expectProblem(stale, 412, "precondition_failed");
    expectProblem(await rest(key, "POST", `/tasks/${ref}/complete`, { headers: { "If-Match": v1 } }), 412, "precondition_failed");
    expect((await rest(key, "GET", `/tasks/${ref}`)).body.task.title).toBe("Final");

    // A retry of the applied change with its Idempotency-Key still answers, though the version moved on.
    const retry = await rest(key, "PATCH", `/tasks/${ref}`, {
      body: { title: "Final", note: "ready" },
      headers: { "If-Match": v1, "Idempotency-Key": "patch-1" },
    });
    expect(retry.status).toBe(200);

    // null clears a field (JSON Merge Patch); * matches any version.
    const cleared = await rest(key, "PATCH", `/tasks/${ref}`, { body: { note: null }, headers: { "If-Match": "*" } });
    expect(cleared.body.note).toBeUndefined();
    const v3 = cleared.headers.get("etag")!;
    const notModified = await rest(key, "GET", `/tasks/${ref}`, { headers: { "If-None-Match": v3 } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(v3);
  });

  test("dryRun=true checks a change and saves nothing", async () => {
    const { key } = await owner();
    const preview = await rest(key, "POST", "/tasks?dryRun=true", { body: { title: "Maybe" } });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ title: "Maybe", dryRun: true });
    expect((await rest(key, "GET", "/tasks")).body.total).toBe(0);
    expectProblem(await rest(key, "GET", "/today?dryRun=true"), 422, "invalid_argument");
  });

  test("pages carry a Link to the next one", async () => {
    const { key } = await owner();
    for (const title of ["a", "b", "c"]) await rest(key, "POST", "/tasks", { body: { title } });
    const page = await rest(key, "GET", "/tasks?limit=2&status=todo,doing");
    expect(page.body.result).toHaveLength(2);
    expect(page.body.total).toBe(3);
    expect(page.headers.get("link")).toBe(`</api/v1/tasks?limit=2&status=todo%2Cdoing&cursor=${page.body.nextCursor}>; rel="next"`);
    const next = await rest(key, "GET", `/tasks?limit=2&status=todo&status=doing&cursor=${page.body.nextCursor}`);
    expect(next.body.result.map((t: { title: string }) => t.title)).toEqual(["c"]);
    expect(next.headers.get("link")).toBeNull();
  });
});

describe("REST API: limits", () => {
  test("every answer carries X-RateLimit-*; over the limit is 429 with Retry-After and nothing applied", async () => {
    const { userId, key } = await owner();
    const first = await rest(key, "GET", "/today");
    expect(first.headers.get("x-ratelimit-limit")).toBe("120");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("119");
    expect(Number(first.headers.get("x-ratelimit-reset"))).toBeGreaterThan(Date.now() / 1000);

    const [{ id: keyId }] = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as { id: string }[];
    for (let i = 0; i < 60; i++) await admin().mutation(internal.callLimits.consume, { keyId, kind: "write" });
    const refused = await rest(key, "POST", "/tasks", { body: { title: "too many" } });
    expectProblem(refused, 429, "rate_limited");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(refused.body.retryAfterMs).toBeGreaterThan(0);
    expect((await rest(key, "GET", "/tasks")).body.total).toBe(0);
  });
});

describe("REST API: API keys", () => {
  test("an owner's full key creates a read key by default; it reads, cannot write, and dies with its parent", async () => {
    const { userId } = await owner();
    const key = await createKey(userId, "terminal", "cli");
    const created = await rest(key, "POST", "/keys", { body: { name: "n8n" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "n8n", kind: "agent", scope: "read", expiresAt: null, key: expect.stringMatching(/^dayhand_/) });
    const child = created.body.key as string;
    expect((await rest(child, "GET", "/today")).status).toBe(200);
    expectProblem(await rest(child, "POST", "/tasks", { body: { title: "x" } }), 403, "insufficient_scope");
    expectProblem(await rest(child, "GET", "/keys"), 403, "insufficient_scope");

    const listed = await rest(key, "GET", "/keys");
    expect(listed.body.keys.find((k: { id: string }) => k.id === created.body.id)).toMatchObject({ scope: "read", createdWith: expect.any(String) });
    expect(JSON.stringify(listed.body)).not.toContain(child);

    expectProblem(await rest(key, "POST", "/keys", { body: { name: "root", scope: "full" } }), 422, "invalid_argument");
    const expiring = await rest(key, "POST", "/keys", { body: { name: "short", scope: "write", expiresAt: Date.now() + 60_000 } });
    expect(expiring.body).toMatchObject({ scope: "write", expiresAt: expect.any(Number) });

    const parentId = listed.body.keys.find((k: { id: string }) => k.id === created.body.id).createdWith;
    const revoked = await rest(key, "DELETE", `/keys/${created.body.id}`);
    expect(revoked.body).toEqual({ id: created.body.id, revokedAt: expect.any(Number) });
    expectProblem(await rest(child, "GET", "/today"), 401, "unauthenticated");
    expect((await rest(expiring.body.key, "GET", "/today")).status).toBe(200);
    await rest(key, "DELETE", `/keys/${parentId}`);
    expectProblem(await rest(expiring.body.key, "GET", "/today"), 401, "unauthenticated");
  });

  test("an agent key cannot mint a cli key, so it never gets the owner's tools; a cli key can", async () => {
    const { userId, key } = await owner();
    expectProblem(await rest(key, "POST", "/keys", { body: { name: "owner", kind: "cli", scope: "write" } }), 403, "forbidden");
    expect((await rest(key, "GET", "/keys")).body.keys).toHaveLength(1);

    const cli = await createKey(userId, "terminal", "cli");
    const created = await rest(cli, "POST", "/keys", { body: { name: "script", kind: "cli", scope: "write" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "cli", scope: "write" });
  });
});
