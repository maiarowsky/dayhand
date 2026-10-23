// hlm key, hlm webhook and hlm import against the local backend (REST /api/v1):
// each --json output follows its schema, changes that break something ask for
// --yes, --dry-run holds changes (import asks the server instead), and an export
// imported into an empty account gives the same plan.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseExpiry } from "../src/registry/integrations.js";
import { hlm, hlmJson, jsonError, newUser, schemaValidator } from "./helpers.js";

const validate = schemaValidator();
const DAY = 24 * 60 * 60 * 1000;

describe("hlm key", () => {
  test("--expires reads spans, dates and never", () => {
    const now = Date.UTC(2026, 9, 23);
    expect(parseExpiry("90d", now)).toBe(now + 90 * DAY);
    expect(parseExpiry("2w", now)).toBe(now + 14 * DAY);
    expect(parseExpiry("1y", now)).toBe(now + 365 * DAY);
    expect(parseExpiry("2027-01-31", now)).toBe(Date.UTC(2027, 0, 31));
    expect(parseExpiry("never", now)).toBeNull();
    for (const bad of ["0d", "soon", "2020-01-01", "5m"]) expect(() => parseExpiry(bad, now)).toThrow(/--expires/);
  });

  test("create a read key, list it, use it, revoke it", async () => {
    const { key } = await newUser();
    const created = await hlmJson(key, ["key", "create", "n8n", "--expires", "30d"]);
    expect(validate("api-key-created.schema.json", created)).toEqual([]);
    expect(created).toMatchObject({ name: "n8n", kind: "agent", scope: "read", key: expect.stringMatching(/^helm_/) });
    expect(created.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY);

    const listed = await hlmJson(key, ["key", "list"]);
    expect(validate("api-key-list.schema.json", listed)).toEqual([]);
    expect(listed.keys.map((k: { name: string }) => k.name)).toEqual(["macbook", "n8n"]);
    const human = (await hlm(key, ["key"])).stdout;
    expect(human).toContain(`${created.id}  n8n  agent/read  active  expires `);
    expect(human).not.toContain(created.key);

    // The read key reads, but cannot change or manage keys.
    expect((await hlm(created.key, ["today"])).code).toBe(0);
    const write = await hlm(created.key, ["add", "nope", "--json"]);
    expect(write.code).toBe(3);
    const manage = await hlm(created.key, ["key", "list", "--json"]);
    expect(manage.code).toBe(3);
    expect(jsonError(manage).message).toMatch(/scope full/);

    expect(await hlmJson(key, ["key", "create", "x", "--scope", "write", "--dry-run"])).toEqual({
      dryRun: true,
      calls: [{ endpoint: "/api/v1/keys", body: { name: "x", scope: "write", expiresAt: expect.any(Number) } }],
    });
    const refused = await hlm(key, ["key", "revoke", created.id, "--json"]);
    expect(refused.code).toBe(2);
    expect(jsonError(refused).message).toMatch(/without --yes/);
    const dry = await hlmJson(key, ["key", "revoke", created.id, "--dry-run"]);
    expect(dry).toEqual({ dryRun: true, calls: [{ endpoint: `/api/v1/keys/${created.id}`, body: null, method: "DELETE" }] });
    expect(validate("dry-run.schema.json", dry)).toEqual([]);
    const revoked = await hlmJson(key, ["key", "revoke", created.id, "--yes"]);
    expect(validate("api-key-revoke.schema.json", revoked)).toEqual([]);
    expect((await hlm(created.key, ["today", "--json"])).code).toBe(3);

    const badExpiry = await hlm(key, ["key", "create", "y", "--expires", "soon", "--json"]);
    expect(badExpiry.code).toBe(2);
  });
});

describe("hlm webhook", () => {
  test("add (secret once), list, test, deliveries, enable, rm; each --json follows its schema", async () => {
    const { key } = await newUser();
    // .invalid never resolves, so the test message fails without leaving this machine.
    const added = await hlmJson(key, ["webhook", "add", "https://hooks.example.invalid/helm", "-e", "task.completed", "-d", "n8n"]);
    expect(validate("webhook-created.schema.json", added)).toEqual([]);
    expect(added.secret).toMatch(/^whsec_/);
    expect(added.webhook).toMatchObject({ events: ["task.completed"], description: "n8n", enabled: true });
    const id = added.webhook.id as string;

    const listed = await hlmJson(key, ["webhook", "list"]);
    expect(validate("webhook-list.schema.json", listed)).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain(added.secret);
    expect((await hlm(key, ["webhook"])).stdout).toContain(`${id}  https://hooks.example.invalid/helm  on\n    events: task.completed\n    n8n`);

    const queued = await hlmJson(key, ["webhook", "test", id]);
    expect(validate("webhook-test.schema.json", queued)).toEqual([]);
    const deliveries = await hlmJson(key, ["webhook", "deliveries", id, "-n", "5"]);
    expect(validate("webhook-delivery-list.schema.json", deliveries)).toEqual([]);
    expect(deliveries.deliveries[0]).toMatchObject({ type: "webhook.test", eventId: queued.eventId });

    expect(validate("webhook-one.schema.json", await hlmJson(key, ["webhook", "enable", id]))).toEqual([]);
    const http = await hlm(key, ["webhook", "add", "http://hooks.example.com/x", "--json"]);
    expect(http.code).toBe(2);
    expect(jsonError(http).message).toBe("url must be https://");

    expect((await hlm(key, ["webhook", "rm", id, "--json"])).code).toBe(2);
    const removed = await hlmJson(key, ["webhook", "rm", id, "--yes"]);
    expect(validate("webhook-delete.schema.json", removed)).toEqual([]);
    expect(await hlmJson(key, ["webhook", "list"])).toEqual({ webhooks: [] });
    expect((await hlm(key, ["webhook", "test", id, "--json"])).code).toBe(4);
  });
});

describe("hlm import", () => {
  test("an export imported into an empty account gives the same plan; --dry-run stores nothing; again imports nothing", async () => {
    const source = await newUser();
    await hlm(source.key, ["add", "Dentist", "--due", "2026-11-03", "--time", "15:30", "--label", "health"]);
    await hlm(source.key, ["add", "Read a book", "--note", "the long one"]);
    await hlm(source.key, ["add", "Bins", "--due", "2026-11-02", "--every", "week"]);
    await hlm(source.key, ["done", "2", "--yes"]);
    const dir = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-import-"));
    try {
      const file = join(dir, "helm.json");
      await hlm(source.key, ["export", "--format", "json", "-o", file]);

      const target = await newUser();
      const preview = await hlmJson(target.key, ["import", file, "--dry-run"]);
      expect(validate("import-result.schema.json", preview)).toEqual([]);
      expect(preview).toMatchObject({ format: "helm-json", dryRun: true, total: 3, created: 3 });
      expect((await hlmJson(target.key, ["list", "--done", "--archived"])).result).toHaveLength(0);

      const human = (await hlm(target.key, ["import", file])).stdout;
      expect(human).toMatch(/^Imported 3 of 3 task\(s\) \(helm-json\)\./);
      const strip = (list: any[]) =>
        list.map(({ id, createdAt, updatedAt, clientId, completedAt, overdue, ...rest }) => rest).sort((a, b) => a.ref - b.ref);
      const listAll = async (k: string) => (await hlmJson(k, ["list", "--done", "--archived"])).result;
      expect(strip(await listAll(target.key))).toEqual(strip(await listAll(source.key)));

      const again = await hlmJson(target.key, ["import", file]);
      expect(again).toMatchObject({ created: 0, failed: [] });
      expect(again.skipped).toHaveLength(3);

      const csv = join(dir, "todoist.csv");
      writeFileSync(csv, "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\ntask,Call mum @family,,1,1,A,,tomorrow,en,Europe/London\n");
      const fromTodoist = await hlmJson(target.key, ["import", csv]);
      expect(fromTodoist).toMatchObject({ format: "todoist-csv", created: 1 });
      expect((await hlm(target.key, ["import", join(dir, "missing.csv"), "--json"])).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
