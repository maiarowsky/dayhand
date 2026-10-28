// Task details: every field, the checklist, the note, and the history newest
// first with who made each change (app, cli or agent: <name>), because agents
// change the plan too and the person needs to see which one did what.
import { relativeDay, reminderText, repeatText } from "../../i18n/dates.js";
import { t, type Key } from "../../i18n/index.js";
import { formatTimestamp } from "../../render/format.js";
import type { Detail, HistoryEntry } from "../../render/model.js";
import { ICONS, refText } from "../rows.js";
import type { WorkTask } from "../agents.js";
import { cut, padTo, seg, toHeight, widthOf, type Color, type Row } from "../text.js";
import type { Screen } from "./screen.js";

const ACTIONS = ["create", "update", "complete", "repeat", "setStatus", "setNow", "archive", "delete", "restore"];

/** A history entry's action in words ("added"); one Dayhand does not know as it is. */
const actionText = (action: string) => (ACTIONS.includes(action) ? t(`action.${action}` as Key) : action);

export const actorColor = (actor: string): Color => (actor === "agent" ? "magenta" : actor === "cli" ? "cyan" : "blue");

/** "agent: claude-code" with the actor's colour. */
export const actorSeg = (entry: Pick<HistoryEntry, "actor" | "by">) => seg(entry.by, { color: actorColor(entry.actor), bold: entry.actor === "agent" });

/** A changed value as text; the *At fields (Unix ms) as times in the user's zone. */
function value(key: string, v: unknown, timezone: string | undefined): string {
  if (v === undefined || v === null) return t("detail.none");
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

const LABEL_WIDTH = 10;

/** A field's label, padded so the values line up (wider when a language's labels are). */
const labelSeg = (label: string) => seg(padTo(label, Math.max(LABEL_WIDTH, widthOf(label) + 2)), { dim: true });

function field(label: string, text: string | undefined, style: Parameters<typeof seg>[1] = {}): Row[] {
  return text ? [[labelSeg(label), seg(text, style)]] : [];
}

/** Agent-work fields, wrapped so plans, criteria and proof are readable in narrow terminals. */
function workRows(task: WorkTask, timezone: string | undefined, width: number, now: number): Row[] {
  const rows: Row[] = [];
  const add = (key: Key, values: string[], color?: Color) => {
    const label = t(key);
    const indent = Math.min(Math.max(LABEL_WIDTH, widthOf(label) + 2), Math.floor(width / 2));
    const lines = (values.length ? values : [t("detail.none")]).flatMap((text) => wrap(text, width - indent));
    rows.push(...lines.map((text, i) => [seg(padTo(i === 0 ? label : "", indent), { dim: true }), seg(text, { color })]));
  };
  const claim = task.claimedBy ? [task.claimedBy.name, task.claimExpiresAt ? t("detail.claimUntil", { time: formatTimestamp(task.claimExpiresAt, timezone) }) : "", task.claimExpiresAt && task.claimExpiresAt <= now ? t("detail.claimExpired") : ""].filter(Boolean).join(" · ") : "";
  add("detail.claimedBy", claim ? [claim] : [], "magenta");
  add("detail.criteria", (task.acceptance ?? []).map((item) => `${item.met ? "[x]" : "[ ]"} ${item.text}`));
  add("detail.plan", task.plan ? [task.plan] : []);
  const proof = task.proof;
  add("detail.proof", proof ? [
    ...(proof.summary ? [proof.summary] : []),
    ...(proof.links ?? []).map((link) => link.title ? `${link.title} <${link.url}>` : link.url),
    ...(proof.checks ?? []).map((check) => `${t(check.result === "pass" ? "proof.pass" : "proof.fail")}: ${check.name}${check.url ? ` <${check.url}>` : ""}`),
  ] : []);
  add("detail.dependsOn", task.dependsOn ?? []);
  add("detail.blocked", task.blockedReason ? [task.blockedReason] : [], task.blockedReason ? "red" : undefined);
  return rows;
}

/** All rows of the details, before scrolling. */
export function detailRows(detail: Detail, today: string, timezone: string | undefined, width: number, now = Date.now()): Row[] {
  const { task, history } = detail;
  const due = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const relative = task.dueDate ? relativeDay(task.dueDate, today) : undefined;
  const last = history.at(-1);
  const first = history[0];
  const rows: Row[] = [
    [seg(refText(task), { color: "cyan" }), seg(" "), seg(ICONS[task.status]), seg(" "), seg(task.title, { bold: true })],
    [],
    ...field(t("detail.status"), t(`status.${task.status}`) + (task.isNow ? t("detail.now") : "") + (task.overdue ? t("detail.overdue") : ""), { color: task.overdue ? "red" : undefined }),
    ...field(t("detail.due"), due ? (relative && relative !== task.dueDate ? `${due} (${relative})` : due) : t("day.none")),
    ...field(t("detail.repeat"), task.repeat ? repeatText(task.repeat) : task.rrule),
    ...field(t("detail.remind"), task.reminders ? (task.reminders.length ? task.reminders.map(reminderText).join(", ") : t("detail.none")) : undefined),
    ...task.links.flatMap((l, i) => field(i ? "" : t("detail.links"), l.title ? `${l.title} <${l.url}>` : l.url)),
    ...field(t("detail.next"), task.resumeNote, { color: "green" }),
    ...field(t("detail.deleted"), task.deletedAt ? formatTimestamp(task.deletedAt, timezone) : undefined),
    ...field(t("detail.archived"), task.archivedAt ? formatTimestamp(task.archivedAt, timezone) : undefined),
  ];
  if (last) rows.push([labelSeg(t("detail.changed")), actorSeg(last), seg(`  ${formatTimestamp(last.at, timezone)}`, { dim: true })]);
  if (first && first.action === "create") rows.push([labelSeg(t("detail.addedBy")), actorSeg(first), seg(`  ${formatTimestamp(first.at, timezone)}`, { dim: true })]);
  if (task.checklist?.length) {
    const done = task.checklist.filter((i) => i.done).length;
    rows.push([], [seg(t("detail.checklist", { done, total: task.checklist.length }), { bold: true })]);
    rows.push(...task.checklist.map((item, i) => [seg(`  ${i + 1}. `), seg(item.done ? "[x] " : "[ ] ", { color: item.done ? "green" : undefined }), seg(item.title, { dim: item.done })]));
  }
  if (task.note) rows.push([], [seg(t("detail.note"), { bold: true })], ...wrap(task.note, width - 2).map((l) => [seg(`  ${l}`)]));
  rows.push([], ...workRows(task as WorkTask, timezone, width, now));
  rows.push([], [seg(t("detail.history", { count: history.length }), { bold: true })]);
  const byWidth = Math.min(28, Math.max(3, ...history.map((h) => h.by.length)));
  for (const entry of [...history].reverse()) {
    const change = describeChange(entry, timezone);
    rows.push([
      seg(`  ${formatTimestamp(entry.at, timezone)}  `, { dim: true }),
      { ...actorSeg(entry), text: cut(entry.by, byWidth).padEnd(byWidth) },
      seg(`  ${actionText(entry.action)}`),
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
      if (current && widthOf(current + " " + word) > width) {
        out.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
      // IDs, URLs and CJK paragraphs need wrapping even without spaces.
      while (widthOf(current) > Math.max(1, width)) {
        let part = "";
        for (const char of current) {
          if (part && widthOf(part + char) > Math.max(1, width)) break;
          part += char;
        }
        out.push(part);
        current = current.slice(part.length);
      }
    }
    out.push(current);
    return out;
  });
}

/** The details scrolled to `scroll` (clamped so the last row stays at the bottom). */
export function detailScreen(detail: Detail | undefined, scroll: number, today: string, timezone: string | undefined, width: number, height: number, now = Date.now()): Screen & { scroll: number } {
  if (!detail) return { rows: toHeight([[seg(`  ${t("detail.loading")}`, { dim: true })]], height), hits: [], scroll: 0 };
  const rows = detailRows(detail, today, timezone, width, now);
  const top = Math.max(0, Math.min(scroll, rows.length - height));
  return { rows: toHeight(rows.slice(top, top + height), height), hits: [], scroll: top };
}
