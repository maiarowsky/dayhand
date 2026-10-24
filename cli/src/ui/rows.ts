// One task as a row: cursor mark, number, status icon, due day, title, then
// labels and markers on the right. The parts that do not fit are dropped from
// the right first, so the title keeps its room on narrow terminals.
import { relativeDay } from "../i18n/dates.js";
import type { Task } from "../render/model.js";
import { addDays } from "../when/calendar.js";
import { fitRow, padTo, seg, styled, widthOf, type Color, type Row, type Seg } from "./text.js";

export const ICONS: Record<Task["status"], string> = { todo: "○", doing: "◐", done: "✔" };
const ICON_COLORS: Partial<Record<Task["status"], Color>> = { doing: "yellow", done: "green" };

export const refText = (task: Task) => (task.ref === undefined ? "" : `#${task.ref}`);

export type RowOptions = {
  width: number;
  /** Today in the user's time zone: due days read as today, tomorrow, Fri 23 Oct. */
  today: string;
  selected?: boolean;
  /** Width the numbers are padded to, so titles line up. */
  refWidth?: number;
  /** "day": relative day and time; "time": only the time (Today's sections, a day); "none". */
  due?: "day" | "time" | "none";
  /** Width the due text is padded to, so titles line up across rows. */
  dueWidth?: number;
  /** Extra text on the right (e.g. "deleted 2026-10-20 14:05"). */
  note?: string;
};

export function dueText(task: Task, today: string, mode: "day" | "time"): string {
  if (!task.dueDate) return "";
  return [mode === "day" ? relativeDay(task.dueDate, today) : "", task.dueTime].filter(Boolean).join(" ");
}

export function dueColor(task: Task, today: string): Color | undefined {
  if (task.status === "done" || !task.dueDate) return undefined;
  if (task.overdue || task.dueDate < today) return "red";
  if (task.dueDate === today || task.dueDate === addDays(today, 1)) return "yellow";
  return undefined;
}

/** Labels and markers: #labels, ↻ for a repeat, checklist progress. */
export function markers(task: Task): Seg[] {
  const parts: Seg[] = task.labels.map((l) => seg(`#${l}`, { color: "magenta" }));
  if (task.repeat || task.rrule) parts.push(seg("↻", { color: "cyan" }));
  if (task.checklist?.length) parts.push(seg(`${task.checklist.filter((i) => i.done).length}/${task.checklist.length}`, { dim: true }));
  return parts.flatMap((p, i) => (i ? [seg(" "), p] : [p]));
}

export function taskRow(task: Task, options: RowOptions): Row {
  const { width, today, selected = false } = options;
  const done = task.status === "done";
  const left: Row = [
    seg(selected ? "› " : "  ", { color: "cyan", bold: true }),
    seg(refText(task).padStart(options.refWidth ?? refText(task).length), { color: "cyan" }),
    seg(" "),
    seg(ICONS[task.status], { color: ICON_COLORS[task.status] }),
    seg(" "),
  ];
  const due = options.due === "none" ? "" : dueText(task, today, options.due ?? "day");
  const padded = padTo(due, options.dueWidth ?? 0);
  const dueSeg: Row = padded ? [seg(padded, { color: dueColor(task, today), dim: done }), seg(" ")] : [];
  const title = seg(task.title, { bold: task.isNow && !done, dim: done, strike: done });
  const right: Row = [...markers(task), ...(options.note ? [seg(" "), seg(options.note, { dim: true })] : [])];
  const leftWidth = widthOf(left.map((s) => s.text).join(""));
  const rightWidth = widthOf(right.map((s) => s.text).join(""));
  const dueWidth = widthOf(dueSeg.map((s) => s.text).join(""));
  const room = width - leftWidth;
  // Keep at least 12 columns for the title: drop the right part first, then the due day.
  const showRight = rightWidth > 0 && room - dueWidth - rightWidth - 1 >= 12;
  const showDue = dueWidth > 0 && room - dueWidth >= 12;
  const titleWidth = room - (showDue ? dueWidth : 0) - (showRight ? rightWidth + 1 : 0);
  const row: Row = [
    ...left,
    ...(showDue ? dueSeg : []),
    ...fitRow([title], Math.max(0, titleWidth)),
    ...(showRight ? [seg(" "), ...right] : []),
  ];
  const fitted = fitRow(row, width);
  return selected ? styled(fitted, { inverse: true }) : fitted;
}

/** The widest due text among `tasks`, for lining up titles. */
export const dueWidthOf = (tasks: Task[], today: string, mode: "day" | "time") => Math.max(0, ...tasks.map((t) => widthOf(dueText(t, today, mode))));

/** The widest task number among `tasks`, for lining up titles. */
export const refWidthOf = (tasks: Task[]) => Math.max(0, ...tasks.map((t) => refText(t).length));
