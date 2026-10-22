// Calendar arithmetic on plain "YYYY-MM-DD" days and wall-clock "HH:MM"
// times in an IANA time zone. Days carry no zone, so adding days or months
// never shifts by an hour; only "now" and instants go through the zone.

export type Local = { date: string; time: string };

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const toDayNumber = (date: string) => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const makeDate = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
export const makeTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

export function isRealDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const addDays = (date: string, days: number) => fromUtc((toDayNumber(date) + days) * DAY_MS);
export const daysBetween = (from: string, to: string) => toDayNumber(to) - toDayNumber(from);

/** Same day of the month, clamped to the month's last day (31 Jan + 1 month = 28 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return makeDate(year, month, Math.min(d, daysInMonth(year, month)));
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: string): number {
  const day = new Date(toDayNumber(date) * DAY_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

export const yearOf = (date: string) => parts(date)[0];
export const monthOf = (date: string) => parts(date)[1];
export const dayOf = (date: string) => parts(date)[2];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let found = formatters.get(timezone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, found);
  }
  return found;
}

export function isTimezone(timezone: string): boolean {
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `timezone` at an instant (seconds dropped). */
export function localAt(ms: number, timezone: string): Local {
  const p = Object.fromEntries(formatter(timezone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const naiveUtc = (local: Local) => {
  const [y, m, d] = parts(local.date);
  const [h, min] = local.time.split(":").map(Number) as [number, number];
  return Date.UTC(y, m - 1, d, h, min);
};

/** Offset of the zone from UTC at an instant, in ms. */
const offsetAt = (ms: number, timezone: string) => {
  const whole = Math.floor(ms / 60_000) * 60_000;
  return naiveUtc(localAt(whole, timezone)) - whole;
};

/**
 * The instant of a wall-clock time, like Temporal's "compatible" choice: a
 * time that happens twice (clocks going back) is the earlier one; a time that
 * does not exist (clocks going forward) moves forward by the gap.
 */
export function instantOf(local: Local, timezone: string): number {
  const naive = naiveUtc(local);
  const before = naive - offsetAt(naive - DAY_MS, timezone);
  const after = naive - offsetAt(naive + DAY_MS, timezone);
  const matches = (ms: number) => {
    const at = localAt(ms, timezone);
    return at.date === local.date && at.time === local.time;
  };
  const valid = [before, after].filter(matches);
  return valid.length ? Math.min(...valid) : before;
}
