// The top of Today: a strip of the next days (today in reverse, a dot for each
// open task, up to three) and one sentence about the day with its counts and
// what the plan health report asks for. Reverse and bold survive NO_COLOR.
import { shortWeekday } from "../../i18n/dates.js";
import { t } from "../../i18n/index.js";
import type { TodayView } from "../../render/model.js";
import { addDays, localAt } from "../../when/calendar.js";
import type { Health } from "../agents.js";
import { PLAN_DAYS } from "../api.js";
import { healthExtras } from "../health.js";
import { fitRow, padTo, rowWidth, seg, widthOf, type Row, type Seg } from "../text.js";

const CELL = 4;
const MIN_DAYS = 7;
/** Below this many content rows the strip of days gives its three rows to the tasks. */
export const STRIP_MIN_HEIGHT = 14;

/** Three rows: weekdays, dates, and dots for open tasks; as many days as fit, at least a week. */
export function dayStrip(date: string, perDay: number[], width: number): Row[] {
  const count = Math.min(PLAN_DAYS, Math.max(MIN_DAYS, Math.floor(width / CELL)));
  const days = Array.from({ length: count }, (_, i) => ({ date: addDays(date, i), open: perDay[i] ?? 0, today: i === 0 }));
  const cell = (text: string) => padTo(` ${text}`, CELL);
  return [
    days.map((d) => seg(cell(shortWeekday(d.date)), { bold: d.today, dim: !d.today })),
    days.map((d) => seg(cell(String(Number(d.date.slice(8, 10))).padStart(2)), d.today ? { bold: true, inverse: true } : {})),
    days.map((d) => seg(cell("•".repeat(Math.min(3, d.open))), { color: d.today ? "blue" : undefined, dim: !d.today })),
  ];
}

function greeting(now: number, timezone: string): string {
  const hour = Number(localAt(now, timezone).time.slice(0, 2));
  if (hour >= 5 && hour < 12) return t("summary.morning");
  if (hour >= 12 && hour < 18) return t("summary.afternoon");
  return t("summary.evening");
}

export function summaryParts(view: TodayView, health: Health | undefined, now: number, timezone: string): Seg[] {
  const open = view.today.filter((task) => !task.isNow && task.status !== "done");
  const todays = [...(view.now && view.now.dueDate === view.date ? [view.now] : []), ...open];
  const planned = open.length + (view.now ? 1 : 0);
  const timed = todays.filter((task) => task.dueTime).length;
  const repeating = todays.filter((task) => task.repeat || task.rrule).length;
  const overdue = view.overdue.filter((task) => !task.isNow).length;
  const day = planned ? t("summary.planned", { count: planned }) : t("summary.nothing");
  return [
    seg(`${greeting(now, timezone)} ${day}`),
    ...(timed ? [seg(t("summary.timed", { count: timed }))] : []),
    ...(repeating ? [seg(t("summary.repeating", { count: repeating }))] : []),
    ...(overdue ? [seg(t("summary.overdue", { count: overdue }), { color: "red" })] : []),
    ...(health ? healthExtras(health) : []),
  ];
}

/** Parts flowed into at most `lines` rows of `width`, " · " between them; the last row is cut with "…". */
export function flow(parts: Seg[], width: number, lines: number): Row[] {
  const rows: Row[] = [[seg(" ")]];
  for (const [i, part] of parts.entries()) {
    const row = rows[rows.length - 1]!;
    const gap = i === 0 ? [] : [seg(i === 1 ? "  " : " · ", { dim: true })];
    if (i > 0 && rowWidth(row) + rowWidth(gap) + widthOf(part.text) > width && rows.length < lines) rows.push([seg(" "), part]);
    else row.push(...gap, part);
  }
  return rows.map((row) => fitRow(row, width));
}
