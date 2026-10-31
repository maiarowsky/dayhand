import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { normalizeUrl } from "../src/config/url.js";
import { FileStore } from "../src/credentials/file.js";
import { DayhandClient } from "../src/transport/client.js";

const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-security-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("M-01: Bearer keys need TLS outside loopback", () => {
  test.each(["http://192.0.2.1:3211", "http://example.test", "http://localhost.evil.test", "http://127.0.0.1.evil.test", "http://[2001:db8::1]"])("refuses %s before transport", async (url) => {
    const network = vi.fn<typeof fetch>();
    expect(() => normalizeUrl(url)).toThrow(/HTTPS/);
    const client = new DayhandClient({ url, key: "dayhand_sample_only" }, network);
    await expect(client.request("GET", "/devices")).rejects.toMatchObject({ code: "usage", exitCode: 2 });
    expect(network).not.toHaveBeenCalled();
  });

  test.each(["http://localhost:3211", "http://127.0.0.1:3211", "http://[::1]:3211", "https://example.test"])("keeps %s working", async (url) => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const client = new DayhandClient({ url, key: "dayhand_sample_only" }, network);
    expect(await client.request("GET", "/devices")).toEqual({ ok: true });
    expect(network).toHaveBeenCalledWith(`${url}/devices`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer dayhand_sample_only" }) }));
  });
});

describe.skipIf(process.platform === "win32")("L-01: private credentials", () => {
  test("does not read, update or delete keys from a world-readable file", async () => {
    const store = new FileStore(join(dir, "file"));
    await store.set("https://example.test", "dayhand_sample_only");
    chmodSync(store.location, 0o644);
    for (const operation of [() => store.get("https://example.test"), () => store.set("https://example.test", "dayhand_other_sample"), () => store.delete("https://example.test")]) {
      await expect(operation()).rejects.toMatchObject({ code: "config", exitCode: 2 });
    }
    chmodSync(store.location, 0o600);
    expect(await store.get("https://example.test")).toMatchObject({ key: "dayhand_sample_only" });
  });

  test("does not use or create credentials in an existing non-private directory", async () => {
    const configDir = join(dir, "directory");
    const store = new FileStore(configDir);
    await store.set("https://example.test", "dayhand_sample_only");
    chmodSync(configDir, 0o755);
    await expect(store.get("https://example.test")).rejects.toMatchObject({ code: "config" });
    await expect(store.set("https://another.test", "dayhand_other_sample")).rejects.toMatchObject({ code: "config" });
    chmodSync(configDir, 0o700);
    expect(await store.get("https://example.test")).toMatchObject({ key: "dayhand_sample_only" });
  });
});
