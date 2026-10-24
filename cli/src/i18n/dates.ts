// Days, repeat rules and reminders as dayhand ui shows them in the current
// language. English keeps the CLI's own formatters (render/format.ts), so its
// screens read exactly as before; other languages take their day and month
// names from Intl. Times stay HH:MM, the way they line up in columns.
import { describeReminder, describeRepeat, formatDay, relativeDate } from "../render/format.js";
import type { Reminder, Repeat } from "../render/model.js";
import { daysBetween, yearOf } from "../when/calendar.js";
import { getLanguage, t } from "./index.js";

const english = () => getLanguage() === "en";

function utc(date: string): Date | undefined {
  const [y, m, d] = date.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : undefined;
}

function intlDay(date: string, options: Intl.DateTimeFormatOptions): string {
  const day = utc(date);
  return day ? new Intl.DateTimeFormat(getLanguage(), { timeZone: "UTC", ...options }).format(day) : date;
}

/** "Thu 22 Oct 2026", "czw., 22 paź 2026", "2026年10月22日(木)". */
export const dayText = (date: string): string =>
  english() ? formatDay(date) : intlDay(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** The weekday and the day of the month apart, for the week's column headings: ["Thu", "22"]. */
export function weekdayAndDay(date: string): [string, string] {
  const dayOfMonth = String(Number(date.slice(8, 10)));
  if (english()) return [formatDay(date).split(" ")[0]!, dayOfMonth];
  return [intlDay(date, { weekday: "short" }), dayOfMonth];
}

/** "today", "tomorrow", "yesterday", or "Fri 23 Oct" (with the year when not this year's). */
export function relativeDay(date: string, today?: string): string {
  if (english()) return relativeDate(date, today);
  if (!today) return date;
  const days = daysBetween(today, date);
  if (days === 0) return t("day.today");
  if (days === 1) return t("day.tomorrow");
  if (days === -1) return t("day.yesterday");
  const sameYear = yearOf(date) === yearOf(today);
  return intlDay(date, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** ", " between the parts of a rule; Japanese and Chinese use the enumeration comma. */
const separator = () => (getLanguage() === "ja" || getLanguage() === "zh-Hans" ? "、" : ", ");

const weekdayName = (isoWeekday: number) => intlDay(`2026-01-${String(4 + isoWeekday).padStart(2, "0")}`, { weekday: "short" });

/** "every 2 weeks on Mon, Thu", "co 2 tygodnie: pon., czw.". */
export function repeatText(repeat: Repeat): string {
  if (english()) return describeRepeat(repeat);
  const n = repeat.interval;
  const parts = [t(`repeat.${repeat.every}`, { count: n })];
  if (repeat.weekdays?.length) parts.push(t("repeat.on", { days: repeat.weekdays.map(weekdayName).join(separator()) }));
  if (repeat.monthDay !== undefined) parts.push(repeat.monthDay === -1 ? t("repeat.lastDay") : t("repeat.monthDay", { day: repeat.monthDay }));
  if (repeat.weekdayOfMonth) {
    const { nth, weekday } = repeat.weekdayOfMonth;
    const name = weekdayName(weekday);
    parts.push(nth === -1 ? t("repeat.lastWeekday", { weekday: name }) : nth < 0 ? t("repeat.fromEnd", { weekday: name, nth: -nth }) : t("repeat.nthWeekday", { weekday: name, nth }));
  }
  if (repeat.from === "completion") parts.push(t("repeat.fromCompletion"));
  if (repeat.until) parts.push(t("repeat.until", { date: repeat.until }));
  if (repeat.count !== undefined) parts.push(t("repeat.times", { count: repeat.count }));
  return parts.join(separator());
}

/** "15 min before", "at the due time", "09:00", "18:00 1 day before". */
export function reminderText(reminder: Reminder): string {
  if (english()) return describeReminder(reminder);
  if ("minutesBefore" in reminder) {
    const m = reminder.minutesBefore;
    if (m === 0) return t("remind.atDue");
    if (m % 1440 === 0) return t("remind.days", { count: m / 1440 });
    if (m % 60 === 0) return t("remind.hours", { count: m / 60 });
    return t("remind.minutes", { count: m });
  }
  const days = reminder.daysBefore ?? 0;
  return days ? t("remind.timeDaysBefore", { time: reminder.time, days: t("remind.days", { count: days }) }) : reminder.time;
}
