// VTIMEZONE (RFC 5545, 3.6.5) for one IANA time zone, built from the
// runtime's own time zone data. The offsets come from Intl; their changes
// are found day by day and then to the minute. A change that falls on the
// same weekday of the same month at the same time every year becomes one
// yearly RRULE (as Europe/London's last Sunday of March and October); any
// other pattern lists its dates (RDATE).
import { weekday } from "./dates";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

type Transition = { at: number; from: number; to: number; name: string };
type LocalTime = { date: string; time: string };

/** Offset of `timezone` from UTC at instant `ms`, in minutes, with the zone's short name. */
function zoneReader(timezone: string) {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return (ms: number): { offset: number; name: string } => {
    const parts = format.formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const wall = Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour"), +get("minute"), +get("second"));
    const whole = Math.floor(ms / 1000) * 1000;
    return { offset: Math.round((wall - whole) / MINUTE_MS), name: get("timeZoneName") };
  };
}

/** Every change of offset between `from` and `to` (Unix ms), to the minute. */
function transitions(timezone: string, from: number, to: number): Transition[] {
  const read = zoneReader(timezone);
  const found: Transition[] = [];
  let before = read(from);
  for (let day = from + DAY_MS; day <= to; day += DAY_MS) {
    const after = read(day);
    if (after.offset !== before.offset) {
      // The change is in (day - 1 day, day]; narrow it to the minute.
      let low = day - DAY_MS;
      let high = day;
      while (high - low > MINUTE_MS) {
        const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
        if (read(middle).offset === before.offset) low = middle;
        else high = middle;
      }
      found.push({ at: high, from: before.offset, to: after.offset, name: read(high).name });
    }
    before = after;
  }
  return found;
}

/** Local wall-clock time of instant `ms` at `offset` minutes from UTC. */
function localAt(ms: number, offset: number): LocalTime {
  const iso = new Date(ms + offset * MINUTE_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

const basicDateTime = ({ date, time }: LocalTime) => `${date.replace(/-/g, "")}T${time.replace(/:/g, "")}`;

/** +HHMM / -HHMM. */
export function utcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

/** BYDAY of a date as the nth weekday of its month: 2SU, or -1SU when it is the last one. */
function monthPosition(date: string): { month: number; byDay: string; last: boolean; nth: number } {
  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const code = DAY_CODES[weekday(date) - 1];
  const nth = Math.ceil(d / 7);
  const last = d + 7 > daysInMonth;
  return { month: m, byDay: code, last, nth };
}

/** The yearly rule all these changes follow, or null when they follow none. */
function yearlyRule(local: LocalTime[]): string | null {
  const positions = local.map((l) => monthPosition(l.date));
  const first = positions[0];
  const sameTime = local.every((l) => l.time === local[0].time);
  const sameDay = positions.every((p) => p.month === first.month && p.byDay === first.byDay);
  if (!sameTime || !sameDay) return null;
  const years = local.map((l) => Number(l.date.slice(0, 4)));
  if (years.some((year, i) => i > 0 && year !== years[i - 1] + 1)) return null;
  if (positions.every((p) => p.last)) return `FREQ=YEARLY;BYMONTH=${first.month};BYDAY=-1${first.byDay}`;
  if (positions.every((p) => p.nth === first.nth)) return `FREQ=YEARLY;BYMONTH=${first.month};BYDAY=${first.nth}${first.byDay}`;
  return null;
}

/**
 * The VTIMEZONE lines of `timezone`, valid for every local time from
 * `fromYear` to `toYear` (and later, while the zone keeps its yearly rules).
 */
export function vtimezoneLines(timezone: string, fromYear: number, toYear: number): string[] {
  // A year earlier, so the first event already has an observance in effect.
  const start = Date.UTC(fromYear - 1, 0, 1);
  const end = Date.UTC(toYear + 1, 0, 1);
  const changes = transitions(timezone, start, end);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timezone}`];
  if (changes.length === 0) {
    const { offset, name } = zoneReader(timezone)(start);
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${utcOffset(offset)}`,
      `TZOFFSETTO:${utcOffset(offset)}`,
      ...(name ? [`TZNAME:${name}`] : []),
      "END:STANDARD",
    );
    return [...lines, "END:VTIMEZONE"];
  }
  // One observance per kind of change (from offset -> to offset).
  const groups = new Map<string, Transition[]>();
  for (const change of changes) {
    const key = `${change.from}>${change.to}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  for (const group of groups.values()) {
    const { from, to, name } = group[0];
    const kind = to > from ? "DAYLIGHT" : "STANDARD";
    const local = group.map((c) => localAt(c.at, c.from));
    const rule = yearlyRule(local);
    lines.push(`BEGIN:${kind}`, `DTSTART:${basicDateTime(local[0])}`, `TZOFFSETFROM:${utcOffset(from)}`, `TZOFFSETTO:${utcOffset(to)}`);
    if (rule) lines.push(`RRULE:${rule}`);
    else if (local.length > 1) lines.push(`RDATE:${local.slice(1).map(basicDateTime).join(",")}`);
    if (name) lines.push(`TZNAME:${name}`);
    lines.push(`END:${kind}`);
  }
  return [...lines, "END:VTIMEZONE"];
}

/** The UTC instant of local `date` `time` (HH:MM:SS) in `timezone`; a time a clock change skips moves past the gap. */
export function zonedInstant(date: string, time: string, timezone: string): number {
  const read = zoneReader(timezone);
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss ?? 0);
  // Two rounds settle the offset, also next to a change.
  const first = wall - read(wall).offset * MINUTE_MS;
  return wall - read(first).offset * MINUTE_MS;
}
