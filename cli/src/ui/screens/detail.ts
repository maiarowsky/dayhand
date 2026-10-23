// Task details: every field, the checklist, the note, and the history newest
// first with who made each change (app, cli or agent: <name>), because agents
// change the plan too and the person needs to see which one did what.
import { describeReminder, describeRepeat, formatTimestamp, relativeDate } from "../../render/format.js";
import type { Detail, HistoryEntry } from "../../render/model.js";
import { ICONS, refText } from "../rows.js";
import { cut, seg, toHeight, type Color, type Row } from "../text.js";
import type { Screen } from "./screen.js";

const ACTIONS: Record<string, string> = {
  create: "added",
  update: "changed",
  complete: "done",
  repeat: "next occurrence",
  setStatus: "status",
  setNow: "now",
  archive: "archived",
  delete: "to the trash",
  restore: "restored",
};

export const actorColor = (actor: string): Color => (actor === "agent" ? "magenta" : actor === "cli" ? "cyan" : "blue");

/** "agent: claude-code" with the actor's colour. */
export const actorSeg = (entry: Pick<HistoryEntry, "actor" | "by">) => seg(entry.by, { color: actorColor(entry.actor), bold: entry.actor === "agent" });

/** A changed value as text; the *At fields (Unix ms) as times in the user's zone. */
function value(key: string, v: unknown, timezone: string | undefined): string {
  if (v === undefined || v === null) return "none";
  if (key.endsWith("At") && typeof v === "number") return formatTimestamp(v, timezone);
  return JSON.stringify(v);
}

/** "title: "a" → "b"; dueDate: none → "2026-10-30"" (only the changed fields). */
export function describeChange(entry: HistoryEntry, timezone?: string): string {
  const after = entry.after;
  if (!after || entry.action === "create") return "";
  return Object.keys(after)
    .filter((k) => k !== "updatedAt")
    .map((k) => (entry.before && k in entry.before ? `${k}: ${value(k, entry.before[k], timezone)} → ${value(k, after[k], timezone)}` : `${k}: ${value(k, after[k], timezone)}`))
    .join("; ");
}

function field(label: string, text: string | undefined, style: Parameters<typeof seg>[1] = {}): Row[] {
  return text ? [[seg(label.padEnd(10), { dim: true }), seg(text, style)]] : [];
}

/** All rows of the details, before scrolling. */
export function detailRows(detail: Detail, today: string, timezone: string | undefined, width: number): Row[] {
  const { task, history } = detail;
  const due = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const relative = task.dueDate ? relativeDate(task.dueDate, today) : undefined;
  const last = history.at(-1);
  const first = history[0];
  const rows: Row[] = [
    [seg(refText(task), { color: "cyan" }), seg(" "), seg(ICONS[task.status]), seg(" "), seg(task.title, { bold: true })],
    [],
    ...field("status", task.status + (task.isNow ? " (now)" : "") + (task.overdue ? ", overdue" : ""), { color: task.overdue ? "red" : undefined }),
    ...field("due", due ? (relative && relative !== task.dueDate ? `${due} (${relative})` : due) : "no day"),
    ...field("repeat", task.repeat ? describeRepeat(task.repeat) : task.rrule),
    ...field("remind", task.reminders ? (task.reminders.length ? task.reminders.map(describeReminder).join(", ") : "none") : undefined),
    ...field("labels", task.labels.map((l) => `#${l}`).join(" "), { color: "magenta" }),
    ...task.links.flatMap((l, i) => field(i ? "" : "links", l.title ? `${l.title} <${l.url}>` : l.url)),
    ...field("next", task.resumeNote, { color: "green" }),
    ...field("deleted", task.deletedAt ? formatTimestamp(task.deletedAt, timezone) : undefined),
    ...field("archived", task.archivedAt ? formatTimestamp(task.archivedAt, timezone) : undefined),
  ];
  if (last) rows.push([seg("changed".padEnd(10), { dim: true }), actorSeg(last), seg(`  ${formatTimestamp(last.at, timezone)}`, { dim: true })]);
  if (first && first.action === "create") rows.push([seg("added by".padEnd(10), { dim: true }), actorSeg(first), seg(`  ${formatTimestamp(first.at, timezone)}`, { dim: true })]);
  if (task.checklist?.length) {
    const done = task.checklist.filter((i) => i.done).length;
    rows.push([], [seg(`checklist ${done}/${task.checklist.length}`, { bold: true })]);
    rows.push(...task.checklist.map((item, i) => [seg(`  ${i + 1}. `), seg(item.done ? "[x] " : "[ ] ", { color: item.done ? "green" : undefined }), seg(item.title, { dim: item.done })]));
  }
  if (task.note) rows.push([], [seg("note", { bold: true })], ...wrap(task.note, width - 2).map((l) => [seg(`  ${l}`)]));
  rows.push([], [seg(`history (${history.length}, newest first)`, { bold: true })]);
  const byWidth = Math.min(28, Math.max(3, ...history.map((h) => h.by.length)));
  for (const entry of [...history].reverse()) {
    const change = describeChange(entry, timezone);
    rows.push([
      seg(`  ${formatTimestamp(entry.at, timezone)}  `, { dim: true }),
      { ...actorSeg(entry), text: cut(entry.by, byWidth).padEnd(byWidth) },
      seg(`  ${ACTIONS[entry.action] ?? entry.action}`),
      seg(change ? `  ${change}` : "", { dim: true }),
    ]);
  }
  return rows;
}

/** The note's lines, wrapped at spaces to `width`. */
export function wrap(text: string, width: number): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const out: string[] = [];
    let current = "";
    for (const word of paragraph.split(" ")) {
      if (current && (current + " " + word).length > width) {
        out.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    out.push(current);
    return out;
  });
}

/** The details scrolled to `scroll` (clamped so the last row stays at the bottom). */
export function detailScreen(detail: Detail | undefined, scroll: number, today: string, timezone: string | undefined, width: number, height: number): Screen & { scroll: number } {
  if (!detail) return { rows: toHeight([[seg("  Loading the task…", { dim: true })]], height), hits: [], scroll: 0 };
  const rows = detailRows(detail, today, timezone, width);
  const top = Math.max(0, Math.min(scroll, rows.length - height));
  return { rows: toHeight(rows.slice(top, top + height), height), hits: [], scroll: top };
}
