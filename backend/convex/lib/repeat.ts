// Repeat rules: validation and the dates a series falls on. Pure functions,
// shared by completing a task (`advance`) and by anything that lists a series
// ahead, such as a calendar (`occurrences`); both walk the same `step`.
import { addDays, addMonths, dayOfMonth, isValidDate, weekday } from "./dates";
import type { RepeatRule } from "./validators";

export const MAX_INTERVAL = 366;
export const MAX_COUNT = 1000;
// Months searched for an nth weekday a month may lack (a 5th Monday).
const MAX_MONTH_SEARCH = 120;
// Safety net for a due date far in the past; one step per occurrence.
const MAX_STEPS = 100_000;

const isWhole = (n: number) => Number.isInteger(n);

/** Returns an error message, or null when the rule is valid. */
export function validateRepeat(rule: RepeatRule): string | null {
  if (!isWhole(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) {
    return `repeat.interval must be an integer from 1 to ${MAX_INTERVAL}`;
  }
  if (rule.weekdays !== undefined) {
    if (rule.every !== "week") return "repeat.weekdays is allowed only with every = week";
    const unique = new Set(rule.weekdays);
    if (
      rule.weekdays.length === 0 ||
      unique.size !== rule.weekdays.length ||
      rule.weekdays.some((d) => !isWhole(d) || d < 1 || d > 7)
    ) {
      return "repeat.weekdays must be distinct integers 1 (Monday) to 7 (Sunday)";
    }
  }
  if (rule.monthDay !== undefined) {
    if (rule.every !== "month") return "repeat.monthDay is allowed only with every = month";
    if (!isWhole(rule.monthDay) || (rule.monthDay !== -1 && (rule.monthDay < 1 || rule.monthDay > 31))) {
      return "repeat.monthDay must be a day 1 to 31, or -1 for the last day of the month";
    }
  }
  if (rule.weekdayOfMonth !== undefined) {
    if (rule.every !== "month") return "repeat.weekdayOfMonth is allowed only with every = month";
    if (rule.monthDay !== undefined) return "repeat.monthDay and repeat.weekdayOfMonth cannot be combined";
    const { nth, weekday: day } = rule.weekdayOfMonth;
    if (!isWhole(nth) || nth === 0 || nth < -5 || nth > 5) {
      return "repeat.weekdayOfMonth.nth must be 1 to 5, or -1 (last) to -5";
    }
    if (!isWhole(day) || day < 1 || day > 7) return "repeat.weekdayOfMonth.weekday must be 1 (Monday) to 7 (Sunday)";
  }
  if (rule.until !== undefined && rule.count !== undefined) return "repeat.until and repeat.count cannot be combined";
  if (rule.until !== undefined && !isValidDate(rule.until)) return `repeat.until must be YYYY-MM-DD, got "${rule.until}"`;
  if (rule.count !== undefined && (!isWhole(rule.count) || rule.count < 1 || rule.count > MAX_COUNT)) {
    return `repeat.count must be an integer from 1 to ${MAX_COUNT}`;
  }
  return null;
}

/** YYYY-MM-01 of the month `months` after the month of `date`. */
function monthStart(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

function daysInMonth(start: string): number {
  const [y, m] = start.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const withDay = (start: string, day: number) => `${start.slice(0, 8)}${String(day).padStart(2, "0")}`;

/** Day `monthDay` (-1 = the last) of the month starting `start`; a day the month lacks becomes its last day. */
export function monthDayIn(start: string, monthDay: number): string {
  const last = daysInMonth(start);
  return withDay(start, monthDay === -1 ? last : Math.min(monthDay, last));
}

/** The `nth` `weekday` of the month starting `start` (negative counts from its end), or null when it has none. */
export function nthWeekdayIn(start: string, nth: number, day: number): string | null {
  const last = daysInMonth(start);
  if (nth > 0) {
    const first = 1 + ((day - weekday(start) + 7) % 7) + 7 * (nth - 1);
    return first <= last ? withDay(start, first) : null;
  }
  const lastOfMonth = withDay(start, last);
  const found = last - ((weekday(lastOfMonth) - day + 7) % 7) - 7 * (-nth - 1);
  return found >= 1 ? withDay(start, found) : null;
}

type Position = { date: string; rule: RepeatRule };

/**
 * The next date of a series after `date`, the series running from `date`.
 * The rule comes back too: a plain monthly rule that had to move a 29-31 to a
 * shorter month's last day keeps the intended day from then on (`monthDay`),
 * so 31 Jan, 28 Feb, 31 Mar instead of drifting to the 28th. Null when no
 * later date exists.
 */
export function step(rule: RepeatRule, date: string): Position | null {
  switch (rule.every) {
    case "day":
      return { date: addDays(date, rule.interval), rule };
    case "year":
      return { date: addMonths(date, 12 * rule.interval, dayOfMonth(date)), rule };
    case "week": {
      if (!rule.weekdays) return { date: addDays(date, 7 * rule.interval), rule };
      const days = [...rule.weekdays].sort((a, b) => a - b);
      const current = weekday(date);
      const laterThisWeek = days.find((d) => d > current);
      if (laterThisWeek !== undefined) return { date: addDays(date, laterThisWeek - current), rule };
      const mondayOfWeek = addDays(date, 1 - current);
      return { date: addDays(mondayOfWeek, 7 * rule.interval + days[0] - 1), rule };
    }
    case "month": {
      if (rule.monthDay !== undefined) {
        const sameMonth = monthDayIn(monthStart(date, 0), rule.monthDay);
        if (sameMonth > date) return { date: sameMonth, rule };
        return { date: monthDayIn(monthStart(date, rule.interval), rule.monthDay), rule };
      }
      if (rule.weekdayOfMonth !== undefined) {
        const { nth, weekday: day } = rule.weekdayOfMonth;
        for (let k = 0; k <= MAX_MONTH_SEARCH; k += rule.interval) {
          const found = nthWeekdayIn(monthStart(date, k), nth, day);
          if (found !== null && found > date) return { date: found, rule };
        }
        return null;
      }
      const day = dayOfMonth(date);
      const next = addMonths(date, rule.interval, day);
      return { date: next, rule: dayOfMonth(next) < day ? { ...rule, monthDay: day } : rule };
    }
  }
}

/**
 * The next occurrence when a task of this rule is completed on `today` (the
 * user's local date). Counted from the due date (the default), it is the
 * first date of the series after today: a late completion skips the dates it
 * missed, and they count against `count`. Counted from completion (or for a
 * task without a due date), it is the first date after today. Null when the
 * series has ended (`until` passed, `count` used up).
 */
export function advance(
  rule: RepeatRule,
  dueDate: string | undefined,
  today: string,
): { dueDate: string; repeat: RepeatRule } | null {
  const fromCompletion = rule.from === "completion" || dueDate === undefined;
  let position: Position = { date: fromCompletion ? today : dueDate, rule };
  let steps = 0;
  do {
    const next = step(position.rule, position.date);
    if (next === null || ++steps > MAX_STEPS) return null;
    position = next;
  } while (position.date <= today);
  if (rule.until !== undefined && position.date > rule.until) return null;
  if (rule.count === undefined) return { dueDate: position.date, repeat: position.rule };
  const left = rule.count - steps;
  return left < 1 ? null : { dueDate: position.date, repeat: { ...position.rule, count: left } };
}

/** Next due date after completing a repeating task on `today`, or null when the series has ended. */
export function nextOccurrence(rule: RepeatRule, dueDate: string | undefined, today: string): string | null {
  return advance(rule, dueDate, today)?.dueDate ?? null;
}

/**
 * Dates of a series whose first occurrence is `start`, between `from` and
 * `to` (YYYY-MM-DD, both included), at most `limit` of them. The same dates
 * completing each occurrence on its day would create; a rule counted from
 * completion is shown that way too, since its later dates are not known yet.
 */
export function occurrences(
  rule: RepeatRule,
  start: string,
  range: { from: string; to: string },
  limit = 500,
): string[] {
  const dates: string[] = [];
  let position: Position | null = { date: start, rule };
  let left = rule.count ?? Infinity;
  while (position !== null && position.date <= range.to && dates.length < limit) {
    if (rule.until !== undefined && position.date > rule.until) break;
    if (position.date >= range.from) dates.push(position.date);
    if (--left < 1) break;
    position = step(position.rule, position.date);
  }
  return dates;
}
