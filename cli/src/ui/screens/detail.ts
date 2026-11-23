// Task details: every field, the checklist, the note, and the history newest
// first with who made each change (app, cli or agent: <name>), because agents
// change the plan too and the person needs to see which one did what.
import { dayText, relativeDay, reminderText, repeatText } from "../../i18n/dates.js";
import { getLanguage, t, type Key } from "../../i18n/index.js";
import { formatTimestamp } from "../../render/format.js";
import type { Detail, HistoryEntry, Reminder, Repeat } from "../../render/model.js";
import type { Project } from "../../projects.js";
import { ICONS, refText } from "../rows.js";
import type { WorkTask } from "../agents.js";
import { daysBetween } from "../../when/calendar.js";
import { cut, padTo, seg, toHeight, widthOf, type Color, type Row } from "../text.js";
import type { Screen } from "./screen.js";

const ACTIONS = ["create", "update", "complete", "repeat", "setStatus", "setNow", "archive", "delete", "restore"];

/** A history entry's action in words ("added"); one Dayhand does not know as it is. */
const actionText = (action: string) => (ACTIONS.includes(action) ? t(`action.${action}` as Key) : action);

export const actorColor = (actor: string): Color => (actor === "agent" ? "magenta" : actor === "cli" ? "cyan" : "blue");

/** "agent: claude-code" with the actor's colour. */
export const actorSeg = (entry: Pick<HistoryEntry, "actor" | "by">) => seg(entry.by, { color: actorColor(entry.actor), bold: entry.actor === "agent" });

/** The fields a history entry shows, by their names in the catalog as the Mac app's history names them; others and timestamps are left out. */
const FIELD_NAMES: Record<string, Key> = {
  title: "change.title",
  status: "detail.status",
  isNow: "change.isNow",
  dueDate: "change.dueDate",
  dueTime: "change.dueTime",
  repeat: "change.repeat",
  links: "detail.links",
  checklist: "change.checklist",
  reminders: "change.reminders",
  note: "change.note",
  resumeNote: "change.resumeNote",
  acceptance: "detail.criteria",
  plan: "detail.plan",
  proof: "detail.proof",
  dependsOn: "detail.dependsOn",
  blockedReason: "detail.blocked",
  claimedBy: "detail.claimedBy",
  projectId: "change.project",
};

function fieldName(key: string): string {
  const text = t(FIELD_NAMES[key]!);
  return text.charAt(0).toLocaleUpperCase(getLanguage()) + text.slice(1);
}

type LinkValue = { url: string; title?: string };
const linkText = (link: LinkValue) => link.title || link.url;
const mark = (done: boolean | undefined, text: string) => `${done ? "[x]" : "[ ]"} ${text}`;

/** A changed value as text: days as in the heading, a project or claim by its name, lists as their items; text fields quoted. */
function value(key: string, v: unknown, projects: Project[]): string {
  if (v === undefined || v === null) return t("detail.none");
  return valueText(key, v, projects) || t("detail.none");
}

function valueText(key: string, v: unknown, projects: Project[]): string {
  switch (key) {
    case "projectId":
      return projects.find((p) => p.id === v)!.name;
    case "isNow":
      return t(v ? "change.yes" : "change.no");
    case "status":
      return v === "todo" || v === "doing" || v === "done" ? t(`status.${v}`) : String(v);
    case "dueDate":
      return dayText(String(v));
    case "dueTime":
      return String(v);
    case "repeat":
      return repeatText(v as Repeat);
    case "claimedBy":
      return (v as { name: string }).name;
    case "proof": {
      const proof = v as { summary?: string; links?: LinkValue[]; checks?: { name: string }[] };
      return proof.summary || [...(proof.links ?? []).map(linkText), ...(proof.checks ?? []).map((check) => check.name)].join(", ");
    }
    case "links":
      return (v as LinkValue[]).map(linkText).join(", ");
    case "checklist":
      return (v as { title: string; done?: boolean }[]).map((item) => mark(item.done, item.title)).join(", ");
    case "acceptance":
      return (v as { text: string; met?: boolean }[]).map((item) => mark(item.met, item.text)).join(", ");
    case "reminders":
      return (v as Reminder[]).map(reminderText).join(", ");
    case "dependsOn":
      return String((v as unknown[]).length);
    default:
      return JSON.stringify(v);
  }
}

/** "Title: "a" → "b"; Day: none → Fri 30 Oct 2026" (only the changed fields the catalog names; a project only when it is known). */
export function describeChange(entry: HistoryEntry, projects: Project[] = []): string {
  const { after, before } = entry;
  if (!after || entry.action === "create") return "";
  const known = (v: unknown) => v === undefined || v === null || projects.some((p) => p.id === v);
  return Object.keys(after)
    .filter((k) => k in FIELD_NAMES && (k !== "projectId" || (known(after[k]) && known(before?.[k]))))
    .map((k) => (before && k in before ? `${fieldName(k)}: ${value(k, before[k], projects)} → ${value(k, after[k], projects)}` : `${fieldName(k)}: ${value(k, after[k], projects)}`))
    .join("; ");
}

const LABEL_WIDTH = 10;

type Style = Parameters<typeof seg>[1];
/** A labelled field: its values (one per line, wrapped), or a row of its own segments. */
type Field = { label: string; values: string[]; style?: Style } | { label: string; row: Row };

/** The fields as rows, every value starting in the same column: after the longest label shown. */
function fieldRows(fields: Field[], width: number): Row[] {
  const indent = Math.min(Math.max(LABEL_WIDTH, ...fields.map((f) => widthOf(f.label) + 2)), Math.floor(width / 2));
  const label = (text: string) => seg(padTo(text, indent), { dim: true });
  return fields.flatMap((f) =>
    "row" in f ? [[label(f.label), ...f.row]] : f.values.flatMap((text) => wrap(text, width - indent)).map((text, i) => [label(i === 0 ? f.label : ""), seg(text, f.style)]),
  );
}

const field = (label: string, text: string | undefined, style: Style = {}): Field[] => (text ? [{ label, values: [text], style }] : []);

/** Agent-work fields that have something to show: who claimed it, criteria, plan, proof, what it waits on or why it is blocked. */
function workFields(task: WorkTask, timezone: string | undefined, now: number): Field[] {
  const fields: Field[] = [];
  const add = (key: Key, values: string[], color?: Color) => {
    if (values.length) fields.push({ label: t(key), values, style: { color } });
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
  add("detail.blocked", task.blockedReason ? [task.blockedReason] : [], "red");
  return fields;
}

/** "Sun, 22 Nov 2026 14:00 (today)": the day as the heading shows it, and today, tomorrow or yesterday when it is one. */
function dueText(task: Detail["task"], today: string): string {
  if (!task.dueDate) return t("day.none");
  const due = [dayText(task.dueDate), task.dueTime].filter(Boolean).join(" ");
  return Math.abs(daysBetween(today, task.dueDate)) <= 1 ? `${due} (${relativeDay(task.dueDate, today)})` : due;
}

/** All rows of the details, before scrolling. */
export function detailRows(detail: Detail, today: string, timezone: string | undefined, width: number, now = Date.now(), projects: Project[] = []): Row[] {
  const { task, history } = detail;
  const last = history.at(-1);
  const first = history[0];
  const fields: Field[] = [
    ...field(t("detail.status"), t(`status.${task.status}`) + (task.isNow ? t("detail.now") : "") + (task.overdue ? t("detail.overdue") : ""), { color: task.overdue ? "red" : undefined }),
    ...field(t("detail.due"), dueText(task, today)),
    ...field(t("detail.repeat"), task.repeat ? repeatText(task.repeat) : task.rrule),
    ...field(t("detail.remind"), task.reminders ? (task.reminders.length ? task.reminders.map(reminderText).join(", ") : t("detail.none")) : undefined),
    ...task.links.flatMap((l, i) => field(i ? "" : t("detail.links"), l.title ? `${l.title} <${l.url}>` : l.url)),
    ...field(t("detail.next"), task.resumeNote, { color: "green" }),
    ...field(t("detail.deleted"), task.deletedAt ? formatTimestamp(task.deletedAt, timezone) : undefined),
    ...field(t("detail.archived"), task.archivedAt ? formatTimestamp(task.archivedAt, timezone) : undefined),
    ...(last ? [{ label: t("detail.changed"), row: [actorSeg(last), seg(`  ${formatTimestamp(last.at, timezone)}`, { dim: true })] }] : []),
    ...(first && first.action === "create" ? [{ label: t("detail.addedBy"), row: [actorSeg(first), seg(`  ${formatTimestamp(first.at, timezone)}`, { dim: true })] }] : []),
    ...workFields(task as WorkTask, timezone, now),
  ];
  const rows: Row[] = [[seg(refText(task), { color: "cyan" }), seg(" "), seg(ICONS[task.status]), seg(" "), seg(task.title, { bold: true })], [], ...fieldRows(fields, width)];
  if (task.checklist?.length) {
    const done = task.checklist.filter((i) => i.done).length;
    rows.push([], [seg(t("detail.checklist", { done, total: task.checklist.length }), { bold: true })]);
    rows.push(...task.checklist.map((item, i) => [seg(`  ${i + 1}. `), seg(item.done ? "[x] " : "[ ] ", { color: item.done ? "green" : undefined }), seg(item.title, { dim: item.done })]));
  }
  if (task.note) rows.push([], [seg(t("detail.note"), { bold: true })], ...wrap(task.note, width - 2).map((l) => [seg(`  ${l}`)]));
  rows.push([], [seg(t("detail.history", { count: history.length }), { bold: true })]);
  const byWidth = Math.min(28, Math.max(3, ...history.map((h) => h.by.length)));
  for (const entry of [...history].reverse()) {
    const change = describeChange(entry, projects);
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
export function detailScreen(detail: Detail | undefined, scroll: number, today: string, timezone: string | undefined, width: number, height: number, now = Date.now(), projects: Project[] = []): Screen & { scroll: number } {
  if (!detail) return { rows: toHeight([[seg(`  ${t("detail.loading")}`, { dim: true })]], height), hits: [], scroll: 0 };
  const rows = detailRows(detail, today, timezone, width, now, projects);
  const top = Math.max(0, Math.min(scroll, rows.length - height));
  return { rows: toHeight(rows.slice(top, top + height), height), hits: [], scroll: top };
}
