// Export of the whole plan: Markdown to read, JSON as a full copy, iCalendar
// (lib/ical.ts) for a calendar app.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { loadSettings, toTask, type Identity } from "./core";
import { isOverdue, localDate } from "./dates";
import { renderCalendar } from "./ical";
import { toRRule } from "./rrule";
import type { Reminder } from "./validators";

export const EXPORT_VERSION = 1;

function taskLine(task: Doc<"tasks">, timezone: string): string {
  const box = task.status === "done" ? "[x]" : "[ ]";
  const when = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const parts = [`- ${box}`, when, task.title].filter(Boolean);
  if (task.status === "doing") parts.push("(in progress)");
  if (task.completedAt) parts.push(`(done ${localDate(task.completedAt, timezone)})`);
  if (task.repeat) {
    const from = task.repeat.from === "completion" ? ", counted from completion" : "";
    parts.push(`(repeats ${toRRule(task.repeat, task.dueDate)}${from})`);
  }
  parts.push(...task.labels.map((label) => `#${label.replace(/\s+/g, "-")}`));
  const lines = [parts.join(" ")];
  if (task.resumeNote) lines.push(`  - Next step: ${task.resumeNote}`);
  for (const item of task.checklist ?? []) lines.push(`  - ${item.done ? "[x]" : "[ ]"} ${item.title}`);
  if (task.reminders) lines.push(`  - Reminders: ${task.reminders.length ? task.reminders.map(reminderText).join(", ") : "none"}`);
  if (task.note) lines.push(...task.note.split("\n").map((line) => `  > ${line}`));
  for (const link of task.links) lines.push(`  - [${link.title ?? link.url}](${link.url})`);
  return lines.join("\n");
}

function reminderText(reminder: Reminder): string {
  if ("minutesBefore" in reminder) return reminder.minutesBefore === 0 ? "at the due time" : `${reminder.minutesBefore} min before`;
  const days = reminder.daysBefore ?? 0;
  return days === 0 ? `${reminder.time} on the day` : `${reminder.time}, ${days} day${days === 1 ? "" : "s"} before`;
}

function section(title: string, tasks: Doc<"tasks">[], timezone: string): string[] {
  if (tasks.length === 0) return [];
  return [`## ${title}`, "", ...tasks.map((t) => taskLine(t, timezone)), ""];
}

function byDue(a: Doc<"tasks">, b: Doc<"tasks">) {
  const key = (t: Doc<"tasks">) => `${t.dueDate ?? "9999-99-99"} ${t.dueTime ?? "99:99"}`;
  return key(a).localeCompare(key(b)) || a.createdAt - b.createdAt;
}

export function renderMarkdown(tasks: Doc<"tasks">[], timezone: string, at: number): string {
  const today = localDate(at, timezone);
  const live = tasks.filter((t) => t.deletedAt === undefined).sort(byDue);
  const active = live.filter((t) => t.archivedAt === undefined);
  const open = active.filter((t) => t.status !== "done");
  return [
    `# Helm plan`,
    "",
    `Exported ${new Date(at).toISOString()} (today is ${today}, ${timezone}).`,
    "",
    ...section("Now", open.filter((t) => t.isNow), timezone),
    ...section("Overdue", open.filter((t) => isOverdue(t, today)), timezone),
    ...section(`Today (${today})`, open.filter((t) => t.dueDate === today), timezone),
    ...section("Upcoming", open.filter((t) => t.dueDate !== undefined && t.dueDate > today), timezone),
    ...section("No date", open.filter((t) => t.dueDate === undefined), timezone),
    ...section("Done", active.filter((t) => t.status === "done"), timezone),
    ...section("Archived", live.filter((t) => t.archivedAt !== undefined), timezone),
  ].join("\n");
}

export async function exportPlan(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const settings = await loadSettings(ctx, identity.userId);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  if (input.format === "markdown") {
    return { format: "markdown" as const, content: renderMarkdown(tasks, settings.timezone, at) };
  }
  if (input.format === "ics") return { format: "ics" as const, content: renderCalendar(tasks, { ...settings, at }) };
  const events = await ctx.db
    .query("taskEvents")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  return {
    format: "json" as const,
    content: {
      version: EXPORT_VERSION,
      exportedAt: at,
      settings,
      tasks: tasks.map(toTask),
      events: events.map(({ _id, _creationTime, userId, ...event }) => event),
    },
  };
}

type Args = ObjectType<(typeof args)["exportPlan"]>;
