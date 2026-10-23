// Pure parts: registry invariants, generated docs, parsers, version rule.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { isCompatible } from "../src/core/version.js";
import { renderDocs } from "../src/docs.js";
import { flatten } from "../src/registry/index.js";
import { describeReminder, describeRepeat } from "../src/render/format.js";
import { editChecklist, itemIndexes, parseReminder, remindersInput } from "../src/registry/model.js";
import { parseLink, parseMonthDay, parseMonthWeekday, parseRepeat, parseSettings, parseWeekdays } from "../src/registry/parse.js";

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

  test("monthly days, nth weekdays, completion, count", () => {
    expect(parseRepeat({ monthDay: "last" })).toEqual({ every: "month", interval: 1, monthDay: -1 });
    expect(parseRepeat({ every: "month", monthWeekday: "2nd tue", count: 6 })).toEqual({
      every: "month",
      interval: 1,
      weekdayOfMonth: { nth: 2, weekday: 2 },
      count: 6,
    });
    expect(parseRepeat({ every: "day", interval: 3, fromCompletion: true })).toEqual({ every: "day", interval: 3, from: "completion" });
    expect(parseRepeat({ fromCompletion: true })).toEqual({ every: "week", interval: 1, from: "completion" });
    expect(() => parseRepeat({ every: "week", monthDay: "3" })).toThrow(/only with --every month/);
    expect(() => parseRepeat({ monthDay: "3", monthWeekday: "1 mon" })).toThrow(/not both/);
    expect(() => parseRepeat({ every: "day", count: 0 })).toThrow(/--count/);
    expect(parseMonthDay("31")).toBe(31);
    expect(() => parseMonthDay("32")).toThrow(/1 to 31/);
    expect(parseMonthWeekday("last fri")).toEqual({ nth: -1, weekday: 5 });
    expect(parseMonthWeekday("-2 sun")).toEqual({ nth: -2, weekday: 7 });
    expect(parseMonthWeekday("3wed")).toEqual({ nth: 3, weekday: 3 });
    expect(parseMonthWeekday("first Monday")).toEqual({ nth: 1, weekday: 1 });
    expect(() => parseMonthWeekday("6 mon")).toThrow(/position/);
    expect(() => parseMonthWeekday("mon")).toThrow(/position/);
  });

  test("reminders", () => {
    expect(["0", "at", "15m", "15", "2h", "1d before"].map(parseReminder)).toEqual([0, 0, 15, 15, 120, 1440].map((minutesBefore) => ({ minutesBefore })));
    expect(parseReminder("9:00")).toEqual({ time: "09:00" });
    expect(parseReminder("18:00 -1d")).toEqual({ time: "18:00", daysBefore: 1 });
    expect(parseReminder("18:00, 2 days before")).toEqual({ time: "18:00", daysBefore: 2 });
    expect(() => parseReminder("soon")).toThrow(/Not a reminder/);
    expect(() => parseReminder("25:00")).toThrow(/Not a reminder/);
    expect(remindersInput({ remind: [], reminders: true })).toBeUndefined();
    expect(remindersInput({ remind: [], reminders: false })).toEqual([]);
    expect(remindersInput({ remind: [], reminders: true, defaultReminders: true })).toBeNull();
    expect(() => remindersInput({ remind: ["15m"], reminders: false })).toThrow(/one of/);
  });

  test("checklist edits keep ids and apply in a fixed order", () => {
    const items = [
      { id: "c1", title: "a", done: false },
      { id: "c2", title: "b", done: true },
      { id: "c3", title: "c", done: false },
    ];
    const none = { add: [], check: [], uncheck: [], move: [], rm: [] };
    expect(editChecklist(items, { ...none, check: ["1,3"], uncheck: ["2"] }).map((i) => i.done)).toEqual([true, false, true]);
    expect(editChecklist(items, { ...none, move: ["3:1"] }).map((i) => i.id)).toEqual(["c3", "c1", "c2"]);
    expect(editChecklist(items, { ...none, rm: ["2"], add: ["d"] })).toEqual([items[0], items[2], { title: "d" }]);
    expect(itemIndexes(["all"], 3)).toEqual([0, 1, 2]);
    expect(() => itemIndexes(["4"], 3)).toThrow(/1 to 3/);
    expect(() => itemIndexes(["1"], 0)).toThrow(/no checklist/);
    expect(() => editChecklist(items, { ...none, move: ["1-2"] })).toThrow(/from>:<to/);
  });

  test("rules and reminders in words", () => {
    expect(describeRepeat({ every: "month", interval: 1, monthDay: -1, count: 3 })).toBe("every month on the last day, 3 times");
    expect(describeRepeat({ every: "month", interval: 2, weekdayOfMonth: { nth: 2, weekday: 2 } })).toBe("every 2 months on the 2nd Tue");
    expect(describeRepeat({ every: "day", interval: 3, from: "completion", until: "2026-12-31" })).toBe(
      "every 3 days, from completion, until 2026-12-31",
    );
    expect([{ minutesBefore: 0 }, { minutesBefore: 90 }, { minutesBefore: 120 }, { minutesBefore: 2880 }].map(describeReminder)).toEqual([
      "at the due time",
      "90 min before",
      "2 h before",
      "2 days before",
    ]);
    expect(describeReminder({ time: "18:00", daysBefore: 1 })).toBe("18:00 1 day before");
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
