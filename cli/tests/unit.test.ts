// Pure parts: registry invariants, generated docs, parsers, version rule.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { isCompatible } from "../src/core/version.js";
import { renderDocs } from "../src/docs.js";
import { flatten } from "../src/registry/index.js";
import { parseLink, parseRepeat, parseSettings, parseWeekdays } from "../src/registry/parse.js";

describe("registry", () => {
  test("docs/cli.md is generated from the registry and current (npm run build && npm run docs)", () => {
    expect(readFileSync(new URL("../../docs/cli.md", import.meta.url), "utf8")).toBe(renderDocs());
  });

  test("every runnable command has a unique name, a summary, examples and a JSON schema", () => {
    const commands = flatten().filter(({ spec }) => spec.run);
    const names = flatten().flatMap(({ path, spec }) => [path, ...(spec.aliases ?? []).map((a) => path.replace(/\S+$/, a))]);
    expect(new Set(names).size).toBe(names.length);
    for (const { path, spec } of commands) {
      expect(spec.summary, path).not.toBe("");
      expect(spec.examples?.length, path).toBeGreaterThan(0);
      if (path !== "call") expect(spec.schema, path).toBeDefined();
      for (const file of [spec.schema ?? []].flat()) {
        expect(() => readFileSync(new URL(`../../docs/schemas/${file}`, import.meta.url)), `${path}: ${file}`).not.toThrow();
      }
    }
  });
});

describe("parsers", () => {
  test("weekdays", () => {
    expect(parseWeekdays("mon,thu")).toEqual([1, 4]);
    expect(parseWeekdays("Friday,1,th")).toEqual([1, 4, 5]);
    expect(() => parseWeekdays("t")).toThrow(/Not a weekday/);
    expect(() => parseWeekdays("funday")).toThrow(/Not a weekday/);
  });

  test("repeat rules", () => {
    expect(parseRepeat({})).toBeUndefined();
    expect(parseRepeat({ every: "day" })).toEqual({ every: "day", interval: 1 });
    expect(parseRepeat({ on: "sat" })).toEqual({ every: "week", interval: 1, weekdays: [6] });
    expect(parseRepeat({ every: "month", interval: 3 })).toEqual({ every: "month", interval: 3 });
    expect(() => parseRepeat({ every: "month", on: "mon" })).toThrow(/--on works only/);
  });

  test("links and settings", () => {
    expect(parseLink("https://x.test/a")).toEqual({ url: "https://x.test/a" });
    expect(parseLink("https://x.test/a  The   docs")).toEqual({ url: "https://x.test/a", title: "The docs" });
    expect(parseSettings(["timezone=Europe/London", "summary-time=05:30", "reminders="])).toEqual({
      timezone: "Europe/London",
      summaryTime: "05:30",
      defaultReminderMinutes: [],
    });
    expect(() => parseSettings(["reminders=soon"])).toThrow(/whole number/);
    expect(() => parseSettings(["colour=red"])).toThrow(/known key/);
  });
});

test("server compatibility follows docs/mcp.md#versions", () => {
  expect(isCompatible("0.3.0")).toBe(true);
  expect(isCompatible("0.4.2")).toBe(true);
  expect(isCompatible("0.2.9")).toBe(false);
  expect(isCompatible("1.0.0")).toBe(false);
  expect(isCompatible("garbage")).toBe(false);
});
