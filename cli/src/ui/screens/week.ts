// The week, Monday to Sunday, always as seven columns of bars, one per task,
// in the status colours (red overdue, yellow doing, green done). Columns 10 or
// more wide carry the time and title on the bar; narrower ones show bars only,
// as the phone does, and the selected day's tasks are listed in full below.
import { formatDay } from "../../render/format.js";
import type { Task } from "../../render/model.js";
import type { Day } from "../lists.js";
import { refWidthOf, taskRow } from "../rows.js";
import { columns, cut, fitRow, seg, toHeight, windowStart, type Color, type Row } from "../text.js";
import { hitRow, type Hit, type Screen } from "./screen.js";

const TITLED = 10;

export function barColor(task: Task, today: string): Color {
  if (task.status === "done") return "green";
  if (task.dueDate && task.dueDate < today) return "red";
  return task.status === "doing" ? "yellow" : "blue";
}

function dayHeading(day: Day, width: number, focused: boolean): Row {
  const [weekday, dayOfMonth] = formatDay(day.date).split(" ");
  const label = width >= 6 ? `${weekday} ${dayOfMonth}` : `${weekday!.slice(0, 1)} ${dayOfMonth}`;
  return fitRow([seg(cut(label, width), { bold: day.isToday || focused, color: day.isToday ? "cyan" : undefined, underline: day.isToday })], width).map((s) =>
    focused ? { ...s, inverse: true } : s,
  );
}

function bar(task: Task, width: number, today: string, selected: boolean): Row {
  const color = barColor(task, today);
  const done = task.status === "done";
  if (width < TITLED) {
    const blocks = selected ? `▶${"█".repeat(Math.max(0, width - 1))}` : "█".repeat(width);
    return [seg(blocks, { color, dim: done && !selected })];
  }
  const text = [task.dueTime, task.title].filter(Boolean).join(" ");
  const row = fitRow([seg("▌", { color }), seg(text, { dim: done, strike: done })], width);
  return selected ? row.map((s) => ({ ...s, inverse: true })) : row;
}

function dayColumn(day: Day, index: number, focus: number, row: number, today: string, width: number, height: number, x0: number) {
  const focused = index === focus;
  const rows: Row[] = [dayHeading(day, width, focused)];
  const hits: Hit[] = [hitRow(0, width, { kind: "day", day: index }, x0)];
  const room = height - 1;
  const start = focused ? windowStart(day.tasks.length, row, room) : 0;
  const more = day.tasks.length - start > room ? day.tasks.length - start - room + 1 : 0;
  const shown = day.tasks.slice(start, start + room - (more ? 1 : 0));
  shown.forEach((task, i) => {
    rows.push(bar(task, width, today, focused && start + i === row));
    hits.push(hitRow(rows.length - 1, width, { kind: "task", day: index, index: start + i }, x0));
  });
  if (more) rows.push([seg(cut(`+${more}`, width), { dim: true })]);
  return { rows, hits };
}

function dayPanel(day: Day, dayIndex: number, row: number, today: string, width: number, height: number): Screen {
  const count = day.tasks.length;
  const heading: Row = [seg(formatDay(day.date), { bold: true }), seg(day.isToday ? " · today" : "", { color: "cyan" }), seg(` · ${count} ${count === 1 ? "task" : "tasks"}`, { dim: true })];
  if (count === 0) return { rows: toHeight([heading, [seg("  (nothing on this day; a adds a task here)", { dim: true })]], height), hits: [] };
  const start = windowStart(count, row, height - 1);
  const refWidth = refWidthOf(day.tasks);
  const shown = day.tasks.slice(start, start + height - 1);
  const rows = [heading, ...shown.map((task, i) => taskRow(task, { width, today, selected: start + i === row, refWidth, due: "time" }))];
  const hits = shown.map((_, i) => hitRow(i + 1, width, { kind: "task", day: dayIndex, index: start + i }));
  return { rows: toHeight(rows, height), hits };
}

export function weekScreen(days: Day[], focus: number, row: number, today: string, width: number, height: number): Screen {
  const colWidth = Math.max(3, Math.floor((width - 6) / 7));
  const panel = height >= 10 ? Math.max(3, Math.floor(height * 0.4)) : 0;
  const barsHeight = height - (panel ? panel + 1 : 0);
  const blocks = days.map((day, i) => dayColumn(day, i, focus, row, today, colWidth, barsHeight, i * (colWidth + 1)));
  const grid = columns(blocks.map((b) => ({ rows: b.rows, width: colWidth })), barsHeight, [seg("│", { dim: true })]);
  const hits = blocks.flatMap((b) => b.hits);
  if (!panel) return { rows: grid, hits };
  const details = dayPanel(days[focus]!, focus, row, today, width, panel);
  return {
    rows: [...grid, [seg("─".repeat(width), { dim: true })], ...details.rows],
    hits: [...hits, ...details.hits.map((h) => ({ ...h, y: h.y + barsHeight + 1 }))],
  };
}
