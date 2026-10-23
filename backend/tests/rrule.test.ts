// Repeat rules as RFC 5545 RRULE text: writing, reading, the round trip and
// clear errors for what Helm does not support (no backend).
import { describe, expect, test } from "vitest";
import { parseRRule, RRuleError, toRRule } from "../convex/lib/rrule";
import type { RepeatRule } from "../convex/lib/validators";

describe("toRRule", () => {
  const cases: [RepeatRule, string][] = [
    [{ every: "day", interval: 1 }, "FREQ=DAILY"],
    [{ every: "day", interval: 3, count: 10 }, "FREQ=DAILY;INTERVAL=3;COUNT=10"],
    [{ every: "week", interval: 2, weekdays: [4, 1] }, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"],
    [{ every: "month", interval: 1, monthDay: -1 }, "FREQ=MONTHLY;BYMONTHDAY=-1"],
    [{ every: "month", interval: 1, monthDay: 15 }, "FREQ=MONTHLY;BYMONTHDAY=15"],
    [{ every: "month", interval: 1, monthDay: 30 }, "FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1"],
    [{ every: "month", interval: 2, weekdayOfMonth: { nth: -1, weekday: 5 } }, "FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR"],
    [{ every: "month", interval: 1, weekdayOfMonth: { nth: 2, weekday: 2 }, until: "2027-06-30" }, "FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270630"],
    [{ every: "year", interval: 1 }, "FREQ=YEARLY"],
  ];
  test.each(cases)("%j → %s", (rule, text) => expect(toRRule(rule)).toBe(text));

  test("counting from completion has no RRULE form; the dates are the same", () => {
    expect(toRRule({ every: "day", interval: 3, from: "completion" })).toBe("FREQ=DAILY;INTERVAL=3");
  });
  test("a plain monthly rule from the 31st is written as the day it means in Helm", () => {
    expect(toRRule({ every: "month", interval: 1 }, "2026-01-31")).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(toRRule({ every: "month", interval: 1 }, "2026-01-15")).toBe("FREQ=MONTHLY");
  });
});

describe("parseRRule", () => {
  test("reads the subset, with or without RRULE:, in any case", () => {
    expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=MO,TH")).toEqual({ every: "week", interval: 1, weekdays: [1, 4] });
    expect(parseRRule("freq=monthly;byday=-1fr")).toEqual({ every: "month", interval: 1, weekdayOfMonth: { nth: -1, weekday: 5 } });
    expect(parseRRule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2")).toEqual({ every: "month", interval: 1, weekdayOfMonth: { nth: 2, weekday: 2 } });
    expect(parseRRule("FREQ=MONTHLY;BYDAY=+3WE")).toEqual({ every: "month", interval: 1, weekdayOfMonth: { nth: 3, weekday: 3 } });
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=-1")).toEqual({ every: "month", interval: 1, monthDay: -1 });
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1")).toEqual({ every: "month", interval: 1, monthDay: 31 });
    expect(parseRRule("FREQ=YEARLY;INTERVAL=2;COUNT=3")).toEqual({ every: "year", interval: 2, count: 3 });
  });
  test("every weekday written as DAILY;BYDAY is a weekly rule", () => {
    expect(parseRRule("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR")).toEqual({ every: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] });
  });
  test("UNTIL as a date, a floating date-time, or a UTC date-time in the user's zone", () => {
    expect(parseRRule("FREQ=DAILY;UNTIL=20261231").until).toBe("2026-12-31");
    expect(parseRRule("FREQ=DAILY;UNTIL=20261231T120000").until).toBe("2026-12-31");
    // 23:30 UTC on 24 Oct is 00:30 on 25 Oct in London (summer time), 19:30 on 24 Oct in New York.
    expect(parseRRule("FREQ=DAILY;UNTIL=20261024T233000Z", "Europe/London").until).toBe("2026-10-25");
    expect(parseRRule("FREQ=DAILY;UNTIL=20261024T233000Z", "America/New_York").until).toBe("2026-10-24");
  });
  test("WKST=MO is fine; another week start only where it changes nothing", () => {
    expect(parseRRule("FREQ=WEEKLY;WKST=MO;INTERVAL=2;BYDAY=MO,TH").weekdays).toEqual([1, 4]);
    expect(parseRRule("FREQ=WEEKLY;WKST=SU;BYDAY=MO,TH").weekdays).toEqual([1, 4]);
    expect(() => parseRRule("FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SU,MO")).toThrow(/WKST/);
  });

  const errors: [string, RegExp][] = [
    ["", /empty/],
    ["FREQ=HOURLY", /FREQ must be/],
    ["INTERVAL=2", /FREQ is missing/],
    ["FREQ=DAILY;BYHOUR=9", /BYHOUR is not supported/],
    ["FREQ=YEARLY;BYMONTH=3", /BYMONTH is not supported/],
    ["FREQ=DAILY;FREQ=WEEKLY", /given twice/],
    ["FREQ=DAILY;INTERVAL=0", /INTERVAL must be from 1/],
    ["FREQ=DAILY;INTERVAL=x", /whole number/],
    ["FREQ=WEEKLY;BYDAY=1MO", /without numbers/],
    ["FREQ=WEEKLY;BYDAY=XX", /unknown day/],
    ["FREQ=MONTHLY;BYDAY=MO,TU", /one day/],
    ["FREQ=MONTHLY;BYDAY=MO", /needs a position/],
    ["FREQ=MONTHLY;BYDAY=6MO", /nth must be/],
    ["FREQ=MONTHLY;BYMONTHDAY=1,15", /one day/],
    ["FREQ=MONTHLY;BYMONTHDAY=-2", /-1/],
    ["FREQ=MONTHLY;BYMONTHDAY=1,2;BYSETPOS=-1", /28,29,30/],
    ["FREQ=WEEKLY;BYMONTHDAY=1", /only with FREQ=MONTHLY/],
    ["FREQ=YEARLY;BYDAY=MO", /only with FREQ=WEEKLY or FREQ=MONTHLY/],
    ["FREQ=DAILY;BYSETPOS=1", /BYSETPOS is supported only/],
    ["FREQ=DAILY;UNTIL=20261231;COUNT=3", /cannot be combined/],
    ["FREQ=DAILY;UNTIL=2026-12-31", /UNTIL must be/],
    ["FREQ=DAILY;COUNT=0", /COUNT must be from 1/],
    ["FREQ=DAILY;INTERVAL", /NAME=VALUE/],
  ];
  test.each(errors)("refuses %j", (text, message) => {
    expect(() => parseRRule(text)).toThrow(RRuleError);
    expect(() => parseRRule(text)).toThrow(message);
  });
});

describe("round trip", () => {
  const rules: RepeatRule[] = [
    { every: "day", interval: 1 },
    { every: "day", interval: 2, until: "2027-01-31" },
    { every: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] },
    { every: "week", interval: 3, weekdays: [7], count: 4 },
    { every: "month", interval: 1, monthDay: -1 },
    { every: "month", interval: 6, monthDay: 1 },
    { every: "month", interval: 1, monthDay: 29 },
    { every: "month", interval: 1, monthDay: 31, count: 12 },
    { every: "month", interval: 1, weekdayOfMonth: { nth: 1, weekday: 1 } },
    { every: "month", interval: 3, weekdayOfMonth: { nth: -2, weekday: 6 }, until: "2030-12-31" },
    { every: "year", interval: 1, count: 5 },
  ];
  test.each(rules)("%j", (rule) => expect(parseRRule(toRRule(rule))).toEqual(rule));
});
