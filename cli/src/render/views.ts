// Human and plain renderings of a command's result. Every command returns its
// JSON value plus one of these views; --json prints the value and ignores the view.
// The human format is the same on a terminal and in a pipe, except that a
// terminal gets colors (unless turned off) and long titles cut to its width.
import type { HeldCall } from "../transport/client.js";
import { cell, describeRepeat, fieldCells, formatDay, formatTimestamp, refOf, relativeDate, taskCells, taskRow, tsv } from "./format.js";
import type { Connection, Device, HistoryEntry, Task, TodayView } from "./model.js";
import { PLAIN_STYLE, type Style } from "./style.js";
import { cellOf, padTo, table } from "./table.js";

export type Section = { name: string; label: string; tasks: Task[]; count?: boolean; empty?: string };

export type View =
  | { kind: "task"; verb: string; task: Task; next?: Task | null }
  | { kind: "tasks"; verb?: string; tasks: Task[]; empty?: string }
  | { kind: "today"; view: TodayView }
  | { kind: "sections"; heading?: string; sections: Section[]; columns?: boolean }
  | { kind: "detail"; task: Task; history: HistoryEntry[]; timezone?: string }
  | { kind: "pairs"; pairs: [string, unknown][] }
  | { kind: "devices"; devices: Device[]; timezone?: string }
  | { kind: "connections"; connections: Connection[]; timezone?: string }
  | { kind: "text"; text: string }
  | { kind: "json" };

export type RenderOptions = { style: Style; width?: number; today?: string };

const DEFAULTS: RenderOptions = { style: PLAIN_STYLE };

/** The tasks of several groups in one table, so the columns line up across headings. */
type Group = { heading?: string; tasks: Task[]; empty?: string; timeOnly?: boolean };

function grouped(groups: Group[], fields: string[] | undefined, options: RenderOptions): string[] {
  const rows = groups.flatMap((g) =>
    g.tasks.map((t) => (fields ? fieldCells(t, fields) : taskCells(t, { style: options.style, today: options.today, timeOnly: g.timeOnly }))),
  );
  const lines = table(rows, { width: options.width, flex: fields ? undefined : 3 });
  const out: string[] = [];
  let at = 0;
  for (const group of groups) {
    if (group.heading !== undefined) out.push(options.style.bold(group.heading));
    if (group.tasks.length === 0 && group.empty) out.push(options.style.dim(`  (${group.empty})`));
    out.push(...lines.slice(at, at + group.tasks.length));
    at += group.tasks.length;
  }
  return out;
}

export function renderHuman(view: View, value: unknown, fields?: string[], options: RenderOptions = DEFAULTS): string {
  const { style } = options;
  switch (view.kind) {
    case "task": {
      const groups: Group[] = [{ heading: `${view.verb}:`, tasks: [view.task] }];
      if (view.next) groups.push({ heading: "Next occurrence:", tasks: [view.next] });
      return grouped(groups, fields, options).join("\n");
    }
    case "tasks": {
      if (view.tasks.length === 0) return [view.verb && `${view.verb}:`, style.dim(`(${view.empty ?? "no tasks"})`)].filter(Boolean).join("\n");
      return grouped([{ heading: view.verb && `${view.verb}:`, tasks: view.tasks }], fields, options).join("\n");
    }
    case "today":
      return renderToday(view.view, fields, options);
    case "sections":
      if (view.columns && !fields && options.width !== undefined && options.width >= 90) return boardColumns(view.sections, options);
      return [view.heading, ...grouped(view.sections.map(sectionGroup), fields, options)].filter((l) => l !== undefined).join("\n");
    case "detail":
      return renderDetail(view.task, view.history, view.timezone, options);
    case "pairs": {
      const rows = view.pairs.map(([k, v]) => [cellOf(k, style.bold), cellOf(cell(v))]);
      return table(rows, { indent: 0 }).join("\n");
    }
    case "devices":
      return renderDevices(view.devices, view.timezone);
    case "connections":
      return renderConnections(view.connections, view.timezone);
    case "text":
      return view.text;
    case "json":
      return JSON.stringify(value, null, 2);
  }
}

const sectionGroup = (s: Section): Group => ({
  heading: s.count ? `${s.label} (${s.tasks.length})` : s.label,
  tasks: s.tasks,
  empty: s.empty,
});

/** Tab-separated, no headers, no truncation. Multi-section views lead with the section name. */
export function renderPlain(view: View, value: unknown, fields?: string[]): string {
  switch (view.kind) {
    case "task":
      return tsv([taskRow(view.task, fields), ...(view.next ? [taskRow(view.next, fields)] : [])]);
    case "tasks":
      return tsv(view.tasks.map((t) => taskRow(t, fields)));
    case "today": {
      const { now, overdue, today, doneToday } = view.view;
      return tsv([
        ...(now ? [["now", ...taskRow(now, fields)]] : []),
        ...overdue.map((t) => ["overdue", ...taskRow(t, fields)]),
        ...today.map((t) => ["today", ...taskRow(t, fields)]),
        ...doneToday.map((t) => ["done", ...taskRow(t, fields)]),
      ]);
    }
    case "sections":
      return tsv(view.sections.flatMap((s) => s.tasks.map((t) => [s.name, ...taskRow(t, fields)])));
    case "detail":
      return tsv([
        ["task", ...taskRow(view.task, fields)],
        ...view.history.map((h) => ["history", new Date(h.at).toISOString(), h.by, h.action]),
      ]);
    case "pairs":
      return tsv(view.pairs.map(([k, v]) => [k, cell(v)]));
    case "devices":
      return tsv(
        view.devices.map((d) => [
          d.id,
          cell(d.name),
          d.revokedAt ? "revoked" : "active",
          new Date(d.createdAt).toISOString(),
          d.lastUsedAt ? new Date(d.lastUsedAt).toISOString() : "",
        ]),
      );
    case "connections":
      return tsv(
        view.connections.map((c) => [
          c.id,
          cell(c.clientName),
          connectionState(c),
          c.scopes.join(" "),
          new Date(c.createdAt).toISOString(),
          c.lastUsedAt ? new Date(c.lastUsedAt).toISOString() : "",
        ]),
      );
    case "text":
      return view.text;
    case "json":
      return JSON.stringify(value);
  }
}

/** What --dry-run held back: one line per change. */
export function renderDryRun(held: HeldCall[], format: "human" | "plain"): string {
  const lines = held.map((call) =>
    "tool" in call ? [call.tool, JSON.stringify(call.arguments)] : [`POST ${call.endpoint}`, JSON.stringify(call.body)],
  );
  if (format === "plain") return tsv(lines);
  const calls = held.map((call, i) => {
    const line = `  ${lines[i]![0]} ${lines[i]![1]}`;
    const task = "tool" in call ? previewTask(call.result) : undefined;
    return task ? `${line}\n    → ${refOf(task)} ${task.title} (${task.status})` : line;
  });
  return ["Dry run: nothing was changed. Would call:", ...calls].join("\n");
}

/** The task a checked change would give (complete_task returns it as `task`). */
function previewTask(result: Record<string, unknown> | undefined): Task | undefined {
  const task = (result && "task" in result ? result.task : result) as Partial<Task> | undefined;
  return task && typeof task.title === "string" && typeof task.status === "string" ? (task as Task) : undefined;
}

function renderToday(view: TodayView, fields: string[] | undefined, options: RenderOptions): string {
  const { style } = options;
  const lines = [style.bold(`Today, ${formatDay(view.date)}`) + style.dim(` (${view.timezone})`)];
  if (view.now) {
    lines.push(`${style.green("NOW")}  ${style.cyan(refOf(view.now))} ${style.bold(view.now.title)}`);
    if (view.now.resumeNote) lines.push(`     next: ${view.now.resumeNote}`);
  }
  const groups: Group[] = [
    ...(view.overdue.length ? [{ heading: style.red(`OVERDUE (${view.overdue.length})`), tasks: view.overdue }] : []),
    { heading: "TODAY", tasks: view.today, empty: "nothing planned", timeOnly: true },
    ...(view.doneToday.length ? [{ heading: `DONE (${view.doneToday.length})`, tasks: view.doneToday, timeOnly: true }] : []),
  ];
  lines.push(...grouped(groups, fields, { ...options, today: view.date }));
  return lines.join("\n");
}

/** The board as three columns side by side (wide terminals only). */
function boardColumns(sections: Section[], options: RenderOptions): string {
  const gap = 3;
  const width = Math.floor((options.width! - gap * (sections.length - 1)) / sections.length);
  const withDue = width >= 40;
  const columns = sections.map((s) => {
    const heading = options.style.bold(`${s.label} (${s.tasks.length})`);
    if (s.tasks.length === 0) return [heading, options.style.dim(`(${s.empty ?? "empty"})`)];
    const rows = s.tasks.map((t) => {
      const [ref, , due, title] = taskCells(t, { style: options.style, today: options.today });
      return withDue ? [ref!, title!, due!] : [ref!, title!];
    });
    return [heading, ...table(rows, { width, flex: 1, indent: 0, gap: 1, minFlex: 6 })];
  });
  const height = Math.max(...columns.map((c) => c.length));
  return Array.from({ length: height }, (_, i) =>
    columns
      .map((c, index) => (index === columns.length - 1 ? (c[i] ?? "") : padTo(c[i] ?? "", width)))
      .join(" ".repeat(gap))
      .trimEnd(),
  ).join("\n");
}

function renderDetail(task: Task, history: HistoryEntry[], timezone: string | undefined, options: RenderOptions): string {
  const { style } = options;
  const lines = [`${style.cyan(refOf(task))} ${style.bold(task.title)}`];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push(`${style.dim(label.padEnd(9))}${value}`);
  };
  add("status", task.status + (task.isNow ? " (now)" : "") + (task.overdue ? ", overdue" : ""));
  const due = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const relative = task.dueDate && options.today ? relativeDate(task.dueDate, options.today) : undefined;
  add("due", due ? (relative && relative !== task.dueDate ? `${due} (${relative})` : due) : "no date");
  add("repeat", task.repeat ? describeRepeat(task.repeat) : undefined);
  add("labels", task.labels.join(", "));
  add("links", task.links.map((l) => (l.title ? `${l.title} <${l.url}>` : l.url)).join(", "));
  add("next", task.resumeNote);
  add("archived", task.archivedAt ? formatTimestamp(task.archivedAt, timezone) : undefined);
  add("deleted", task.deletedAt ? formatTimestamp(task.deletedAt, timezone) : undefined);
  add("id", task.id);
  if (task.note) lines.push(style.dim("note:"), ...task.note.split("\n").map((l) => `  ${l}`));
  lines.push(style.dim("history:"));
  for (const h of history) {
    const change = h.after ? `  ${describeChange(h.before, h.after)}` : "";
    lines.push(`  ${formatTimestamp(h.at, timezone)}  ${h.by}  ${h.action}${change}`);
  }
  return lines.join("\n");
}

function describeChange(before: Record<string, unknown> | null, after: Record<string, unknown>): string {
  return Object.keys(after)
    .map((k) => (before && k in before ? `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}` : `${k}: ${JSON.stringify(after[k])}`))
    .join("; ");
}

const connectionState = (c: Connection) => (c.revokedAt ? "revoked" : c.active ? "active" : "expired");

/** Where a connection comes from: the host Helm fetched its metadata from, or that it registered itself. */
const connectionOrigin = (c: Connection) => (c.clientHost ? `from ${c.clientHost}` : `registered itself, returns to ${c.redirectHost}`);

function renderConnections(connections: Connection[], timezone?: string): string {
  if (connections.length === 0) return "(no agent connections)";
  return connections
    .map((c) => {
      const state = c.revokedAt
        ? `revoked ${formatTimestamp(c.revokedAt, timezone)}`
        : !c.active
          ? `expired ${formatTimestamp(c.expiresAt, timezone)}`
          : c.lastUsedAt
            ? `last used ${formatTimestamp(c.lastUsedAt, timezone)}`
            : "never used";
      const access = c.scopes.includes("tasks:write") ? "read and change" : "read only";
      return `  ${c.clientName} (${connectionOrigin(c)})  ${access}, connected ${formatTimestamp(c.createdAt, timezone)}, ${state} (${c.id})`;
    })
    .join("\n");
}

function renderDevices(devices: Device[], timezone?: string): string {
  if (devices.length === 0) return "(no paired devices)";
  return devices
    .map((d) => {
      const state = d.revokedAt
        ? `revoked ${formatTimestamp(d.revokedAt, timezone)}`
        : d.lastUsedAt
          ? `last used ${formatTimestamp(d.lastUsedAt, timezone)}`
          : "never used";
      return `  ${d.name}  paired ${formatTimestamp(d.createdAt, timezone)} by ${d.pairedBy}, ${state} (${d.id})`;
    })
    .join("\n");
}
