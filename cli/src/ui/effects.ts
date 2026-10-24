// The server calls behind the keys: each change is one or two MCP tool calls,
// the same ones `dayhand add`, `dayhand done`, `dayhand now`, … make, and returns the line
// the status bar shows and the task the cursor should land on.
import { usageError } from "../core/exit.js";
import { relativeDate } from "../render/format.js";
import type { Task } from "../render/model.js";
import { addDays } from "../when/calendar.js";
import type { When } from "../when/parse.js";
import { parseWhen, WhenError } from "../when/parse.js";
import type { Api } from "./api.js";
import type { Effect } from "./handle.js";
import { parseMove, parseQuickAdd } from "./quickadd.js";
import { refText } from "./rows.js";
import type { EditKey } from "./state.js";

export type EffectContext = {
  api: Api;
  timezone: string;
  now: () => number;
  today: string;
  /** Opens $VISUAL/$EDITOR on the text (the terminal handed over) and returns what was saved. */
  editText: (text: string, fileName: string) => Promise<string>;
};

export type Done = { text: string; select?: string };

type Change = Extract<Effect, { kind: "add" | "complete" | "reopen" | "start" | "stop" | "restore" | "delete" | "clearNow" | "now" | "move" | "shift" | "status" | "edit" | "editor" | "undo" }>;

const label = (task: Pick<Task, "ref" | "title">) => `${refText(task as Task)} ${task.title}`.trim();

/** "Fri 30 Oct 14:00", "today", "no day". */
export function whenText(when: Pick<When, "date" | "time"> | null | undefined, today: string): string {
  if (!when) return "no day";
  return [relativeDate(when.date, today), when.time].filter(Boolean).join(" ");
}

export async function runChange(effect: Change, ctx: EffectContext): Promise<Done> {
  const { api } = ctx;
  const when = { now: ctx.now(), timezone: ctx.timezone };
  switch (effect.kind) {
    case "add": {
      const parsed = parseQuickAdd(effect.text, when);
      if (!parsed.title) throw usageError("A task needs a title, not only a date");
      const input: Record<string, unknown> = { title: parsed.title };
      const due = parsed.due === undefined ? { date: effect.date } : parsed.due;
      if (due) input.dueDate = due.date;
      if (due?.time) input.dueTime = due.time;
      if (parsed.labels.length) input.labels = parsed.labels;
      if (effect.status) input.status = effect.status;
      const task = await api.change<Task>("add_task", input);
      return { text: `Added ${label(task)} · ${whenText(due, ctx.today)}`, select: task.id };
    }
    case "complete": {
      const { task, next } = await api.change<{ task: Task; next: Task | null }>("complete_task", { taskId: effect.task.id });
      const after = next?.dueDate ? ` · next: ${whenText({ date: next.dueDate, time: next.dueTime }, ctx.today)}` : "";
      return { text: `Done: ${label(task)}${after}`, select: task.id };
    }
    case "reopen":
    case "stop":
    case "start": {
      const status = effect.kind === "start" ? "doing" : "todo";
      const task = await api.change<Task>("set_status", { taskId: effect.task.id, status });
      const verb = effect.kind === "reopen" ? "Not done" : effect.kind === "start" ? "Started" : "Stopped";
      return { text: `${verb}: ${label(task)}`, select: task.id };
    }
    case "status": {
      if (effect.to === "done") return runChange({ kind: "complete", task: effect.task }, ctx);
      const task = await api.change<Task>("set_status", { taskId: effect.task.id, status: effect.to });
      return { text: `${label(task)} → ${effect.to}`, select: task.id };
    }
    case "clearNow":
      await api.change("set_now", { taskId: null });
      return { text: "Now task cleared" };
    case "now":
      return makeNow(effect.task, effect.note, ctx);
    case "move": {
      const target = parseMove(effect.text, when);
      if (target === undefined) throw usageError("Not a date: try tomorrow, fri 14:00, next mon, 23 oct or none");
      const input: Record<string, unknown> = { taskId: effect.task.id, dueDate: target?.date ?? null };
      if (target?.time) input.dueTime = target.time;
      const task = await api.change<Task>("reschedule_task", input);
      return { text: `Moved ${label(task)} to ${whenText(target, ctx.today)}`, select: task.id };
    }
    case "shift": {
      const date = addDays(effect.task.dueDate!, effect.days);
      const task = await api.change<Task>("reschedule_task", { taskId: effect.task.id, dueDate: date });
      return { text: `Moved ${label(task)} to ${whenText({ date, time: task.dueTime }, ctx.today)}`, select: task.id };
    }
    case "edit":
      return edit(effect.task, effect.changes, ctx);
    case "editor":
      return editor(effect.task, ctx);
    case "delete":
      await api.change("delete_task", { taskId: effect.taskId });
      return { text: `Moved ${effect.label} to the trash · u undoes` };
    case "restore":
    case "undo": {
      const task = await api.change<Task>("restore_task", { taskId: effect.kind === "undo" ? effect.taskId : effect.task.id });
      return { text: `Restored ${label(task)}`, select: task.id };
    }
  }
}

/** n: the now task with its resume note; an emptied note is cleared with a second call. */
async function makeNow(task: Task, note: string, ctx: EffectContext): Promise<Done> {
  const input: Record<string, unknown> = { taskId: task.id };
  if (note && note !== task.resumeNote) input.resumeNote = note;
  const now = await ctx.api.change<Task>("set_now", input);
  if (!note && task.resumeNote) await ctx.api.change("update_task", { taskId: task.id, resumeNote: null });
  return { text: `Now: ${label(now)}${note ? ` · next: ${note}` : ""}`, select: now.id };
}

/** e: the changed fields in one update_task call. */
async function edit(task: Task, changes: Partial<Record<EditKey, string>>, ctx: EffectContext): Promise<Done> {
  const input: Record<string, unknown> = { taskId: task.id };
  if (changes.title !== undefined) {
    if (!changes.title) throw usageError("The title cannot be empty");
    input.title = changes.title;
  }
  if (changes.due !== undefined) {
    if (!changes.due) input.dueDate = null;
    else {
      const due = parseDue(changes.due, ctx);
      input.dueDate = due.date;
      input.dueTime = due.time ?? null;
    }
  }
  if (changes.labels !== undefined) input.labels = [...new Set(changes.labels.split(/[,\s]+/).map((l) => l.replace(/^#/, "")).filter(Boolean))];
  if (changes.resumeNote !== undefined) input.resumeNote = changes.resumeNote || null;
  const updated = await ctx.api.change<Task>("update_task", input);
  return { text: `Saved ${label(updated)}`, select: updated.id };
}

function parseDue(text: string, ctx: EffectContext): When {
  try {
    return parseWhen(text, { now: ctx.now(), timezone: ctx.timezone });
  } catch (error) {
    if (error instanceof WhenError) throw usageError(`Due: ${error.message}`);
    throw error;
  }
}

/** E: title on the first line, the note after a blank line, as `dayhand edit` on a terminal. */
async function editor(task: Task, ctx: EffectContext): Promise<Done> {
  const text = await ctx.editText(`${task.title}\n\n${task.note ? `${task.note}\n` : ""}`, `dayhand-task-${task.ref ?? "task"}.md`);
  const [first = "", ...rest] = text.split(/\r?\n/);
  const title = first.trim();
  if (!title) throw usageError("The first line (the title) is empty; nothing was changed");
  const note = rest.join("\n").replace(/^(\s*\n)+/, "").replace(/\s+$/, "");
  const input: Record<string, unknown> = { taskId: task.id };
  if (title !== task.title) input.title = title;
  if (note !== (task.note ?? "")) input.note = note === "" ? null : note;
  if (Object.keys(input).length === 1) return { text: "No changes", select: task.id };
  const updated = await ctx.api.change<Task>("update_task", input);
  return { text: `Saved ${label(updated)}`, select: updated.id };
}
