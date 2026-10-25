// Export of the whole plan: Markdown to read, JSON as a full copy, iCalendar
// (lib/ical.ts) for a calendar app.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { loadSettings, toTask, type Identity } from "./core";
import { isOverdue, localDate } from "./dates";
import { renderCalendar } from "./ical";
import { allProjects, toProject } from "./projectOps";
import { toRRule } from "./rrule";
import type { Reminder } from "./validators";

export const EXPORT_VERSION = 1;

/** A project name as a Markdown tag: "+Bakery-website" (since 0.13.0, next to the #labels). */
const projectTag = (name: string) => `+${name.replace(/\s+/g, "-")}`;

function taskLine(task: Doc<"tasks">, timezone: string, projectNames: Map<string, string>): string {
  const box = task.status === "done" ? "[x]" : "[ ]";
  const when = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const parts = [`- ${box}`, when, task.title].filter(Boolean);
  if (task.status === "doing") parts.push("(in progress)");
  if (task.completedAt) parts.push(`(done ${localDate(task.completedAt, timezone)})`);
  if (task.repeat) {
    const from = task.repeat.from === "completion" ? ", counted from completion" : "";
    parts.push(`(repeats ${toRRule(task.repeat, task.dueDate)}${from})`);
  }
  const project = task.projectId === undefined ? undefined : projectNames.get(task.projectId);
  if (project !== undefined) parts.push(projectTag(project));
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

function section(title: string, tasks: Doc<"tasks">[], timezone: string, projectNames: Map<string, string>): string[] {
  if (tasks.length === 0) return [];
  return [`## ${title}`, "", ...tasks.map((t) => taskLine(t, timezone, projectNames)), ""];
}

function byDue(a: Doc<"tasks">, b: Doc<"tasks">) {
  const key = (t: Doc<"tasks">) => `${t.dueDate ?? "9999-99-99"} ${t.dueTime ?? "99:99"}`;
  return key(a).localeCompare(key(b)) || a.createdAt - b.createdAt;
}

export function renderMarkdown(tasks: Doc<"tasks">[], timezone: string, at: number, projectNames = new Map<string, string>()): string {
  const today = localDate(at, timezone);
  const live = tasks.filter((t) => t.deletedAt === undefined).sort(byDue);
  const active = live.filter((t) => t.archivedAt === undefined);
  const open = active.filter((t) => t.status !== "done");
  const part = (title: string, list: Doc<"tasks">[]) => section(title, list, timezone, projectNames);
  return [
    `# Dayhand plan`,
    "",
    `Exported ${new Date(at).toISOString()} (today is ${today}, ${timezone}).`,
    "",
    ...part("Now", open.filter((t) => t.isNow)),
    ...part("Overdue", open.filter((t) => isOverdue(t, today))),
    ...part(`Today (${today})`, open.filter((t) => t.dueDate === today)),
    ...part("Upcoming", open.filter((t) => t.dueDate !== undefined && t.dueDate > today)),
    ...part("No date", open.filter((t) => t.dueDate === undefined)),
    ...part("Done", active.filter((t) => t.status === "done")),
    ...part("Archived", live.filter((t) => t.archivedAt !== undefined)),
  ].join("\n");
}

export async function exportPlan(ctx: QueryCtx, identity: Identity, input: Args) {
  const at = input.at ?? Date.now();
  const settings = await loadSettings(ctx, identity.userId);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const projects = await allProjects(ctx, identity.userId);
  if (input.format === "markdown") {
    const names = new Map<string, string>(projects.map((p) => [p._id, p.name]));
    return { format: "markdown" as const, content: renderMarkdown(tasks, settings.timezone, at, names) };
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
      // Since 0.13.0, in menu order; tasks name theirs by projectId. Version 1 still: an older import ignores them.
      projects: projects.map(toProject),
      tasks: tasks.map(toTask),
      events: events.map(({ _id, _creationTime, userId, ...event }) => event),
    },
  };
}

type Args = ObjectType<(typeof args)["exportPlan"]>;
