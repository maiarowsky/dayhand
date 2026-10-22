// Human and plain renderings of a command's result. Every command returns its
// JSON value plus one of these views; --json prints the value and ignores the view.
import { cell, describeRepeat, formatDay, formatTimestamp, refOf, taskLine, taskRow, tsv } from "./format.js";
import type { Device, HistoryEntry, Task, TodayView } from "./model.js";

export type Section = { name: string; label: string; tasks: Task[]; count?: boolean; empty?: string };

export type View =
  | { kind: "task"; verb: string; task: Task; next?: Task | null }
  | { kind: "tasks"; verb?: string; tasks: Task[]; empty?: string }
  | { kind: "today"; view: TodayView }
  | { kind: "sections"; heading?: string; sections: Section[] }
  | { kind: "detail"; task: Task; history: HistoryEntry[]; timezone?: string }
  | { kind: "pairs"; pairs: [string, unknown][] }
  | { kind: "devices"; devices: Device[]; timezone?: string }
  | { kind: "text"; text: string }
  | { kind: "json" };

export function renderHuman(view: View, value: unknown, fields?: string[]): string {
  switch (view.kind) {
    case "task": {
      const lines = [`${view.verb}:`, taskLine(view.task, fields)];
      if (view.next) lines.push("Next occurrence:", taskLine(view.next, fields));
      return lines.join("\n");
    }
    case "tasks": {
      const lines = view.tasks.length ? view.tasks.map((t) => taskLine(t, fields)) : [`(${view.empty ?? "no tasks"})`];
      return (view.verb ? [`${view.verb}:`, ...lines] : lines).join("\n");
    }
    case "today":
      return renderToday(view.view, fields);
    case "sections":
      return [view.heading, ...view.sections.flatMap((s) => renderSection(s, fields))].filter((l) => l !== undefined).join("\n");
    case "detail":
      return renderDetail(view.task, view.history, view.timezone);
    case "pairs": {
      const width = Math.max(...view.pairs.map(([k]) => k.length));
      return view.pairs.map(([k, v]) => `${k.padEnd(width)}  ${cell(v)}`).join("\n");
    }
    case "devices":
      return renderDevices(view.devices, view.timezone);
    case "text":
      return view.text;
    case "json":
      return JSON.stringify(value, null, 2);
  }
}

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
    case "text":
      return view.text;
    case "json":
      return JSON.stringify(value);
  }
}

function renderSection(section: Section, fields?: string[]): string[] {
  if (section.tasks.length === 0) return section.empty ? [section.label, `  (${section.empty})`] : [];
  const label = section.count ? `${section.label} (${section.tasks.length})` : section.label;
  return [label, ...section.tasks.map((t) => taskLine(t, fields))];
}

function renderToday(view: TodayView, fields?: string[]): string {
  const lines = [`Today, ${formatDay(view.date)} (${view.timezone})`];
  if (view.now) {
    lines.push(`NOW  ${refOf(view.now)} ${view.now.title}`);
    if (view.now.resumeNote) lines.push(`     next: ${view.now.resumeNote}`);
  }
  lines.push(
    ...renderSection({ name: "overdue", label: "OVERDUE", tasks: view.overdue, count: true }, fields),
    ...renderSection({ name: "today", label: "TODAY", tasks: view.today, empty: "nothing planned" }, fields),
    ...renderSection({ name: "done", label: "DONE", tasks: view.doneToday, count: true }, fields),
  );
  return lines.join("\n");
}

function renderDetail(task: Task, history: HistoryEntry[], timezone?: string): string {
  const lines = [`${refOf(task)} ${task.title}`];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push(`${label.padEnd(9)}${value}`);
  };
  add("status", task.status + (task.isNow ? " (now)" : "") + (task.overdue ? ", overdue" : ""));
  add("due", [task.dueDate, task.dueTime].filter(Boolean).join(" ") || "no date");
  add("repeat", task.repeat ? describeRepeat(task.repeat) : undefined);
  add("labels", task.labels.join(", "));
  add("links", task.links.map((l) => (l.title ? `${l.title} <${l.url}>` : l.url)).join(", "));
  add("next", task.resumeNote);
  add("archived", task.archivedAt ? formatTimestamp(task.archivedAt, timezone) : undefined);
  add("deleted", task.deletedAt ? formatTimestamp(task.deletedAt, timezone) : undefined);
  add("id", task.id);
  if (task.note) lines.push("note:", ...task.note.split("\n").map((l) => `  ${l}`));
  lines.push("history:");
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
