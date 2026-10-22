// Small text formatters shared by the human and plain renderers. English only in v1.
import { addDays, daysBetween, yearOf } from "../when/calendar.js";
import type { Repeat, Task } from "./model.js";
import { PLAIN_STYLE, type Style } from "./style.js";
import { cellOf, type Cell } from "./table.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ISO_WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-22" → "Thu 22 Oct 2026". */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const day = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[day.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * A due day as people say it: "today", "tomorrow", "yesterday"; other days
 * as "Fri 23 Oct" (with the year when it is not this year's). Without a
 * known today, the date itself.
 */
export function relativeDate(date: string, today?: string): string {
  if (!today) return date;
  const days = daysBetween(today, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const text = formatDay(date);
  return yearOf(date) === yearOf(today) ? text.slice(0, text.lastIndexOf(" ")) : text;
}

/** Unix ms → "2026-10-22 14:05" in the user's time zone (UTC when unknown, marked as such). */
export function formatTimestamp(ms: number, timezone?: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const text = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  return timezone ? text : `${text} UTC`;
}

export function describeRepeat(repeat: Repeat): string {
  const unit = repeat.interval === 1 ? repeat.every : `${repeat.interval} ${repeat.every}s`;
  const days = repeat.weekdays?.length ? ` on ${repeat.weekdays.map((d) => ISO_WEEKDAYS[d] ?? d).join(", ")}` : "";
  return `every ${unit}${days}`;
}

export const refOf = (task: Task) => (task.ref !== undefined ? `#${task.ref}` : task.id);

const BOXES: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]" };

export type TaskRowOptions = { style?: Style; today?: string; timeOnly?: boolean };

/** The due cell: "today 14:00", "Fri 23 Oct", or only "14:00" inside the Today section. */
export function dueCell(task: Task, { style = PLAIN_STYLE, today, timeOnly }: TaskRowOptions): Cell {
  if (!task.dueDate) return cellOf("");
  const day = timeOnly ? "" : relativeDate(task.dueDate, today);
  const text = [day, task.dueTime].filter(Boolean).join(" ");
  if (task.status === "done") return cellOf(text, style.dim);
  if (task.overdue || (today && task.dueDate < today)) return cellOf(text, style.red);
  if (today && (task.dueDate === today || task.dueDate === addDays(today, 1))) return cellOf(text, style.yellow);
  return cellOf(text);
}

/** One task as table cells: ref, box, due, title, labels and markers. */
export function taskCells(task: Task, options: TaskRowOptions = {}): Cell[] {
  const style = options.style ?? PLAIN_STYLE;
  const done = task.status === "done";
  const box = BOXES[task.status] ?? "[?]";
  const marks = [
    task.isNow ? style.green("now") : "",
    task.repeat ? "↻" : "",
    task.overdue ? style.red("overdue") : "",
  ].filter(Boolean);
  const labels = task.labels.map((l) => style.magenta(`#${l}`));
  return [
    cellOf(refOf(task), style.cyan),
    cellOf(box, task.status === "doing" ? style.yellow : done ? style.green : undefined),
    dueCell(task, options),
    cellOf(task.title, done ? style.dim : task.isNow ? style.bold : undefined),
    // Already painted per part; widths are measured without the color codes.
    cellOf([...labels, ...marks].join(" ")),
  ];
}

/** --fields in the human format: the chosen fields as cells. */
export const fieldCells = (task: Task, fields: string[]): Cell[] => fields.map((f) => cellOf(cell(task[f])));

const DEFAULT_COLUMNS = ["ref", "status", "dueDate", "dueTime", "title", "labels"];

/** One task as tab-separated values: default columns, or the --fields. */
export function taskRow(task: Task, fields?: string[]): string[] {
  return (fields ?? DEFAULT_COLUMNS).map((f) => cell(task[f]));
}

/** A value as one TSV-safe cell: arrays joined by commas, objects as JSON, nothing as "". */
export function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(",");
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/[\t\r\n]+/g, " ");
}

export const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");
