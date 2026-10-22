// Small text formatters shared by the human and plain renderers. English only
// in v1; no colors (batch 2).
import type { Repeat, Task } from "./model.js";

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

/** One task as a line of the human output. */
export function taskLine(task: Task, fields?: string[]): string {
  if (fields) return "  " + fields.map((f) => cell(task[f])).join("  ");
  const when = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const labels = task.labels.map((l) => `#${l}`).join(" ");
  const flags = [task.repeat ? "↻" : "", task.overdue ? "overdue" : ""].filter(Boolean).join(" ");
  return ["  " + refOf(task).padEnd(5), BOXES[task.status] ?? "[?]", when, task.title, labels, flags]
    .filter(Boolean)
    .join(" ");
}

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
