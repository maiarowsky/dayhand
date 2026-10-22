// The date grammar: fixed reference moments in Europe/London, including both
// weeks the clocks change (last Sunday of March and of October).
import { describe, expect, test } from "vitest";
import { addMonths, instantOf, localAt } from "../src/when/calendar.js";
import { parseWhen, relativeDay, WhenError } from "../src/when/parse.js";

const LONDON = "Europe/London";
const at = (iso: string, timezone = LONDON) => ({ now: Date.parse(iso), timezone });
const when = (text: string, ref: { now: number; timezone: string }) => {
  const found = parseWhen(text, ref);
  return [found.date, found.time, found.shiftedFrom].filter(Boolean).join(" ");
};

// Thursday 22 October 2026, 10:00 BST.
const THU = at("2026-10-22T09:00:00Z");

const PHRASES: [string, string][] = [
  ["today", "2026-10-22"],
  ["tod", "2026-10-22"],
  ["Today", "2026-10-22"],
  ["tomorrow", "2026-10-23"],
  ["tmr", "2026-10-23"],
  ["tmrw", "2026-10-23"],
  ["yesterday", "2026-10-21"],
  ["day after tomorrow", "2026-10-24"],
  ["the day after tomorrow", "2026-10-24"],
  ["fri", "2026-10-23"],
  ["Friday", "2026-10-23"],
  ["thu", "2026-10-29"],
  ["on monday", "2026-10-26"],
  ["this thu", "2026-10-22"],
  ["this sun", "2026-10-25"],
  ["next mon", "2026-10-26"],
  ["next thu", "2026-10-29"],
  ["next fri", "2026-10-30"],
  ["next sun", "2026-11-01"],
  ["next week", "2026-10-26"],
  ["next month", "2026-11-01"],
  ["next year", "2027-01-01"],
  ["weekend", "2026-10-24"],
  ["this weekend", "2026-10-24"],
  ["next weekend", "2026-10-31"],
  ["eow", "2026-10-25"],
  ["end of week", "2026-10-25"],
  ["end of the week", "2026-10-25"],
  ["eoww", "2026-10-23"],
  ["end of work week", "2026-10-23"],
  ["eom", "2026-10-31"],
  ["end of month", "2026-10-31"],
  ["eoy", "2026-12-31"],
  ["end of year", "2026-12-31"],
  ["in 3 days", "2026-10-25"],
  ["in a week", "2026-10-29"],
  ["in 2 weeks", "2026-11-05"],
  ["in one month", "2026-11-22"],
  ["in 1 year", "2027-10-22"],
  ["+3d", "2026-10-25"],
  ["+2w", "2026-11-05"],
  ["+1mo", "2026-11-22"],
  ["+1y", "2027-10-22"],
  ["23 oct", "2026-10-23"],
  ["22 oct", "2026-10-22"],
  ["21 oct", "2027-10-21"],
  ["23rd october", "2026-10-23"],
  ["the 23rd of october", "2026-10-23"],
  ["oct 23", "2026-10-23"],
  ["october 23rd 2027", "2027-10-23"],
  ["Oct 23, 2027", "2027-10-23"],
  ["1 jan", "2027-01-01"],
  ["29 feb", "2028-02-29"],
  ["the 15th", "2026-11-15"],
  ["22nd", "2026-10-22"],
  ["2026-10-23", "2026-10-23"],
  ["14:00", "2026-10-22 14:00"],
  ["9:30", "2026-10-23 09:30"],
  ["2pm", "2026-10-22 14:00"],
  ["2 pm", "2026-10-22 14:00"],
  ["9am", "2026-10-23 09:00"],
  ["at 9", "2026-10-23 09:00"],
  ["at 10", "2026-10-23 10:00"],
  ["noon", "2026-10-22 12:00"],
  ["midnight", "2026-10-23 00:00"],
  ["12am", "2026-10-23 00:00"],
  ["12pm", "2026-10-22 12:00"],
  ["tomorrow at 9am", "2026-10-23 09:00"],
  ["fri 14:30", "2026-10-23 14:30"],
  ["at 3pm on friday", "2026-10-23 15:00"],
  ["9am tomorrow", "2026-10-23 09:00"],
  ["next mon at noon", "2026-10-26 12:00"],
  ["in 3 days at 8:15", "2026-10-25 08:15"],
  ["23 oct 9:30pm", "2026-10-23 21:30"],
  ["in 2 hours", "2026-10-22 12:00"],
  ["in 30 min", "2026-10-22 10:30"],
  ["+3h", "2026-10-22 13:00"],
  ["in 15 hours", "2026-10-23 01:00"],
];

describe("phrases on Thursday 22 October 2026, 10:00 in London", () => {
  test.each(PHRASES)("%s → %s", (text, expected) => {
    expect(when(text, THU)).toBe(expected);
  });

  test.each(["", "someday", "9", "25:00", "13pm", "14:75", "constructor", "next", "in 3 parsecs", "31 feb 2026", "fri fri", "tomorrow 9", "2026-02-29", "+1m"])(
    "%j is rejected with a usage hint, not guessed",
    (text) => {
      expect(() => parseWhen(text, THU)).toThrow(WhenError);
    },
  );

  test("the error does not repeat the phrase", () => {
    expect(() => parseWhen("secret-ish words", THU)).toThrow(/^Not a date hlm understands; try e\.g\. tomorrow/);
    expect(() => parseWhen("secret-ish words", THU)).not.toThrow(/secret/);
  });
});

describe("the week the clocks go back (Sunday 25 October 2026, 02:00 BST → 01:00 GMT)", () => {
  const SAT_LATE = at("2026-10-24T22:30:00Z"); // Saturday 23:30 BST
  const SUN_EARLY = at("2026-10-24T23:30:00Z"); // Sunday 00:30 BST

  test.each<[string, string]>([
    ["today", "2026-10-24"],
    ["tomorrow", "2026-10-25"],
    ["sun", "2026-10-25"],
    ["eow", "2026-10-25"],
    ["in 1 hour", "2026-10-25 00:30"],
    ["in 2 hours", "2026-10-25 01:30"],
    ["in 3 hours", "2026-10-25 01:30"],
    ["in 4 hours", "2026-10-25 02:30"],
    ["1:30am", "2026-10-25 01:30"],
    ["tomorrow 1:30am", "2026-10-25 01:30"],
    ["in 1 day", "2026-10-25"],
  ])("Saturday 23:30: %s → %s", (text, expected) => {
    expect(when(text, SAT_LATE)).toBe(expected);
  });

  test.each<[string, string]>([
    ["today", "2026-10-25"],
    ["in 1 hour", "2026-10-25 01:30"],
    ["in 2 hours", "2026-10-25 01:30"],
    ["2am", "2026-10-25 02:00"],
    ["tomorrow", "2026-10-26"],
  ])("Sunday 00:30 BST: %s → %s", (text, expected) => {
    expect(when(text, SUN_EARLY)).toBe(expected);
  });

  test("01:30 happens twice; the earlier one (BST) is meant", () => {
    expect(instantOf({ date: "2026-10-25", time: "01:30" }, LONDON)).toBe(Date.parse("2026-10-25T00:30:00Z"));
  });
});

describe("the week the clocks go forward (Sunday 29 March 2026, 01:00 GMT → 02:00 BST)", () => {
  const SAT_LATE = at("2026-03-28T23:30:00Z"); // Saturday 23:30 GMT
  const SUN_EARLY = at("2026-03-29T00:30:00Z"); // Sunday 00:30 GMT

  test.each<[string, string]>([
    ["tomorrow", "2026-03-29"],
    ["eow", "2026-03-29"],
    ["in 1 hour", "2026-03-29 00:30"],
    ["in 90 min", "2026-03-29 02:00"],
    ["in 2 hours", "2026-03-29 02:30"],
    ["tomorrow 2:30am", "2026-03-29 02:30"],
    ["tomorrow 1:30am", "2026-03-29 02:30 01:30"],
    ["1:30am", "2026-03-29 02:30 01:30"],
    ["next mon", "2026-03-30"],
  ])("Saturday 23:30: %s → %s", (text, expected) => {
    expect(when(text, SAT_LATE)).toBe(expected);
  });

  test.each<[string, string]>([
    ["today", "2026-03-29"],
    ["today 01:15", "2026-03-29 02:15 01:15"],
    ["in 1 hour", "2026-03-29 02:30"],
    ["3am", "2026-03-29 03:00"],
  ])("Sunday 00:30 GMT: %s → %s", (text, expected) => {
    expect(when(text, SUN_EARLY)).toBe(expected);
  });
});

describe("the user's zone decides, not the computer's or UTC", () => {
  test("00:30 BST is already tomorrow in London while UTC is still on the 22nd", () => {
    const ref = at("2026-10-22T23:30:00Z");
    expect(when("today", ref)).toBe("2026-10-23");
    expect(when("fri", ref)).toBe("2026-10-30");
  });

  test("other zones", () => {
    expect(when("today", at("2026-10-22T09:00:00Z", "America/New_York"))).toBe("2026-10-22");
    expect(when("in 2 hours", at("2026-10-22T09:00:00Z", "America/New_York"))).toBe("2026-10-22 07:00");
    expect(when("tomorrow", at("2026-10-22T11:30:00Z", "Pacific/Auckland"))).toBe("2026-10-24");
    expect(when("in 3 hours", at("2026-10-22T09:00:00Z", "Pacific/Auckland"))).toBe("2026-10-23 01:00");
  });
});

describe("calendar helpers", () => {
  test("months clamp to the last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  test("local wall clock and relative day words", () => {
    expect(localAt(Date.parse("2026-07-01T12:00:00Z"), LONDON)).toEqual({ date: "2026-07-01", time: "13:00" });
    expect(relativeDay("2026-10-22", "2026-10-22")).toBe("today");
    expect(relativeDay("2026-10-23", "2026-10-22")).toBe("tomorrow");
    expect(relativeDay("2026-10-21", "2026-10-22")).toBe("yesterday");
    expect(relativeDay("2026-10-27", "2026-10-22")).toBe("in 5 days");
    expect(relativeDay("2026-10-19", "2026-10-22")).toBe("3 days ago");
    expect(relativeDay("2026-03-30", "2026-03-28")).toBe("in 2 days");
  });
});
