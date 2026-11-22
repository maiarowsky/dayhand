// Today as an agenda: the strip of days and the sentence about the day, then the
// tasks with a column of times and a bar in their status's colour (the now task,
// timed ones by time, those without a time, done today folded), and To plan
// (overdue, without a day, the next days) beside it in a wide terminal or in
// its place (l) in a narrow one. Also the trash, a list of the same rows.
import { t } from "../../i18n/index.js";
import { formatTimestamp } from "../../render/format.js";
import type { Task, TodayView } from "../../render/model.js";
import type { Health } from "../agents.js";
import { PLAN_DAYS } from "../api.js";
import { openPerDay, type PlanData, type Section } from "../lists.js";
import type { TodayParts } from "../model.js";
import { dueWidthOf, refWidthOf, taskRow } from "../rows.js";
import { fitRow, seg, toHeight, widthOf, windowStart, type Color, type Row, type Seg } from "../text.js";
import { dayStrip, flow, STRIP_MIN_HEIGHT, summaryParts } from "./days.js";
import { hitRow, offsetHits, type Hit, type Screen } from "./screen.js";

type Line = { row: Row; index?: number };

const BAR = "▌";
const BAR_COLORS: Record<Task["status"], Color> = { todo: "blue", doing: "yellow", done: "green" };
const SEPARATOR = " │ ";
const PLAN_SHARE = 0.36;
const PLAN_MIN = 40;
const PLAN_MAX = 60;

/** Rows with the task index each shows; the cursor's row is kept in the window. */
function windowed(lines: Line[], cursor: number, width: number, height: number): Screen {
  const at = Math.max(0, lines.findIndex((l) => l.index === cursor));
  const start = windowStart(lines.length, at, height);
  const shown = lines.slice(start, start + height);
  const hits: Hit[] = shown.flatMap((l, y) => (l.index === undefined ? [] : [hitRow(y, width, { kind: "task", index: l.index })]));
  return { rows: toHeight(shown.map((l) => l.row), height), hits };
}

export type TodayInput = {
  view: TodayView;
  parts: TodayParts;
  plan?: PlanData;
  health?: Health;
  filter: string;
  cursor: number;
  now: number;
  timezone: string;
};

export function todayScreen(input: TodayInput, width: number, height: number): Screen {
  const { parts, cursor } = input;
  if (!parts.beside) {
    const head = header(input, width, height);
    const body = parts.showsPlan ? planLines(input, 0, width) : agendaLines(input, width);
    const window = windowed(body, cursor, width, height - head.length);
    return { rows: [...head, ...window.rows], hits: offsetHits(window.hits, head.length) };
  }
  const planWidth = Math.min(PLAN_MAX, Math.max(PLAN_MIN, Math.round(width * PLAN_SHARE)));
  const agendaWidth = width - planWidth - SEPARATOR.length;
  const head = header(input, agendaWidth, height);
  const agenda = agendaLines(input, agendaWidth);
  const split = agenda.reduce((n, l) => Math.max(n, (l.index ?? -1) + 1), 0);
  const left = windowed(agenda, cursor < split ? cursor : -1, agendaWidth, height - head.length);
  const right = windowed(planLines(input, split, planWidth), cursor >= split ? cursor : -1, planWidth, height);
  const leftRows = [...head, ...left.rows];
  const rows = right.rows.map((row, y) => [...fitRow(leftRows[y] ?? [], agendaWidth), seg(SEPARATOR, { dim: true }), ...fitRow(row, planWidth)]);
  return { rows, hits: [...offsetHits(left.hits, head.length), ...offsetHits(right.hits, 0, agendaWidth + SEPARATOR.length)] };
}

function header(input: TodayInput, width: number, height: number): Row[] {
  const { view, plan } = input;
  const perDay = plan && plan.date === view.date ? openPerDay(plan.upcoming, view.date, PLAN_DAYS) : [];
  const strip = height >= STRIP_MIN_HEIGHT ? dayStrip(view.date, perDay, width) : [];
  const summary = flow(summaryParts(view, input.health, input.now, input.timezone), width, height >= STRIP_MIN_HEIGHT ? 2 : 1);
  return [...strip, ...summary, []];
}

function agendaLines(input: TodayInput, width: number): Line[] {
  const { view, cursor } = input;
  const today = view.date;
  const sections = input.parts.agenda;
  const all = sections.flatMap((s) => s.tasks);
  const refWidth = refWidthOf(all);
  const timeWidth = Math.max(5, sections.some((s) => s.key === "now") ? widthOf(t("section.now")) : 0);
  const dayMode = (s: Section, task: Task) => s.key === "overdue" || (s.key === "now" && task.dueDate !== today);
  const dueWidth = dueWidthOf(sections.flatMap((s) => s.tasks.filter((task) => dayMode(s, task))), today, "day");
  const indent = " ".repeat(2 + timeWidth + 3);
  const lines: Line[] = [];
  const gap = () => {
    if (lines.length > 0 && lines[lines.length - 1]!.row.length > 0) lines.push({ row: [] });
  };
  let index = 0;
  const gutter = (time: Row, task: Task, overdue: boolean): Row => [
    ...time,
    seg(" "),
    seg(BAR, { color: overdue && task.status !== "done" ? "red" : BAR_COLORS[task.status] }),
    seg(" "),
  ];
  const timeSeg = (text: string, style: Omit<Seg, "text"> = {}): Row => [seg(" ".repeat(Math.max(0, timeWidth - widthOf(text))) + text, style)];
  for (const section of sections) {
    const overdue = section.key === "overdue";
    if (overdue) lines.push({ row: [seg(indent), seg(`${section.label} (${section.tasks.length})`, { bold: true, color: "red" })] });
    if (section.key === "anyTime" && lines.some((l) => l.index !== undefined)) {
      gap();
      lines.push({ row: [seg(indent), seg(section.label, { bold: true, dim: true })] });
    }
    if (section.key === "done") {
      gap();
      lines.push({ row: [seg(indent), seg(`${section.folded ? "▸" : "▾"} ${section.label} (${section.tasks.length})`, { bold: true, dim: true }), seg("  z", { dim: true })] });
      if (section.folded) continue;
    }
    if (section.tasks.length === 0 && section.empty) lines.push({ row: [seg(indent), seg(`(${section.empty})`, { dim: true })] });
    for (const task of section.tasks) {
      const time = section.key === "now" ? timeSeg(t("section.now"), { bold: true, color: "blue" }) : timeSeg(task.dueTime ?? "", { dim: section.key === "done" });
      const day = dayMode(section, task);
      const row = taskRow(task, { width, today, selected: index === cursor, refWidth, due: day ? "day" : "none", dueWidth: day ? dueWidth : 0, gutter: gutter(time, task, overdue) });
      lines.push({ row, index });
      if (section.key === "now" && task.resumeNote) {
        lines.push({ row: [seg("  "), ...gutter(timeSeg(""), task, false), seg(" ".repeat(refWidth + 3)), seg(t("today.next"), { color: "green" }), seg(task.resumeNote)], index });
      }
      index++;
    }
    if (overdue) gap();
  }
  return lines;
}

function planLines(input: TodayInput, first: number, width: number): Line[] {
  const { view, cursor } = input;
  const sections = input.parts.toPlan;
  const all = sections.flatMap((s) => s.tasks);
  const refWidth = refWidthOf(all);
  const dueWidth = dueWidthOf(all, view.date, "day");
  const lines: Line[] = [{ row: [seg(` ${t("section.toPlan")}`, { bold: true })] }];
  if (all.length === 0) {
    lines.push({ row: [] }, { row: [seg(`  ${input.filter ? t("section.noMatch") : t("plan.empty")}`, { dim: true })] });
    return lines;
  }
  let index = first;
  for (const section of sections) {
    lines.push({ row: [] }, { row: [seg(` ${section.label} (${section.tasks.length})`, { bold: true, color: section.key === "overdue" ? "red" : undefined })] });
    for (const task of section.tasks) {
      lines.push({ row: taskRow(task, { width, today: view.date, selected: index === cursor, refWidth, due: "day", dueWidth }), index });
      index++;
    }
  }
  return lines;
}

export function trashScreen(tasks: Task[], cursor: number, today: string, timezone: string | undefined, width: number, height: number): Screen {
  if (tasks.length === 0) return { rows: toHeight([[seg(`  ${t("trash.empty")}`, { dim: true })]], height), hits: [] };
  const refWidth = refWidthOf(tasks);
  const lines: Line[] = tasks.map((task, index) => ({
    row: taskRow(task, {
      width,
      today,
      selected: index === cursor,
      refWidth,
      note: task.deletedAt ? t("trash.deleted", { time: formatTimestamp(task.deletedAt, timezone) }) : undefined,
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
