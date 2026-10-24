// Dates in plain English for --due, move, list filters and `dayhand when`. A
// small deterministic grammar (no NLP): the same phrase at the same moment in
// the same time zone always gives the same day. English only in v1.
import { CliError } from "../core/exit.js";
import {
  addDays,
  addMonths,
  daysInMonth,
  instantOf,
  isoWeekday,
  isRealDate,
  localAt,
  makeDate,
  makeTime,
  monthOf,
  yearOf,
  type Local,
} from "./calendar.js";

export type WhenContext = { now: number; timezone: string };

export type When = {
  date: string;
  time?: string;
  /** The typed time does not exist that day (clocks go forward) and was moved forward to `time`. */
  shiftedFrom?: string;
};

export class WhenError extends Error {}

/** A phrase that is not understood is a bad argument, like a bad date the server rejects (exit 2). */
export const dateError = (error: WhenError) =>
  new CliError("invalid_argument", error.message, { valid: WHEN_EXAMPLES, hint: "dayhand help dates" });

/** Forms shown in help and in the error for a phrase that is not understood. */
export const WHEN_EXAMPLES = [
  "today",
  "tomorrow",
  "fri",
  "next mon",
  "this weekend",
  "in 3 days",
  "+2w",
  "in 2 hours",
  "eow",
  "eom",
  "23 oct",
  "oct 23 2027",
  "2026-10-23",
  "14:00",
  "2pm",
  "noon",
  "tomorrow at 9am",
  "fri 14:30",
];

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4,
  thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

type Unit = "minute" | "hour" | "day" | "week" | "month" | "year";
const UNITS: Record<string, Unit> = {
  min: "minute", mins: "minute", minute: "minute", minutes: "minute", h: "hour", hr: "hour", hrs: "hour",
  hour: "hour", hours: "hour", d: "day", day: "day", days: "day", w: "week", wk: "week", wks: "week",
  week: "week", weeks: "week", mo: "month", month: "month", months: "month", y: "year", yr: "year",
  yrs: "year", year: "year", years: "year",
};

type Ref = { now: number; timezone: string; today: string; time: string };

/** Own keys only, so "constructor" or "toString" is never a weekday. */
const lookup = <T>(record: Record<string, T>, key: string | undefined): T | undefined =>
  key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
type Match<T> = { value: T; next: number } | undefined;

export function parseWhen(text: string, context: WhenContext): When {
  const tokens = text.toLowerCase().replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw notUnderstood();
  const local = localAt(context.now, context.timezone);
  const ref: Ref = { ...context, today: local.date, time: local.time };

  const instant = relativeInstant(tokens, ref);
  if (instant) return instant;

  const date = datePart(tokens, 0, ref);
  if (date) {
    if (date.next === tokens.length) return { date: date.value };
    const time = timePart(tokens, date.next);
    if (time && time.next === tokens.length) return settle({ date: date.value, time: time.value }, ref.timezone);
    throw notUnderstood();
  }
  const time = timePart(tokens, 0);
  if (!time) throw notUnderstood();
  if (time.next === tokens.length) {
    // A time alone is the next time the clock shows it: today, or tomorrow once it has passed.
    const day = time.value > ref.time ? ref.today : addDays(ref.today, 1);
    return settle({ date: day, time: time.value }, ref.timezone);
  }
  const start = tokens[time.next] === "on" ? time.next + 1 : time.next;
  const after = datePart(tokens, start, ref);
  if (after && after.next === tokens.length) return settle({ date: after.value, time: time.value }, ref.timezone);
  throw notUnderstood();
}

function notUnderstood(): WhenError {
  return new WhenError(`Not a date dayhand understands; try e.g. ${["tomorrow", "fri 14:00", "next mon", "in 3 days", "23 oct", "2026-10-23"].join(", ")}`);
}

/** A wall-clock time that does not exist (clocks going forward) moves forward by the gap. */
function settle(local: Local, timezone: string): When {
  const real = localAt(instantOf(local, timezone), timezone);
  if (real.date === local.date && real.time === local.time) return { ...local };
  return { ...real, shiftedFrom: local.time };
}

const count = (word: string | undefined) => {
  if (word === undefined) return undefined;
  if (/^\d{1,3}$/.test(word)) return Number(word);
  return lookup(NUMBERS, word);
};

/** "in 2 hours", "in 30 min", "+3h": a moment, so both a day and a time. */
function relativeInstant(tokens: string[], ref: Ref): When | undefined {
  let amount: number | undefined;
  let unit: Unit | undefined;
  const short = tokens.length === 1 ? /^\+(\d{1,3})(h|min)$/.exec(tokens[0]!) : null;
  if (short) [amount, unit] = [Number(short[1]), lookup(UNITS, short[2])];
  else if (tokens.length === 3 && tokens[0] === "in") [amount, unit] = [count(tokens[1]), lookup(UNITS, tokens[2])];
  if (amount === undefined || (unit !== "hour" && unit !== "minute")) return undefined;
  return localAt(ref.now + amount * (unit === "hour" ? 3_600_000 : 60_000), ref.timezone);
}

function shift(date: string, amount: number, unit: Unit): string {
  if (unit === "day") return addDays(date, amount);
  if (unit === "week") return addDays(date, amount * 7);
  if (unit === "month") return addMonths(date, amount);
  return addMonths(date, amount * 12);
}

/** First day on or after `from` with this ISO weekday. */
const onOrAfter = (from: string, weekday: number) => addDays(from, (weekday - isoWeekday(from) + 7) % 7);
const nextWeekMonday = (today: string) => addDays(today, 8 - isoWeekday(today));

function datePart(tokens: string[], start: number, ref: Ref): Match<string> {
  let i = start;
  if (tokens[i] === "on") i++;
  const word = tokens[i];
  if (word === undefined) return undefined;
  const one = (value: string) => ({ value, next: i + 1 });
  const two = (value: string) => ({ value, next: i + 2 });

  const simple: Record<string, () => string> = {
    today: () => ref.today,
    tod: () => ref.today,
    tomorrow: () => addDays(ref.today, 1),
    tmr: () => addDays(ref.today, 1),
    tmrw: () => addDays(ref.today, 1),
    yesterday: () => addDays(ref.today, -1),
    weekend: () => weekend(ref.today),
    eow: () => onOrAfter(ref.today, 7),
    eoww: () => onOrAfter(ref.today, 5),
    eom: () => makeDate(yearOf(ref.today), monthOf(ref.today), daysInMonth(yearOf(ref.today), monthOf(ref.today))),
    eoy: () => makeDate(yearOf(ref.today), 12, 31),
  };
  const resolve = lookup(simple, word);
  if (resolve) return one(resolve());
  const weekday = lookup(WEEKDAYS, word);
  if (weekday) return one(addDays(ref.today, ((weekday - isoWeekday(ref.today) + 6) % 7) + 1));

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
  if (iso) return one(realDate(Number(iso[1]), Number(iso[2]), Number(iso[3])));

  const plus = /^\+(\d{1,3})(d|w|mo|y)$/.exec(word);
  if (plus) return one(shift(ref.today, Number(plus[1]), lookup(UNITS, plus[2])!));

  const following = tokens[i + 1];
  const followingDay = lookup(WEEKDAYS, following);
  if (word === "this" && following !== undefined) {
    if (followingDay) return two(onOrAfter(ref.today, followingDay));
    if (following === "weekend") return two(weekend(ref.today));
  }
  if (word === "next" && following !== undefined) {
    const monday = nextWeekMonday(ref.today);
    if (followingDay) return two(addDays(monday, followingDay - 1));
    if (following === "week") return two(monday);
    if (following === "weekend") return two(addDays(monday, 5));
    if (following === "month") return two(makeDate(yearOf(addMonths(ref.today, 1)), monthOf(addMonths(ref.today, 1)), 1));
    if (following === "year") return two(makeDate(yearOf(ref.today) + 1, 1, 1));
  }
  if (word === "in" && following !== undefined) {
    const amount = count(following);
    const unit = lookup(UNITS, tokens[i + 2]);
    if (amount !== undefined && unit && unit !== "hour" && unit !== "minute") {
      return { value: shift(ref.today, amount, unit), next: i + 3 };
    }
  }
  return phraseDate(tokens, i, ref) ?? dayMonth(tokens, i, ref);
}

/** Saturday on or after today; on a Sunday, today. */
const weekend = (today: string) => (isoWeekday(today) === 7 ? today : onOrAfter(today, 6));

/** "end of week/work week/month/year", "day after tomorrow". */
function phraseDate(tokens: string[], i: number, ref: Ref): Match<string> {
  const rest = tokens.slice(i).join(" ");
  const phrases: [RegExp, () => string][] = [
    [/^(the )?day after tomorrow\b/, () => addDays(ref.today, 2)],
    [/^end of (the )?work week\b/, () => onOrAfter(ref.today, 5)],
    [/^end of (the )?week\b/, () => onOrAfter(ref.today, 7)],
    [/^end of (the )?month\b/, () => makeDate(yearOf(ref.today), monthOf(ref.today), daysInMonth(yearOf(ref.today), monthOf(ref.today)))],
    [/^end of (the )?year\b/, () => makeDate(yearOf(ref.today), 12, 31)],
  ];
  for (const [pattern, resolve] of phrases) {
    const found = pattern.exec(rest);
    if (found) return { value: resolve(), next: i + found[0].split(" ").length };
  }
  return undefined;
}

/** "23 oct", "23rd of october 2027", "oct 23", "the 15th". */
function dayMonth(tokens: string[], start: number, ref: Ref): Match<string> {
  let i = start;
  if (tokens[i] === "the") i++;
  const day = (word: string | undefined) => /^(\d{1,2})(st|nd|rd|th)?$/.exec(word ?? "");
  const year = (word: string | undefined) => (/^\d{4}$/.test(word ?? "") ? Number(word) : undefined);

  const first = day(tokens[i]);
  if (first) {
    let j = i + 1;
    if (tokens[j] === "of") j++;
    const month = lookup(MONTHS, tokens[j]);
    if (month) {
      const y = year(tokens[j + 1]);
      return { value: dated(Number(first[1]), month, y, ref), next: y === undefined ? j + 1 : j + 2 };
    }
    // "the 15th": the next 15th of a month, this month included.
    if (first[2]) return { value: nextDayOfMonth(Number(first[1]), ref.today), next: i + 1 };
    return undefined;
  }
  const month = lookup(MONTHS, tokens[i]);
  const second = day(tokens[i + 1]);
  if (month && second) {
    const y = year(tokens[i + 2]);
    return { value: dated(Number(second[1]), month, y, ref), next: y === undefined ? i + 2 : i + 3 };
  }
  return undefined;
}

function realDate(year: number, month: number, day: number): string {
  if (!isRealDate(year, month, day)) throw new WhenError("That day does not exist in the calendar");
  return makeDate(year, month, day);
}

/** With a year, exactly that day; without, its next occurrence (today included). */
function dated(day: number, month: number, year: number | undefined, ref: Ref): string {
  if (year !== undefined) return realDate(year, month, day);
  for (let y = yearOf(ref.today); y < yearOf(ref.today) + 9; y++) {
    if (isRealDate(y, month, day) && makeDate(y, month, day) >= ref.today) return makeDate(y, month, day);
  }
  throw new WhenError("That day does not exist in the calendar");
}

function nextDayOfMonth(day: number, today: string): string {
  if (day < 1 || day > 31) throw new WhenError("That day does not exist in the calendar");
  for (let m = 0; m < 13; m++) {
    const month = addMonths(makeDate(yearOf(today), monthOf(today), 1), m);
    if (day <= daysInMonth(yearOf(month), monthOf(month))) {
      const candidate = makeDate(yearOf(month), monthOf(month), day);
      if (candidate >= today) return candidate;
    }
  }
  throw new WhenError("That day does not exist in the calendar");
}

/** "14:00", "9:30am", "2pm", "2 pm", "at 9", "noon", "midnight" (24h unless am/pm). */
function timePart(tokens: string[], start: number): Match<string> {
  let i = start;
  const at = tokens[i] === "at";
  if (at) i++;
  const word = tokens[i];
  if (word === undefined) return undefined;
  if (word === "noon") return { value: "12:00", next: i + 1 };
  if (word === "midnight") return { value: "00:00", next: i + 1 };

  const found = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(word);
  if (!found) return undefined;
  let meridiem = found[3];
  let next = i + 1;
  if (!meridiem && (tokens[next] === "am" || tokens[next] === "pm")) meridiem = tokens[next++];
  // A bare number is a time only after "at" ("at 9"); "9" alone is not a date or a time.
  if (!meridiem && found[2] === undefined && !at) return undefined;

  let hour = Number(found[1]);
  const minute = found[2] === undefined ? 0 : Number(found[2]);
  if (minute > 59) throw new WhenError("Minutes must be 00 to 59");
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new WhenError("With am or pm the hour must be 1 to 12");
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    throw new WhenError("The hour must be 0 to 23");
  }
  return { value: makeTime(hour, minute), next };
}

/** For the day column and `dayhand when`: "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(date: string, today: string): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
