// Pure date and repeat logic (no backend).
import { describe, expect, test } from "vitest";
import { addMonths, isOverdue, isValidDate, localDate, resolveDate } from "../convex/lib/dates";
import { nextOccurrence, validateRepeat } from "../convex/lib/repeat";
import { utc } from "./helpers";

describe("localDate", () => {
  test("London midnight in summer time (BST, UTC+1)", () => {
    expect(localDate(utc("2026-10-22T22:59"), "Europe/London")).toBe("2026-10-22");
    expect(localDate(utc("2026-10-22T23:00"), "Europe/London")).toBe("2026-10-23");
  });
  test("London midnight in winter time (GMT, UTC+0)", () => {
    expect(localDate(utc("2026-12-01T23:59"), "Europe/London")).toBe("2026-12-01");
    expect(localDate(utc("2026-12-02T00:00"), "Europe/London")).toBe("2026-12-02");
  });
  test("other zones", () => {
    expect(localDate(utc("2026-10-22T21:59"), "Europe/Warsaw")).toBe("2026-10-22");
    expect(localDate(utc("2026-10-22T22:00"), "Europe/Warsaw")).toBe("2026-10-23");
    expect(localDate(utc("2026-10-23T03:00"), "America/New_York")).toBe("2026-10-22");
  });
});

describe("isOverdue", () => {
  const base = { status: "todo", dueDate: "2026-10-21" };
  test("open task due before today", () => expect(isOverdue(base, "2026-10-22")).toBe(true));
  test("due today is not overdue", () => expect(isOverdue(base, "2026-10-21")).toBe(false));
  test("done, archived, deleted or undated are not overdue", () => {
    expect(isOverdue({ ...base, status: "done" }, "2026-10-22")).toBe(false);
    expect(isOverdue({ ...base, archivedAt: 1 }, "2026-10-22")).toBe(false);
    expect(isOverdue({ ...base, deletedAt: 1 }, "2026-10-22")).toBe(false);
    expect(isOverdue({ status: "todo" }, "2026-10-22")).toBe(false);
  });
  test("in progress counts", () => expect(isOverdue({ ...base, status: "doing" }, "2026-10-22")).toBe(true));
});

describe("dates", () => {
  test("validation", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-2-1")).toBe(false);
  });
  test("today / tomorrow keywords", () => {
    expect(resolveDate("today", "2026-12-31")).toBe("2026-12-31");
    expect(resolveDate("Tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(resolveDate("31-12-2026", "2026-12-31")).toBeNull();
  });
  test("months keep the anchor day", () => {
    expect(addMonths("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
  });
});

describe("nextOccurrence", () => {
  test("daily, completed on time", () => {
    expect(nextOccurrence({ every: "day", interval: 1 }, "2026-10-22", "2026-10-22")).toBe("2026-10-23");
  });
  test("daily, completed three days late skips past days", () => {
    expect(nextOccurrence({ every: "day", interval: 1 }, "2026-10-19", "2026-10-22")).toBe("2026-10-23");
  });
  test("completed early keeps the cadence", () => {
    expect(nextOccurrence({ every: "week", interval: 1 }, "2026-10-29", "2026-10-22")).toBe("2026-11-05");
  });
  test("weekly on Mon and Thu", () => {
    const rule = { every: "week" as const, interval: 1, weekdays: [1, 4] };
    expect(nextOccurrence(rule, "2026-10-19", "2026-10-19")).toBe("2026-10-22"); // Mon -> Thu
    expect(nextOccurrence(rule, "2026-10-22", "2026-10-22")).toBe("2026-10-26"); // Thu -> Mon
  });
  test("every two weeks on Friday", () => {
    const rule = { every: "week" as const, interval: 2, weekdays: [5] };
    expect(nextOccurrence(rule, "2026-10-23", "2026-10-23")).toBe("2026-11-06");
  });
  test("monthly on the 31st", () => {
    expect(nextOccurrence({ every: "month", interval: 1 }, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
  });
  test("yearly on 29 February", () => {
    expect(nextOccurrence({ every: "year", interval: 1 }, "2028-02-29", "2028-02-29")).toBe("2029-02-28");
  });
  test("undated repeating task starts from today", () => {
    expect(nextOccurrence({ every: "day", interval: 2 }, undefined, "2026-10-22")).toBe("2026-10-24");
  });
  test("rule validation", () => {
    expect(validateRepeat({ every: "day", interval: 0 })).toMatch(/interval/);
    expect(validateRepeat({ every: "day", interval: 1, weekdays: [1] })).toMatch(/weekdays/);
    expect(validateRepeat({ every: "week", interval: 1, weekdays: [1, 1] })).toMatch(/distinct/);
    expect(validateRepeat({ every: "week", interval: 1, weekdays: [1, 7] })).toBeNull();
  });
});
