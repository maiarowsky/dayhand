// Pure repeat logic (no backend): month ends, leap years, nth weekdays, counting
// from completion, until/count, London's clock changes, and the promise that
// listing a series ahead gives the dates completing it would create.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { localDate } from "../convex/lib/dates";
import { advance, monthDayIn, nthWeekdayIn, occurrences, validateRepeat } from "../convex/lib/repeat";
import { parseRRule } from "../convex/lib/rrule";
import type { RepeatRule } from "../convex/lib/validators";
import { asUser, newUserId, utc } from "./helpers";

const monthly = (extra: Partial<RepeatRule> = {}): RepeatRule => ({ every: "month", interval: 1, ...extra });
const year = { from: "2026-01-01", to: "2031-12-31" };

/** Completes each occurrence on its own day, `n` times, and returns the due dates. */
function completeOnTime(rule: RepeatRule, start: string, n: number): string[] {
  const dates = [start];
  let current = { dueDate: start, repeat: rule };
  while (dates.length < n) {
    const next = advance(current.repeat, current.dueDate, current.dueDate);
    if (!next) break;
    dates.push(next.dueDate);
    current = next;
  }
  return dates;
}

describe("month ends", () => {
  test("the last day of the month (monthDay -1)", () => {
    expect(occurrences(monthly({ monthDay: -1 }), "2026-01-31", year, 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
  test("31 Jan with the last day: 28 Feb, then 31 Mar (acceptance C.4)", () => {
    const rule = monthly({ monthDay: -1 });
    const feb = advance(rule, "2026-01-31", "2026-01-31")!;
    expect(feb.dueDate).toBe("2026-02-28");
    expect(advance(feb.repeat, feb.dueDate, feb.dueDate)!.dueDate).toBe("2026-03-31");
  });
  test("day 31 falls on a shorter month's last day and comes back", () => {
    expect(occurrences(monthly({ monthDay: 31 }), "2026-01-31", year, 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
  test("a plain monthly rule from the 31st keeps the 31st after February", () => {
    const feb = advance(monthly(), "2026-01-31", "2026-01-31")!;
    expect(feb).toEqual({ dueDate: "2026-02-28", repeat: monthly({ monthDay: 31 }) });
    expect(advance(feb.repeat, feb.dueDate, feb.dueDate)!.dueDate).toBe("2026-03-31");
  });
  test("a plain monthly rule from the 30th", () => {
    expect(completeOnTime(monthly(), "2026-01-30", 4)).toEqual(["2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30"]);
  });
  test("a plain monthly rule from the 15th is not pinned", () => {
    expect(advance(monthly(), "2026-01-15", "2026-01-15")).toEqual({ dueDate: "2026-02-15", repeat: monthly() });
  });
  test("a monthDay later in the same month comes first", () => {
    expect(advance(monthly({ monthDay: -1 }), "2026-01-10", "2026-01-10")!.dueDate).toBe("2026-01-31");
  });
  test("monthDayIn and nthWeekdayIn", () => {
    expect(monthDayIn("2026-02-01", 30)).toBe("2026-02-28");
    expect(monthDayIn("2026-04-01", -1)).toBe("2026-04-30");
    expect(nthWeekdayIn("2026-10-01", 2, 2)).toBe("2026-10-13");
    expect(nthWeekdayIn("2026-10-01", -1, 5)).toBe("2026-10-30");
    expect(nthWeekdayIn("2026-02-01", 5, 1)).toBeNull();
    expect(nthWeekdayIn("2026-03-01", 5, 1)).toBe("2026-03-30");
  });
});

describe("leap years", () => {
  test("day 29 lands on 29 Feb in a leap year and 28 Feb otherwise", () => {
    expect(occurrences(monthly({ monthDay: 29 }), "2028-01-29", year, 3)).toEqual(["2028-01-29", "2028-02-29", "2028-03-29"]);
    expect(occurrences(monthly({ monthDay: 29 }), "2027-01-29", year, 3)).toEqual(["2027-01-29", "2027-02-28", "2027-03-29"]);
  });
  test("the last day of February in leap and common years", () => {
    expect(occurrences(monthly({ monthDay: -1 }), "2028-01-31", year, 2)).toEqual(["2028-01-31", "2028-02-29"]);
    expect(occurrences(monthly({ monthDay: -1 }), "2029-01-31", year, 2)).toEqual(["2029-01-31", "2029-02-28"]);
  });
  test("yearly from 29 Feb falls on 28 Feb in common years", () => {
    expect(advance({ every: "year", interval: 1 }, "2028-02-29", "2028-02-29")!.dueDate).toBe("2029-02-28");
    expect(advance({ every: "year", interval: 4 }, "2028-02-29", "2028-02-29")!.dueDate).toBe("2032-02-29");
  });
  test("daily across 29 Feb", () => {
    expect(occurrences({ every: "day", interval: 1 }, "2028-02-28", year, 3)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

describe("nth weekday of the month", () => {
  test("second Tuesday", () => {
    const rule = monthly({ weekdayOfMonth: { nth: 2, weekday: 2 } });
    expect(occurrences(rule, "2026-10-13", year, 4)).toEqual(["2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12"]);
  });
  test("last Friday, every other month", () => {
    const rule: RepeatRule = { every: "month", interval: 2, weekdayOfMonth: { nth: -1, weekday: 5 } };
    expect(occurrences(rule, "2026-10-30", year, 4)).toEqual(["2026-10-30", "2026-12-25", "2027-02-26", "2027-04-30"]);
  });
  test("a fifth Monday skips months without one", () => {
    const rule = monthly({ weekdayOfMonth: { nth: 5, weekday: 1 } });
    expect(advance(rule, "2026-01-01", "2026-01-01")!.dueDate).toBe("2026-03-30");
    expect(advance(rule, "2026-03-30", "2026-03-30")!.dueDate).toBe("2026-06-29");
  });
  test("a due date before this month's occurrence moves to it", () => {
    expect(advance(monthly({ weekdayOfMonth: { nth: 2, weekday: 2 } }), "2026-10-01", "2026-10-01")!.dueDate).toBe("2026-10-13");
  });
});

describe("counting from completion", () => {
  const every3 = { every: "day" as const, interval: 3, from: "completion" as const };
  test("the next date is counted from the day it is done, not the due date (acceptance C.5)", () => {
    expect(advance(every3, "2026-10-02", "2026-10-22")!.dueDate).toBe("2026-10-25");
    expect(advance({ ...every3, from: "due" }, "2026-10-02", "2026-10-22")!.dueDate).toBe("2026-10-23");
  });
  test("done early also counts from the day it is done", () => {
    expect(advance(every3, "2026-10-30", "2026-10-22")!.dueDate).toBe("2026-10-25");
  });
  test("weekly on Monday, done on a Wednesday", () => {
    expect(advance({ every: "week", interval: 1, weekdays: [1], from: "completion" }, "2026-10-12", "2026-10-21")!.dueDate).toBe(
      "2026-10-26",
    );
  });
  test("last day of the month, done on 5 March", () => {
    expect(advance(monthly({ monthDay: -1, from: "completion" }), "2026-02-28", "2026-03-05")!.dueDate).toBe("2026-03-31");
  });
});

describe("until and count", () => {
  const daily: RepeatRule = { every: "day", interval: 1 };
  test("count is the occurrences left, this one included", () => {
    expect(advance({ ...daily, count: 3 }, "2026-10-20", "2026-10-20")).toEqual({
      dueDate: "2026-10-21",
      repeat: { ...daily, count: 2 },
    });
    expect(advance({ ...daily, count: 1 }, "2026-10-20", "2026-10-20")).toBeNull();
  });
  test("dates skipped by a late completion are used up", () => {
    expect(advance({ ...daily, count: 3 }, "2026-10-20", "2026-10-22")).toBeNull();
    expect(advance({ ...daily, count: 5 }, "2026-10-20", "2026-10-22")).toEqual({
      dueDate: "2026-10-23",
      repeat: { ...daily, count: 2 },
    });
  });
  test("until is the last date the series may fall on", () => {
    expect(advance({ ...daily, until: "2026-10-21" }, "2026-10-20", "2026-10-20")!.dueDate).toBe("2026-10-21");
    expect(advance({ ...daily, until: "2026-10-21" }, "2026-10-21", "2026-10-21")).toBeNull();
  });
  test("occurrences respect both", () => {
    expect(occurrences({ every: "day", interval: 3, count: 5 }, "2026-10-22", year)).toEqual([
      "2026-10-22",
      "2026-10-25",
      "2026-10-28",
      "2026-10-31",
      "2026-11-03",
    ]);
    expect(occurrences({ every: "week", interval: 1, weekdays: [5], until: "2026-11-13" }, "2026-10-23", year)).toEqual([
      "2026-10-23",
      "2026-10-30",
      "2026-11-06",
      "2026-11-13",
    ]);
  });
  test("the range and the limit cut the list", () => {
    expect(occurrences(daily, "2026-10-01", { from: "2026-10-30", to: "2026-11-02" })).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(occurrences(daily, "2026-10-01", year, 2)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("London's clock changes (Europe/London)", () => {
  const daily: RepeatRule = { every: "day", interval: 1, from: "completion" };
  const doneAt = (iso: string) => advance(daily, undefined, localDate(utc(iso), "Europe/London"))!.dueDate;
  test("autumn: 23:30 UTC on 24 Oct is already 25 Oct in London (BST)", () => {
    expect(doneAt("2026-10-24T23:30")).toBe("2026-10-26");
  });
  test("autumn: 23:30 UTC on 25 Oct is still 25 Oct in London (GMT)", () => {
    expect(doneAt("2026-10-25T23:30")).toBe("2026-10-26");
  });
  test("spring: 23:30 UTC on 28 Mar is 28 Mar (GMT), on 29 Mar it is 30 Mar (BST)", () => {
    expect(doneAt("2026-03-28T23:30")).toBe("2026-03-29");
    expect(doneAt("2026-03-29T23:30")).toBe("2026-03-31");
  });
  test("weekly dates do not move across the change", () => {
    expect(occurrences({ every: "week", interval: 1 }, "2026-10-18", year, 3)).toEqual(["2026-10-18", "2026-10-25", "2026-11-01"]);
    expect(occurrences({ every: "week", interval: 1 }, "2026-03-22", year, 3)).toEqual(["2026-03-22", "2026-03-29", "2026-04-05"]);
  });
});

describe("listing ahead matches completing", () => {
  const rules: [string, RepeatRule, string][] = [
    ["daily", { every: "day", interval: 1 }, "2026-01-31"],
    ["every 3 days, 7 times", { every: "day", interval: 3, count: 7 }, "2026-01-31"],
    ["Mon and Thu every 2 weeks", { every: "week", interval: 2, weekdays: [1, 4] }, "2026-10-19"],
    ["plain monthly from the 31st", monthly(), "2026-01-31"],
    ["last day", monthly({ monthDay: -1 }), "2026-01-31"],
    ["2nd Tuesday until mid 2027", monthly({ weekdayOfMonth: { nth: 2, weekday: 2 }, until: "2027-06-30" }), "2026-10-13"],
    ["yearly from 29 Feb", { every: "year", interval: 1 }, "2028-02-29"],
  ];
  test.each(rules)("%s", (_name, rule, start) => {
    const listed = occurrences(rule, start, { from: "2026-01-01", to: "2099-12-31" }, 30);
    expect(completeOnTime(rule, start, 30)).toEqual(listed);
  });
});

// Expected dates from python-dateutil 2.9's rrule (an independent RFC 5545
// implementation), computed once when these tests were written.
describe("same dates as an RFC 5545 implementation", () => {
  const cases: [string, string, string[]][] = [
    ["FREQ=MONTHLY;BYDAY=2TU", "2026-10-13", ["2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12", "2027-02-09", "2027-03-09", "2027-04-13", "2027-05-11"]],
    ["FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30", ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30", "2027-05-28"]],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-31", ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"]],
    ["FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1", "2026-01-31", ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"]],
    ["FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1", "2027-12-29", ["2027-12-29", "2028-01-29", "2028-02-29", "2028-03-29", "2028-04-29", "2028-05-29", "2028-06-29", "2028-07-29"]],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-10-19", ["2026-10-19", "2026-10-22", "2026-11-02", "2026-11-05", "2026-11-16", "2026-11-19", "2026-11-30", "2026-12-03"]],
    ["FREQ=DAILY;INTERVAL=3;COUNT=5", "2026-10-22", ["2026-10-22", "2026-10-25", "2026-10-28", "2026-10-31", "2026-11-03"]],
    ["FREQ=WEEKLY;BYDAY=FR;UNTIL=20261204", "2026-10-23", ["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04"]],
    ["FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR", "2026-10-30", ["2026-10-30", "2026-12-25", "2027-02-26", "2027-04-30", "2027-06-25", "2027-08-27", "2027-10-29", "2027-12-31"]],
  ];
  test.each(cases)("%s from %s", (rrule, start, expected) => {
    expect(occurrences(parseRRule(rrule), start, { from: start, to: "2030-12-31" }, expected.length)).toEqual(expected);
  });
});

describe("validation", () => {
  const bad: [string, RepeatRule, RegExp][] = [
    ["monthDay on a weekly rule", { every: "week", interval: 1, monthDay: 3 }, /monthDay is allowed only/],
    ["monthDay 0", monthly({ monthDay: 0 }), /monthDay must be/],
    ["monthDay -2", monthly({ monthDay: -2 }), /monthDay must be/],
    ["monthDay 32", monthly({ monthDay: 32 }), /monthDay must be/],
    ["both month patterns", monthly({ monthDay: 1, weekdayOfMonth: { nth: 1, weekday: 1 } }), /cannot be combined/],
    ["nth 0", monthly({ weekdayOfMonth: { nth: 0, weekday: 1 } }), /nth must be/],
    ["nth 6", monthly({ weekdayOfMonth: { nth: 6, weekday: 1 } }), /nth must be/],
    ["weekday 8", monthly({ weekdayOfMonth: { nth: 1, weekday: 8 } }), /weekday must be/],
    ["until and count", { every: "day", interval: 1, until: "2026-12-31", count: 3 }, /cannot be combined/],
    ["bad until", { every: "day", interval: 1, until: "2026-02-30" }, /until must be/],
    ["count 0", { every: "day", interval: 1, count: 0 }, /count must be/],
    ["fractional count", { every: "day", interval: 1, count: 1.5 }, /count must be/],
  ];
  test.each(bad)("%s", (_name, rule, message) => expect(validateRepeat(rule)).toMatch(message));
  test("valid rules", () => {
    expect(validateRepeat(monthly({ monthDay: -1, from: "completion", until: "2027-01-01" }))).toBeNull();
    expect(validateRepeat(monthly({ weekdayOfMonth: { nth: -1, weekday: 5 }, count: 12 }))).toBeNull();
  });
});

describe("the next occurrence and projects (0.13.0)", () => {
  test("the next occurrence of a repeating task keeps its project, also once the project is archived", async () => {
    // Due dates in the future: completed today, the series steps from its due date, whatever day the test runs.
    const user = asUser(newUserId());
    const { project }: any = await user.mutation(internal.ops.addProject, { name: "Health" });
    const task: any = await user.mutation(internal.ops.add, { title: "Gym", dueDate: "2036-10-20", repeat: { every: "week", interval: 1 }, projectId: "health" });
    const first: any = await user.mutation(internal.ops.complete, { taskId: task.id });
    expect(first.next).toMatchObject({ title: "Gym", dueDate: "2036-10-27", projectId: project.id });
    await user.mutation(internal.ops.updateProject, { projectId: project.id, archived: true });
    const second: any = await user.mutation(internal.ops.complete, { taskId: first.next.id });
    expect(second.next).toMatchObject({ dueDate: "2036-11-03", projectId: project.id });
    const loose: any = await user.mutation(internal.ops.add, { title: "Water plants", dueDate: "2026-10-20", repeat: { every: "day", interval: 1 } });
    expect(((await user.mutation(internal.ops.complete, { taskId: loose.id })) as any).next).not.toHaveProperty("projectId");
  });
});
