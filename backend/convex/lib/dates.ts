// Calendar dates are plain YYYY-MM-DD strings in the user's time zone.
// Everything that decides "today" or "overdue" lives in this file.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at instant `ms` in `timezone`. */
export function localDate(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "YYYY-MM-DD HH:MM" at instant `ms` in `timezone`. */
export function localDateTime(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function toUtcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return fromUtcDate(result);
}

/** Adds months keeping `anchorDay` where the month allows it (Jan 31 -> Feb 28 -> Mar 31). */
export function addMonths(date: string, months: number, anchorDay: number): string {
  const start = toUtcDate(date);
  const firstOfTarget = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(anchorDay, lastDay));
  return fromUtcDate(firstOfTarget);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function weekday(date: string): number {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function dayOfMonth(date: string): number {
  return toUtcDate(date).getUTCDate();
}

/**
 * Overdue = not done, still active, and due before today in the user's zone.
 * The single definition used by every view.
 */
export function isOverdue(
  task: { status: string; dueDate?: string; archivedAt?: number; deletedAt?: number },
  today: string,
): boolean {
  return (
    task.status !== "done" &&
    task.archivedAt === undefined &&
    task.deletedAt === undefined &&
    task.dueDate !== undefined &&
    task.dueDate < today
  );
}

/** Accepts YYYY-MM-DD or the words "today" / "tomorrow". Returns null when invalid. */
export function resolveDate(input: string, today: string): string | null {
  const value = input.trim().toLowerCase();
  if (value === "today") return today;
  if (value === "tomorrow") return addDays(today, 1);
  return isValidDate(value) ? value : null;
}
