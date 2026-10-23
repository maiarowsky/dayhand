// hlm calendar against the local backend: the feed's addresses, turning it
// on, a new address, off, and the .ics export; --json follows the schemas.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { hlm, hlmJson, jsonError, newUser, schemaValidator } from "./helpers.js";

const validate = schemaValidator();
const tokenOf = (url: string) => /\/cal\/([A-Za-z0-9_-]{44})\.ics$/.exec(url)![1];

describe("hlm calendar", () => {
  test("off, on, show, rotate and off, each answer following its schema", async () => {
    const { key } = await newUser();
    const off = await hlmJson(key, ["calendar"]);
    expect(off).toEqual({ feed: null });
    expect(validate("calendar-feed.schema.json", off)).toEqual([]);
    expect((await hlm(key, ["calendar"])).stdout).toBe("The calendar feed is off. Turn it on with: hlm calendar on\n");

    const on = await hlmJson(key, ["calendar", "on"]);
    expect(validate("calendar-feed.schema.json", on)).toEqual([]);
    const first = on.feed.url as string;
    expect((await fetch(first)).status).toBe(200);
    expect(await hlmJson(key, ["calendar", "url"])).toEqual(on);
    const human = (await hlm(key, ["calendar"])).stdout;
    expect(human).toContain(`  ${first}\n`);
    expect(human).toContain(`  ${on.feed.webcalUrl}\n`);
    expect(human).toContain("Google refreshes subscribed calendars slowly");

    // Breaking subscriptions needs --yes without a terminal.
    const refused = await hlm(key, ["calendar", "rotate", "--json"]);
    expect(refused.code).toBe(2);
    expect(jsonError(refused).message).toMatch(/without --yes/);
    const rotated = await hlmJson(key, ["calendar", "rotate", "--yes"]);
    expect(tokenOf(rotated.feed.url)).not.toBe(tokenOf(first));
    expect((await fetch(first)).status).toBe(404);

    const dry = await hlmJson(key, ["calendar", "off", "--dry-run"]);
    expect(dry).toEqual({ dryRun: true, calls: [{ endpoint: "/calendar/feed/revoke", body: null }] });
    expect((await fetch(rotated.feed.url)).status).toBe(200);

    const revoked = await hlmJson(key, ["calendar", "off", "--yes"]);
    expect(revoked).toEqual({ revoked: true });
    expect(validate("calendar-revoke.schema.json", revoked)).toEqual([]);
    expect((await fetch(rotated.feed.url)).status).toBe(404);
    expect((await hlm(key, ["calendar", "off", "--yes"])).stdout).toBe("The calendar feed was already off.\n");
  });

  test("calendar export and export --format ics write the same iCalendar file", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Dentist", "--due", "2026-11-03", "--time", "15:30"]);
    const dir = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-ics-"));
    try {
      const file = join(dir, "helm.ics");
      expect(await hlmJson(key, ["calendar", "export", "-o", file])).toEqual({ written: file, format: "ics" });
      const text = readFileSync(file, "utf8");
      expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
      expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
      expect(text).toContain("SUMMARY:Dentist\r\n");
      expect(text).toContain("DTSTART;TZID=Europe/London:20261103T153000\r\n");

      const other = join(dir, "other.ics");
      await hlm(key, ["export", "--format", "ics", "-o", other]);
      expect(readFileSync(other, "utf8")).toBe(text);
      expect((await hlm(key, ["calendar", "export"])).stdout).toBe(text);
      const json = await hlmJson(key, ["calendar", "export"]);
      expect(json).toEqual({ format: "ics", content: text });
      expect(validate("export.schema.json", json)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
