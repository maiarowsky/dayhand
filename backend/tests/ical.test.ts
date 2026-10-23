// The plan as iCalendar (no backend): the text format, VTIMEZONE, alarms, and
// every repeat rule expanded by an independent parser (ical.js) to exactly
// the dates Helm's own lib/repeat.ts gives.
import ICAL from "ical.js";
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { addDays } from "../convex/lib/dates";
import { alarmOffset, duration, escapeText, foldLine, LISTED_DAYS, listsDates, renderCalendar, startsSeries } from "../convex/lib/ical";
import { occurrences } from "../convex/lib/repeat";
import type { RepeatRule } from "../convex/lib/validators";
import { vtimezoneLines, zonedInstant } from "../convex/lib/vtimezone";

const AT = Date.UTC(2026, 9, 23, 12, 0);
const LONDON = { timezone: "Europe/London", defaultReminderMinutes: [0], at: AT };

let counter = 0;
function task(fields: Partial<Doc<"tasks">> = {}): Doc<"tasks"> {
  counter += 1;
  return {
    _id: `task${counter}` as Id<"tasks">,
    _creationTime: 0,
    userId: "user",
    ref: counter,
    title: `Task ${counter}`,
    status: "todo",
    isNow: false,
    labels: [],
    links: [],
    createdAt: Date.UTC(2026, 9, 1, 8, 0),
    updatedAt: Date.UTC(2026, 9, 2, 9, 30),
    ...fields,
  } as Doc<"tasks">;
}

/** Parses with ical.js (which throws on malformed text) and registers the time zones. */
function parse(text: string): ICAL.Component {
  const calendar = new ICAL.Component(ICAL.parse(text));
  for (const zone of calendar.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(zone);
  return calendar;
}

const events = (calendar: ICAL.Component) => calendar.getAllSubcomponents("vevent");

/** Dates (YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS) of every event whose UID starts with the task id, up to `to`. */
function expand(calendar: ICAL.Component, id: string, to: string): string[] {
  const dates: string[] = [];
  for (const vevent of events(calendar).filter((e) => String(e.getFirstPropertyValue("uid")).startsWith(`${id}`))) {
    const iterator = new ICAL.Event(vevent).iterator();
    for (let time = iterator.next(); time && time.toString().slice(0, 10) <= to; time = iterator.next()) {
      dates.push(time.toString());
      if (dates.length > 500) break;
    }
  }
  return dates.sort();
}

/** RFC 5545 shape every line and event must have. */
function expectWellFormed(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  const calendar = parse(text);
  expect(calendar.getFirstPropertyValue("version")).toBe("2.0");
  expect(calendar.getFirstPropertyValue("prodid")).toBeTruthy();
  for (const vevent of events(calendar)) {
    for (const name of ["uid", "dtstamp", "dtstart", "summary"]) expect(vevent.getFirstPropertyValue(name), name).toBeTruthy();
    for (const alarm of vevent.getAllSubcomponents("valarm")) {
      for (const name of ["action", "trigger", "description"]) expect(alarm.getFirstPropertyValue(name), name).toBeTruthy();
    }
  }
  const uids = events(calendar).map((e) => e.getFirstPropertyValue("uid"));
  expect(new Set(uids).size).toBe(uids.length);
}

describe("text format", () => {
  test("TEXT values escape backslash, semicolon, comma and line breaks", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
  test("long lines fold at 75 octets without splitting a UTF-8 character", () => {
    const line = `SUMMARY:${"zażółć gęślą jaźń ".repeat(8)}`;
    const folded = foldLine(line);
    const pieces = folded.split("\r\n");
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    expect(pieces.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(pieces.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });
  test("durations", () => {
    expect([0, -15, -60, -90, -1440, -1800, 540].map(duration)).toEqual(["PT0M", "-PT15M", "-PT1H", "-PT1H30M", "-P1D", "-P1DT6H", "PT9H"]);
  });
});

describe("VTIMEZONE", () => {
  test("Europe/London: the last Sundays of March and October as yearly rules", () => {
    const lines = vtimezoneLines("Europe/London", 2026, 2027);
    expect(lines).toContain("TZID:Europe/London");
    const text = lines.join("\n");
    expect(text).toMatch(/BEGIN:DAYLIGHT\nDTSTART:\d{8}T010000\nTZOFFSETFROM:\+0000\nTZOFFSETTO:\+0100\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\nTZNAME:BST/);
    expect(text).toMatch(/BEGIN:STANDARD\nDTSTART:\d{8}T020000\nTZOFFSETFROM:\+0100\nTZOFFSETTO:\+0000\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\nTZNAME:GMT/);
  });
  test("a zone without clock changes has one observance", () => {
    expect(vtimezoneLines("Asia/Tokyo", 2026, 2027).join("\n")).toMatch(
      /BEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:\+0900\nTZOFFSETTO:\+0900/,
    );
  });
  test("the southern hemisphere: Australia/Sydney on first Sundays", () => {
    const text = vtimezoneLines("Australia/Sydney", 2026, 2027).join("\n");
    expect(text).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU");
    expect(text).toContain("RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU");
  });
  test("local times map to the right instants on both sides of a change", () => {
    expect(zonedInstant("2026-07-01", "09:00:00", "Europe/London")).toBe(Date.UTC(2026, 6, 1, 8, 0));
    expect(zonedInstant("2026-12-01", "09:00:00", "Europe/London")).toBe(Date.UTC(2026, 11, 1, 9, 0));
    // 01:30 does not exist on 29 March 2026 in London; it moves past the gap.
    expect(zonedInstant("2026-03-29", "01:30:00", "Europe/London")).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });
});

describe("events", () => {
  test("a timed task is a 30-minute event in the user's zone that keeps its wall time across DST", () => {
    const meeting = task({ title: "Weekly call", dueDate: "2026-10-19", dueTime: "09:00", repeat: { every: "week", interval: 1 } });
    const text = renderCalendar([meeting], LONDON);
    expectWellFormed(text);
    expect(text).toContain("DTSTART;TZID=Europe/London:20261019T090000\r\n");
    expect(text).toContain("DURATION:PT30M\r\n");
    expect(text).toContain("RRULE:FREQ=WEEKLY\r\n");
    const vevent = events(parse(text))[0];
    const iterator = new ICAL.Event(vevent).iterator();
    const first = iterator.next();
    const second = iterator.next();
    // 19 Oct is BST (08:00 UTC); 26 Oct is GMT (09:00 UTC).
    expect(first.toUnixTime()).toBe(Date.UTC(2026, 9, 19, 8, 0) / 1000);
    expect(second.toUnixTime()).toBe(Date.UTC(2026, 9, 26, 9, 0) / 1000);
  });

  test("a task with only a day is an all-day event; undated, archived and trashed tasks are left out", () => {
    const allDay = task({ title: "Pay rent", dueDate: "2026-10-30" });
    const text = renderCalendar(
      [allDay, task({ title: "Someday" }), task({ dueDate: "2026-10-30", archivedAt: AT }), task({ dueDate: "2026-10-30", deletedAt: AT })],
      LONDON,
    );
    expectWellFormed(text);
    expect(events(parse(text))).toHaveLength(1);
    expect(text).toContain("DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031\r\n");
    // No timed event, so no VTIMEZONE is needed.
    expect(text).not.toContain("BEGIN:VTIMEZONE");
  });

  test("UID is stable and DTSTAMP is the last change, so the same plan gives the same text", () => {
    const t = task({ dueDate: "2026-10-30" });
    expect(renderCalendar([t], LONDON)).toBe(renderCalendar([t], { ...LONDON, at: AT + 3_600_000 }));
    expect(renderCalendar([t], LONDON)).toContain(`UID:${t._id}@helm\r\nDTSTAMP:20261002T093000Z\r\n`);
  });

  test("title, note, number and labels", () => {
    const t = task({ title: "Call Ann, re: plan; 2\\3", note: "line one\nline two", labels: ["phone", "a,b"], dueDate: "2026-10-30" });
    const text = renderCalendar([t], LONDON);
    const vevent = events(parse(text))[0];
    expect(vevent.getFirstPropertyValue("summary")).toBe("Call Ann, re: plan; 2\\3");
    expect(vevent.getFirstPropertyValue("description")).toBe(`Helm #${t.ref}\n\nline one\nline two`);
    expect(text).toContain("CATEGORIES:phone,a\\,b\r\n");
    expect(text).toContain("TRANSP:TRANSPARENT\r\n");
  });

  test("done tasks stay 90 days as single ✓ events without alarms or repeat", () => {
    const recent = task({ title: "Filed", dueDate: "2026-10-01", dueTime: "10:00", status: "done", repeat: { every: "day", interval: 1 } });
    const old = task({ title: "Long ago", dueDate: "2026-06-01", status: "done" });
    const text = renderCalendar([recent, old], LONDON);
    expectWellFormed(text);
    expect(text).toContain("SUMMARY:✓ Filed\r\n");
    expect(text).not.toContain("Long ago");
    expect(text).not.toContain("RRULE:FREQ=DAILY");
    expect(text).not.toContain("BEGIN:VALARM");
  });
});

describe("alarms", () => {
  test("offsets from the start", () => {
    expect(alarmOffset({ minutesBefore: 15 }, "09:00")).toBe(-15);
    expect(alarmOffset({ minutesBefore: 15 }, undefined)).toBeNull();
    expect(alarmOffset({ time: "18:00", daysBefore: 1 }, "09:00")).toBe(-15 * 60);
    expect(alarmOffset({ time: "18:00", daysBefore: 1 }, undefined)).toBe(-6 * 60);
    expect(alarmOffset({ time: "08:00" }, undefined)).toBe(8 * 60);
  });

  test("defaults from the settings for a timed task, its own reminders otherwise, none for a day-only task by default", () => {
    const options = { ...LONDON, defaultReminderMinutes: [0, 15] };
    const timed = task({ title: "Timed", dueDate: "2026-10-30", dueTime: "09:00" });
    const own = task({ title: "Own", dueDate: "2026-10-30", reminders: [{ time: "18:00", daysBefore: 1 }] });
    const none = task({ title: "None", dueDate: "2026-10-30", dueTime: "09:00", reminders: [] });
    const dayOnly = task({ title: "Day only", dueDate: "2026-10-30" });
    const calendar = parse(renderCalendar([timed, own, none, dayOnly], options));
    const triggers = (id: string) =>
      events(calendar)
        .find((e) => e.getFirstPropertyValue("uid") === `${id}@helm`)!
        .getAllSubcomponents("valarm")
        .map((a) => a.getFirstPropertyValue("trigger")!.toString());
    expect(triggers(timed._id)).toEqual(["PT0S", "-PT15M"]);
    expect(triggers(own._id)).toEqual(["-PT6H"]);
    expect(triggers(none._id)).toEqual([]);
    expect(triggers(dayOnly._id)).toEqual([]);
  });
});

describe("repeating tasks expand to Helm's own dates", () => {
  const HORIZON = "2029-12-31";
  /** Helm's dates up to the horizon; a series written as its dates goes LISTED_DAYS ahead. */
  const helmDates = (rule: RepeatRule, dueDate: string) => {
    const listed = addDays(dueDate, LISTED_DAYS);
    const to = listsDates(rule, dueDate) && listed < HORIZON ? listed : HORIZON;
    return occurrences(rule, dueDate, { from: dueDate, to });
  };
  const cases: [string, RepeatRule, string][] = [
    ["every 3 days, 5 times", { every: "day", interval: 3, count: 5 }, "2026-10-23"],
    ["every week", { every: "week", interval: 1 }, "2026-10-21"],
    ["Mon and Thu, from a Monday", { every: "week", interval: 1, weekdays: [1, 4] }, "2026-10-19"],
    ["Mon and Thu, due on a Wednesday", { every: "week", interval: 1, weekdays: [1, 4] }, "2026-10-21"],
    ["every 2 weeks on Mon and Fri, due on a Saturday", { every: "week", interval: 2, weekdays: [1, 5], count: 9 }, "2026-10-24"],
    ["monthly from the 31st", { every: "month", interval: 1 }, "2026-01-31"],
    ["monthly from the 30th, until a day", { every: "month", interval: 1, until: "2027-06-15" }, "2026-01-30"],
    ["last day of the month", { every: "month", interval: 1, monthDay: -1 }, "2026-01-31"],
    ["the 30th, due on the 10th", { every: "month", interval: 1, monthDay: 30, count: 6 }, "2026-02-10"],
    ["the 2nd Tuesday, due on the 1st", { every: "month", interval: 1, weekdayOfMonth: { nth: 2, weekday: 2 } }, "2026-02-01"],
    ["the last Friday every 2 months", { every: "month", interval: 2, weekdayOfMonth: { nth: -1, weekday: 5 } }, "2026-10-30"],
    ["yearly", { every: "year", interval: 1 }, "2026-10-23"],
    ["yearly from 29 February", { every: "year", interval: 1, count: 4 }, "2028-02-29"],
    ["counted from completion", { every: "day", interval: 2, from: "completion", until: "2026-11-30" }, "2026-10-23"],
  ];

  test.each(cases)("%s (day only)", (_name, rule, dueDate) => {
    const t = task({ dueDate, repeat: rule });
    const calendar = parse(renderCalendar([t], { ...LONDON, at: Date.parse(`${dueDate}T12:00:00Z`) }));
    expect(expand(calendar, t._id, HORIZON)).toEqual(helmDates(rule, dueDate));
  });

  test.each(cases)("%s (at 09:30)", (_name, rule, dueDate) => {
    const t = task({ dueDate, dueTime: "09:30", repeat: rule });
    const text = renderCalendar([t], { ...LONDON, at: Date.parse(`${dueDate}T12:00:00Z`) });
    expectWellFormed(text);
    const expected = helmDates(rule, dueDate).map((d) => `${d}T09:30:00`);
    expect(expand(parse(text), t._id, HORIZON)).toEqual(expected);
  });

  test("UNTIL of a timed series is the end of that day in UTC, as RFC 5545 requires", () => {
    const t = task({ dueDate: "2026-10-23", dueTime: "09:00", repeat: { every: "day", interval: 1, until: "2026-10-30" } });
    expect(renderCalendar([t], LONDON)).toContain("RRULE:FREQ=DAILY;UNTIL=20261030T235959Z\r\n");
    const july = task({ dueDate: "2026-07-01", dueTime: "09:00", repeat: { every: "day", interval: 1, until: "2026-07-03" } });
    expect(renderCalendar([july], LONDON)).toContain("RRULE:FREQ=DAILY;UNTIL=20260703T225959Z\r\n");
    const allDay = task({ dueDate: "2026-10-23", repeat: { every: "day", interval: 1, until: "2026-10-30" } });
    expect(renderCalendar([allDay], LONDON)).toContain("RRULE:FREQ=DAILY;UNTIL=20261030\r\n");
  });

  test("a due date off the rule is its own event; the series after it has its own UID and one fewer", () => {
    const t = task({ dueDate: "2026-10-21", repeat: { every: "week", interval: 1, weekdays: [1, 4], count: 3 } });
    const text = renderCalendar([t], LONDON);
    expect(text).toContain(`UID:${t._id}@helm\r\n`);
    expect(text).toContain(`UID:${t._id}-next@helm\r\n`);
    expect(text).toContain("DTSTART;VALUE=DATE:20261022\r\n");
    expect(text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=2\r\n");
  });

  test("a monthly rule on the 31st is written as its dates, two years ahead, because BYSETPOS is not expanded everywhere", () => {
    const t = task({ dueDate: "2026-10-31", repeat: { every: "month", interval: 1 } });
    const text = renderCalendar([t], LONDON);
    expect(text).not.toContain("BYSETPOS");
    expect(text).toContain(`UID:${t._id}@helm\r\n`);
    expect(text).toContain(`UID:${t._id}-20261130@helm\r\nDTSTAMP`);
    expect(text).toContain("DTSTART;VALUE=DATE:20270228\r\n");
    expect(events(parse(text))).toHaveLength(25);
  });

  test("a rule whose last date is the due date is a single event", () => {
    const t = task({ dueDate: "2026-10-21", repeat: { every: "week", interval: 1, weekdays: [1, 4], count: 1 } });
    expect(events(parse(renderCalendar([t], LONDON)))).toHaveLength(1);
    expect(startsSeries({ every: "week", interval: 1, weekdays: [1, 4] }, "2026-10-21")).toBe(false);
    expect(startsSeries({ every: "week", interval: 1, weekdays: [1, 4] }, addDays("2026-10-21", 1))).toBe(true);
  });
});

test("another time zone from the settings", () => {
  const t = task({ dueDate: "2026-01-15", dueTime: "09:00" });
  const text = renderCalendar([t], { ...LONDON, timezone: "Australia/Sydney" });
  expectWellFormed(text);
  expect(text).toContain("X-WR-TIMEZONE:Australia/Sydney\r\n");
  const start = new ICAL.Event(events(parse(text))[0]).startDate;
  // 09:00 AEDT (UTC+11) is 22:00 UTC the day before.
  expect(start.toUnixTime()).toBe(Date.UTC(2026, 0, 14, 22, 0) / 1000);
});
