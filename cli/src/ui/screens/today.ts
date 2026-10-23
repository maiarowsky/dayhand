// Today (overdue, the now task with its resume note, today, done today) and
// the trash: sections of task rows in a window that follows the cursor.
import { formatTimestamp } from "../../render/format.js";
import type { Task } from "../../render/model.js";
import type { Section } from "../lists.js";
import { dueWidthOf, refWidthOf, taskRow } from "../rows.js";
import { seg, toHeight, windowStart, type Row } from "../text.js";
import { hitRow, type Hit, type Screen } from "./screen.js";

type Line = { row: Row; index?: number };

const HEADING_COLORS: Partial<Record<Section["key"], "green" | "red">> = { now: "green", overdue: "red" };

/** Rows with the task index each shows; the cursor's row is kept in the window. */
function windowed(lines: Line[], cursor: number, width: number, height: number): Screen {
  const at = Math.max(0, lines.findIndex((l) => l.index === cursor));
  const start = windowStart(lines.length, at, height);
  const shown = lines.slice(start, start + height);
  const hits: Hit[] = shown.flatMap((l, y) => (l.index === undefined ? [] : [hitRow(y, width, { kind: "task", index: l.index })]));
  return { rows: toHeight(shown.map((l) => l.row), height), hits };
}

export function todayScreen(sections: Section[], cursor: number, today: string, width: number, height: number): Screen {
  const refWidth = refWidthOf(sections.flatMap((s) => s.tasks));
  const mode = (key: Section["key"]) => (key === "overdue" || key === "now" ? "day" : "time");
  const dueWidth = Math.max(0, ...sections.map((s) => dueWidthOf(s.tasks, today, mode(s.key))));
  const lines: Line[] = [];
  let index = 0;
  for (const section of sections) {
    if (lines.length) lines.push({ row: [] });
    const count = section.key === "now" ? "" : ` (${section.tasks.length})`;
    lines.push({ row: [seg(`${section.label}${count}`, { bold: true, color: HEADING_COLORS[section.key] })] });
    if (section.tasks.length === 0 && section.empty) lines.push({ row: [seg(`  (${section.empty})`, { dim: true })] });
    for (const task of section.tasks) {
      lines.push({ row: taskRow(task, { width, today, selected: index === cursor, refWidth, due: mode(section.key), dueWidth }), index });
      if (section.key === "now" && task.resumeNote) {
        lines.push({ row: [seg(" ".repeat(refWidth + 5)), seg("next: ", { color: "green" }), seg(task.resumeNote)], index });
      }
      index++;
    }
  }
  return windowed(lines, cursor, width, height);
}

export function trashScreen(tasks: Task[], cursor: number, today: string, timezone: string | undefined, width: number, height: number): Screen {
  if (tasks.length === 0) return { rows: toHeight([[seg("  (the trash is empty)", { dim: true })]], height), hits: [] };
  const refWidth = refWidthOf(tasks);
  const lines: Line[] = tasks.map((task, index) => ({
    row: taskRow(task, {
      width,
      today,
      selected: index === cursor,
      refWidth,
      note: task.deletedAt ? `deleted ${formatTimestamp(task.deletedAt, timezone)}` : undefined,
    }),
    index,
  }));
  return windowed(lines, cursor, width, height);
}

/** A message in the middle of the content area (loading, offline before any data). */
export function messageScreen(lines: Row[], height: number): Screen {
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  return { rows: toHeight([...Array.from({ length: top }, () => []), ...lines], height), hits: [] };
}
