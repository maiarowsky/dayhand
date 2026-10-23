// Repeat rules as RFC 5545 RRULE values, for export (calendars, iCal) and for
// rules given as text. Helm reads and writes this subset: FREQ (DAILY,
// WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY, BYMONTHDAY, BYSETPOS, UNTIL,
// COUNT and WKST. Anything else is refused with a message naming the part.
//
// Differences from RFC 5545, all documented in docs/mcp.md:
// - `from: "completion"` has no RRULE form; the RRULE describes the dates only.
// - A month without the day (31 in April) falls on its last day in Helm; RFC
//   5545 skips that month. toRRule writes such days as
//   BYMONTHDAY=28,29,30,31;BYSETPOS=-1, which means the same in both.
// - A yearly rule from 29 February falls on 28 February in other years.
import { localDate } from "./dates";
import { MAX_COUNT, MAX_INTERVAL, validateRepeat } from "./repeat";
import type { RepeatRule } from "./validators";

const FREQ: Record<RepeatRule["every"], string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };
const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** RRULE error: the message says what is wrong in terms of the RRULE text. */
export class RRuleError extends Error {}

const fail = (message: string): never => {
  throw new RRuleError(message);
};

/**
 * The rule as an RRULE value (without the `RRULE:` prefix), e.g.
 * `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH`. With `dueDate`, a plain monthly rule
 * from a 29-31 is written as the clamped day it means in Helm.
 */
export function toRRule(rule: RepeatRule, dueDate?: string): string {
  const parts = [`FREQ=${FREQ[rule.every]}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.weekdays?.length) {
    parts.push(`BYDAY=${[...rule.weekdays].sort((a, b) => a - b).map((d) => DAY_CODES[d - 1]).join(",")}`);
  }
  if (rule.weekdayOfMonth) parts.push(`BYDAY=${rule.weekdayOfMonth.nth}${DAY_CODES[rule.weekdayOfMonth.weekday - 1]}`);
  const plainMonthDay =
    rule.every === "month" && rule.monthDay === undefined && rule.weekdayOfMonth === undefined && dueDate
      ? Number(dueDate.slice(8, 10))
      : undefined;
  const monthDay = rule.monthDay ?? (plainMonthDay !== undefined && plainMonthDay > 28 ? plainMonthDay : undefined);
  if (monthDay !== undefined) {
    if (monthDay > 28) {
      const days = Array.from({ length: monthDay - 27 }, (_, i) => 28 + i);
      parts.push(`BYMONTHDAY=${days.join(",")}`, "BYSETPOS=-1");
    } else {
      parts.push(`BYMONTHDAY=${monthDay}`);
    }
  }
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

const INTEGER = /^[+-]?\d{1,4}$/;

function integer(name: string, text: string, min: number, max: number): number {
  if (!INTEGER.test(text)) fail(`${name} must be a whole number, got "${text}"`);
  const value = Number(text);
  if (value < min || value > max) fail(`${name} must be from ${min} to ${max}, got ${value}`);
  return value;
}

function dayCode(text: string): number {
  const index = DAY_CODES.indexOf(text);
  if (index < 0) fail(`BYDAY has an unknown day "${text}"; use MO, TU, WE, TH, FR, SA or SU`);
  return index + 1;
}

/** UNTIL as a local date: a DATE as it is, a UTC DATE-TIME in `timezone`, a floating DATE-TIME as written. */
function untilDate(text: string, timezone: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(text);
  if (!match) fail(`UNTIL must be a date (20261231) or a date and time (20261231T235959Z), got "${text}"`);
  const [, y, m, d, hh, mm, ss, z] = match!;
  if (z) return localDate(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss), timezone);
  return `${y}-${m}-${d}`;
}

/** Splits `FREQ=WEEKLY;BYDAY=MO` (optionally after `RRULE:`) into upper-case parts, refusing repeats. */
function parts(text: string): Map<string, string> {
  const body = text.trim().replace(/^RRULE:/i, "");
  if (body === "") fail("RRULE is empty");
  const result = new Map<string, string>();
  for (const part of body.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) fail(`RRULE parts are NAME=VALUE, got "${part}"`);
    const name = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim().toUpperCase();
    if (result.has(name)) fail(`${name} is given twice`);
    result.set(name, value);
  }
  return result;
}

const SUPPORTED = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYSETPOS", "UNTIL", "COUNT", "WKST"]);

/**
 * Reads an RRULE value (with or without the `RRULE:` prefix) as a Helm rule.
 * `timezone` turns a UTC UNTIL into the user's local date. Throws RRuleError
 * with a readable message for anything outside the subset.
 */
export function parseRRule(text: string, timezone = "Europe/London"): RepeatRule {
  const p = parts(text);
  for (const name of p.keys()) {
    if (!SUPPORTED.has(name)) fail(`${name} is not supported; Helm reads FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYSETPOS, UNTIL and COUNT`);
  }
  const freq = p.get("FREQ") ?? fail("FREQ is missing");
  const every = (Object.keys(FREQ) as RepeatRule["every"][]).find((unit) => FREQ[unit] === freq);
  if (!every) fail(`FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY, got ${freq}`);
  const rule: RepeatRule = { every: every!, interval: p.has("INTERVAL") ? integer("INTERVAL", p.get("INTERVAL")!, 1, MAX_INTERVAL) : 1 };

  const byDay = p.get("BYDAY")?.split(",").map((d) => d.trim());
  const byMonthDay = p.get("BYMONTHDAY")?.split(",").map((d) => integer("BYMONTHDAY", d.trim(), -31, 31));
  const setPos = p.has("BYSETPOS") ? integer("BYSETPOS", p.get("BYSETPOS")!, -5, 5) : undefined;

  if (byDay && rule.every === "day") {
    // "Every weekday" is sometimes written DAILY;BYDAY=MO,TU,WE,TH,FR.
    if (rule.interval !== 1) fail("FREQ=DAILY with BYDAY is read only without INTERVAL; use FREQ=WEEKLY");
    rule.every = "week";
  }
  if (byDay && rule.every === "week") {
    if (byDay.some((d) => !/^[A-Z]{2}$/.test(d))) fail("BYDAY of a weekly rule lists days without numbers, e.g. MO,TH");
    rule.weekdays = [...new Set(byDay.map(dayCode))].sort((a, b) => a - b);
  } else if (byDay && rule.every === "month") {
    if (byDay.length !== 1) fail("BYDAY of a monthly rule must name one day, e.g. 2TU or -1FR");
    const match = /^([+-]?\d)?([A-Z]{2})$/.exec(byDay[0]) ?? fail(`BYDAY "${byDay[0]}" is not a day such as 2TU or -1FR`);
    const nth = match![1] !== undefined ? Number(match![1]) : setPos;
    if (nth === undefined) fail("BYDAY of a monthly rule needs a position, e.g. 2TU, or BYSETPOS");
    if (match![1] !== undefined && setPos !== undefined) fail("BYSETPOS cannot be combined with a numbered BYDAY");
    rule.weekdayOfMonth = { nth: nth!, weekday: dayCode(match![2]) };
  } else if (byDay) {
    fail("BYDAY is supported only with FREQ=WEEKLY or FREQ=MONTHLY");
  }

  if (byMonthDay) {
    if (rule.every !== "month") fail("BYMONTHDAY is supported only with FREQ=MONTHLY");
    if (byDay) fail("BYMONTHDAY cannot be combined with BYDAY");
    rule.monthDay = monthDayOf(byMonthDay, setPos);
  } else if (setPos !== undefined && !(byDay && rule.every === "month")) {
    fail("BYSETPOS is supported only with a monthly BYDAY or BYMONTHDAY=28,29,30,31");
  }

  if (p.has("UNTIL")) rule.until = untilDate(p.get("UNTIL")!, timezone);
  if (p.has("COUNT")) rule.count = integer("COUNT", p.get("COUNT")!, 1, MAX_COUNT);

  const wkst = p.get("WKST");
  // Helm's weeks start on Monday; another start changes only multi-day rules every 2+ weeks.
  if (wkst !== undefined && wkst !== "MO" && rule.every === "week" && rule.interval > 1 && (rule.weekdays?.length ?? 0) > 1) {
    fail("WKST other than MO is not supported for a rule every 2 or more weeks on several days");
  }
  if (wkst !== undefined) dayCode(wkst);

  const error = validateRepeat(rule);
  if (error) fail(error);
  return rule;
}

/** BYMONTHDAY as Helm's monthDay: one day, or 28..d with BYSETPOS=-1 (day d, or the last day when shorter). */
function monthDayOf(days: number[], setPos: number | undefined): number {
  if (setPos === undefined) {
    if (days.length !== 1) fail("BYMONTHDAY must be one day, or 28,29,30,31 with BYSETPOS=-1");
    const [day] = days;
    if (day === 0 || (day < 0 && day !== -1)) fail("BYMONTHDAY must be 1 to 31 or -1 (the last day)");
    return day;
  }
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const contiguous = sorted[0] === 28 && sorted.every((d, i) => d === 28 + i) && sorted.length <= 4;
  if (setPos !== -1 || !contiguous) fail("BYMONTHDAY with BYSETPOS is read only as 28,29,30(,31) with BYSETPOS=-1");
  return sorted[sorted.length - 1];
}
