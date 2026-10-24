// The plan as iCalendar (RFC 5545), for the read-only calendar feed
// (GET /cal/<token>.ics) and the .ics export. Pure functions.
//
// - A task with a day and a time is an event of EVENT_MINUTES at that time in
//   the user's time zone (with its VTIMEZONE); a task with only a day is an
//   all-day event. Tasks without a day, archived tasks and the trash are left
//   out; done tasks stay for DONE_DAYS as single events marked ✓.
// - A repeating task is one event with its rule as RRULE (lib/rrule.ts). When
//   its due date is not itself a date of the rule (a weekly Mon/Thu task due
//   on a Wednesday), RFC 5545 leaves the series undefined, so that first date
//   is its own event and the series starts at the next date (lib/repeat.ts).
//   A monthly rule on a 29th-31st (the last day of shorter months in Dayhand)
//   needs BYMONTHDAY with BYSETPOS, which calendar apps do not all expand
//   (ical.js ignores it), so its dates for LISTED_DAYS are single events.
// - Reminders become VALARMs relative to the start: the task's own, else the
//   default minutes from the settings (those need a time).
// - UID is `<task id>@helm` (the rest of a split series `<task id>-next@helm`,
//   a listed date `<task id>-<YYYYMMDD>@helm`) and DTSTAMP the task's last change, so an unchanged plan gives the same
//   text. The UIDs keep "@helm" from before the rename to Dayhand: calendars that
//   already show the feed would otherwise see every event as new.
import type { Doc } from "../_generated/dataModel";
import { addDays, dayOfMonth, localDate, weekday } from "./dates";
import { monthDayIn, nthWeekdayIn, occurrences, step } from "./repeat";
import { toRRule } from "./rrule";
import type { Reminder, RepeatRule } from "./validators";
import { vtimezoneLines, zonedInstant } from "./vtimezone";

export const EVENT_MINUTES = 30;
export const DONE_DAYS = 90;
export const LISTED_DAYS = 731;
const LISTED_LIMIT = 100;
const PRODID = "-//Dayhand//Dayhand planner//EN";
const MAX_LINE_OCTETS = 75;

export type CalendarOptions = {
  timezone: string;
  defaultReminderMinutes: number[];
  /** Now (Unix ms): decides which done tasks are still shown. */
  at: number;
};

// ---- Text ----

/** TEXT value (3.3.11): backslash, semicolon, comma and line breaks escaped; other control characters dropped. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets (3.1), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const pieces: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75.
    const limit = pieces.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      pieces.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  pieces.push(current);
  return pieces.join("\r\n ");
}

const basicDate = (date: string) => date.replace(/-/g, "");

/** UTC DATE-TIME: 20261023T140000Z. */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Signed duration (3.3.6) of whole minutes: -PT30M, -P1DT6H, PT9H, PT0M. */
export function duration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  let rest = Math.abs(minutes);
  const days = Math.floor(rest / 1440);
  rest -= days * 1440;
  const hours = Math.floor(rest / 60);
  const mins = rest % 60;
  const time = (hours ? `${hours}H` : "") + (mins ? `${mins}M` : "");
  if (days && !time) return `${sign}P${days}D`;
  return `${sign}P${days ? `${days}D` : ""}T${time || "0M"}`;
}

// ---- Series ----

const monthStartOf = (date: string) => `${date.slice(0, 8)}01`;

/** Whether `date` is itself a date of the rule's pattern, as RFC 5545 expands it from DTSTART. */
export function startsSeries(rule: RepeatRule, date: string): boolean {
  if (rule.every === "week" && rule.weekdays) return rule.weekdays.includes(weekday(date));
  if (rule.every === "month" && rule.monthDay !== undefined) return monthDayIn(monthStartOf(date), rule.monthDay) === date;
  if (rule.every === "month" && rule.weekdayOfMonth) {
    return nthWeekdayIn(monthStartOf(date), rule.weekdayOfMonth.nth, rule.weekdayOfMonth.weekday) === date;
  }
  // 29 February: Dayhand goes on from 28 February, RFC 5545 only from leap days.
  if (rule.every === "year") return !date.endsWith("-02-29");
  return true;
}

/** Whether the series is written as its dates: a monthly rule on a 29th-31st (see the top of this file). */
export function listsDates(rule: RepeatRule, date: string): boolean {
  if (rule.every !== "month" || rule.weekdayOfMonth !== undefined) return false;
  return (rule.monthDay ?? dayOfMonth(date)) > 28;
}

type Occurrence = { uid: string; date: string; rule?: RepeatRule };

/** The events of one task: its due date, with the series (or split into the first date and the series after it). */
function occurrencesOf(task: Doc<"tasks">, today: string): Occurrence[] {
  const uid = `${task._id}@helm`;
  const date = task.dueDate!;
  const rule = task.status === "done" ? undefined : task.repeat;
  if (!rule) return [{ uid, date }];
  if (listsDates(rule, date)) {
    const to = addDays(date > today ? date : today, LISTED_DAYS);
    return occurrences(rule, date, { from: date, to }, LISTED_LIMIT).map((d, i) => ({
      uid: i === 0 ? uid : `${task._id}-${basicDate(d)}@helm`,
      date: d,
    }));
  }
  if (startsSeries(rule, date)) return [{ uid, date, rule }];
  const first = { uid, date };
  if (rule.count === 1) return [first];
  const next = step(rule, date);
  if (next === null || (rule.until !== undefined && next.date > rule.until)) return [first];
  const nextRule = rule.count === undefined ? next.rule : { ...next.rule, count: rule.count - 1 };
  return [first, { uid: `${task._id}-next@helm`, date: next.date, rule: nextRule }];
}

/** RRULE of a series; for a timed one UNTIL becomes the end of that day in UTC, as RFC 5545 requires. */
function rruleLine(rule: RepeatRule, date: string, time: string | undefined, timezone: string): string {
  const { until, ...withoutUntil } = rule;
  let text = toRRule(withoutUntil, date);
  if (until !== undefined) {
    text += `;UNTIL=${time === undefined ? basicDate(until) : utcStamp(zonedInstant(until, "23:59:59", timezone))}`;
  }
  return `RRULE:${text}`;
}

// ---- Alarms ----

const minutesOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Minutes from the event's start to the reminder; null when the reminder needs a time the task lacks. */
export function alarmOffset(reminder: Reminder, dueTime: string | undefined): number | null {
  const start = dueTime === undefined ? 0 : minutesOfDay(dueTime);
  if ("minutesBefore" in reminder) return dueTime === undefined ? null : -reminder.minutesBefore;
  return minutesOfDay(reminder.time) - (reminder.daysBefore ?? 0) * 1440 - start;
}

function alarmLines(task: Doc<"tasks">, options: CalendarOptions): string[] {
  if (task.status === "done") return [];
  const reminders: Reminder[] = task.reminders ?? options.defaultReminderMinutes.map((minutesBefore) => ({ minutesBefore }));
  const offsets = [...new Set(reminders.map((r) => alarmOffset(r, task.dueTime)).filter((o): o is number => o !== null))];
  return offsets.flatMap((offset) => [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(task.title)}`,
    `TRIGGER:${duration(offset)}`,
    "END:VALARM",
  ]);
}

// ---- Events ----

function eventLines(task: Doc<"tasks">, occurrence: Occurrence, options: CalendarOptions): string[] {
  const { timezone } = options;
  const time = task.dueTime;
  const start = time === undefined
    ? [`DTSTART;VALUE=DATE:${basicDate(occurrence.date)}`, `DTEND;VALUE=DATE:${basicDate(addDays(occurrence.date, 1))}`]
    : [`DTSTART;TZID=${timezone}:${basicDate(occurrence.date)}T${time.replace(":", "")}00`, `DURATION:${duration(EVENT_MINUTES)}`];
  const summary = task.status === "done" ? `✓ ${task.title}` : task.title;
  const description = [task.ref !== undefined ? `Dayhand #${task.ref}` : "Dayhand", task.note].filter(Boolean).join("\n\n");
  return [
    "BEGIN:VEVENT",
    `UID:${occurrence.uid}`,
    `DTSTAMP:${utcStamp(task.updatedAt)}`,
    `CREATED:${utcStamp(task.createdAt)}`,
    `LAST-MODIFIED:${utcStamp(task.updatedAt)}`,
    ...start,
    ...(occurrence.rule ? [rruleLine(occurrence.rule, occurrence.date, time, timezone)] : []),
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(task.labels.length ? [`CATEGORIES:${task.labels.map(escapeText).join(",")}`] : []),
    // A task does not make you busy.
    "TRANSP:TRANSPARENT",
    ...alarmLines(task, options),
    "END:VEVENT",
  ];
}

/** Whether the task belongs in the calendar: dated, active, and not done long ago. */
export function inCalendar(task: Doc<"tasks">, today: string): boolean {
  if (task.dueDate === undefined || task.deletedAt !== undefined || task.archivedAt !== undefined) return false;
  return task.status !== "done" || task.dueDate >= addDays(today, -DONE_DAYS);
}

const byDue = (a: Doc<"tasks">, b: Doc<"tasks">) =>
  `${a.dueDate} ${a.dueTime ?? ""}`.localeCompare(`${b.dueDate} ${b.dueTime ?? ""}`) || a.createdAt - b.createdAt;

/** The whole calendar as text with CRLF line ends. */
export function renderCalendar(tasks: Doc<"tasks">[], options: CalendarOptions): string {
  const today = localDate(options.at, options.timezone);
  const shown = tasks.filter((t) => inCalendar(t, today)).sort(byDue);
  const events = shown.flatMap((task) => occurrencesOf(task, today).flatMap((o) => eventLines(task, o, options)));
  const timed = shown.filter((t) => t.dueTime !== undefined);
  const years = timed.map((t) => Number(t.dueDate!.slice(0, 4)));
  const thisYear = Number(today.slice(0, 4));
  const zone = timed.length
    ? vtimezoneLines(options.timezone, Math.min(thisYear, ...years), Math.max(thisYear, ...years) + 1)
    : [];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Dayhand",
    `X-WR-TIMEZONE:${options.timezone}`,
    // How often a subscribed client should look again (RFC 7986 and the older Apple/Microsoft name).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...zone,
    ...events,
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
