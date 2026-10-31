// The server calls behind the keys: each change is one or two MCP tool calls,
// the same ones `dayhand add`, `dayhand done`, `dayhand now`, … make, and returns the line
// the status bar shows and the task the cursor should land on.
import { usageError } from "../core/exit.js";
import { relativeDay } from "../i18n/dates.js";
import { t } from "../i18n/index.js";
import type { Task } from "../render/model.js";
import type { Project } from "../projects.js";
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
  projects?: Project[];
  timezone: string;
  now: () => number;
  today: string;
  /** Opens $VISUAL/$EDITOR on the text (the terminal handed over) and returns what was saved. */
  editText: (text: string, fileName: string) => Promise<string>;
};

export type Done = { text: string; select?: string };

type Change = Exclude<Effect, { kind: "quit" | "refresh" | "detail" | "flash" | "copy" }>;

const label = (task: Pick<Task, "ref" | "title">) => `${refText(task as Task)} ${task.title}`.trim();

/** "Fri 30 Oct 14:00", "today", "no day". */
export function whenText(when: Pick<When, "date" | "time"> | null | undefined, today: string): string {
  if (!when) return t("day.none");
  return [relativeDay(when.date, today), when.time].filter(Boolean).join(" ");
}

export async function runChange(effect: Change, ctx: EffectContext): Promise<Done> {
  const { api } = ctx;
  const when = { now: ctx.now(), timezone: ctx.timezone };
  switch (effect.kind) {
    case "pause":
      await api.change("pause_agents", { paused: effect.paused });
      return { text: t(effect.paused ? "done.agentsPaused" : "done.agentsResumed") };
    case "decide":
      await api.change("decide_approval", { approvalId: effect.approvalId, optionId: effect.optionId });
      return { text: t("done.decided", { label: effect.label }) };
    case "accept": {
      const task = await api.change<Task>("accept_proposal", { taskId: effect.task.id });
      return { text: t("done.accepted", { task: label(task) }) };
    }
    case "reject":
      await api.change("reject_proposal", { taskId: effect.task.id, reason: effect.reason });
      return { text: t("done.rejected", { task: label(effect.task) }) };
    case "add": {
      const parsed = parseQuickAdd(effect.text, when, ctx.projects);
      if (!parsed.title) throw usageError(t("error.titleOnlyDate"));
      const input: Record<string, unknown> = { title: parsed.title };
      const due = parsed.due === undefined ? { date: effect.date } : parsed.due;
      if (due) input.dueDate = due.date;
      if (due?.time) input.dueTime = due.time;
      if (parsed.projectId) input.projectId = parsed.projectId;
      if (effect.status) input.status = effect.status;
      const task = await api.change<Task>("add_task", input);
      return { text: t("done.added", { task: label(task), when: whenText(due, ctx.today) }), select: task.id };
    }
    case "complete": {
      const { task, next } = await api.change<{ task: Task; next: Task | null }>("complete_task", { taskId: effect.task.id });
      const after = next?.dueDate ? t("done.next", { when: whenText({ date: next.dueDate, time: next.dueTime }, ctx.today) }) : "";
      return { text: t("done.done", { task: label(task) }) + after, select: task.id };
    }
    case "reopen":
    case "stop":
    case "start": {
      const status = effect.kind === "start" ? "doing" : "todo";
      const task = await api.change<Task>("set_status", { taskId: effect.task.id, status });
      const message = effect.kind === "reopen" ? "done.notDone" : effect.kind === "start" ? "done.started" : "done.stopped";
      return { text: t(message, { task: label(task) }), select: task.id };
    }
    case "status": {
      if (effect.to === "done") return runChange({ kind: "complete", task: effect.task }, ctx);
      const task = await api.change<Task>("set_status", { taskId: effect.task.id, status: effect.to });
      return { text: t("done.status", { task: label(task), status: t(`status.${effect.to}`) }), select: task.id };
    }
    case "clearNow":
      await api.change("set_now", { taskId: null });
      return { text: t("done.nowCleared") };
    case "now":
      return makeNow(effect.task, effect.note, ctx);
    case "move": {
      const target = parseMove(effect.text, when);
      if (target === undefined) throw usageError(t("error.notADate"));
      const input: Record<string, unknown> = { taskId: effect.task.id, dueDate: target?.date ?? null };
      if (target?.time) input.dueTime = target.time;
      const task = await api.change<Task>("reschedule_task", input);
      return { text: t("done.moved", { task: label(task), when: whenText(target, ctx.today) }), select: task.id };
    }
    case "shift": {
      const date = addDays(effect.task.dueDate!, effect.days);
      const task = await api.change<Task>("reschedule_task", { taskId: effect.task.id, dueDate: date });
      return { text: t("done.moved", { task: label(task), when: whenText({ date, time: task.dueTime }, ctx.today) }), select: task.id };
    }
    case "edit":
      return edit(effect.task, effect.changes, ctx);
    case "editor":
      return editor(effect.task, ctx);
    case "delete":
      await api.change("delete_task", { taskId: effect.taskId });
      return { text: t("done.trashed", { task: effect.label }) };
    case "restore":
    case "undo": {
      const task = await api.change<Task>("restore_task", { taskId: effect.kind === "undo" ? effect.taskId : effect.task.id });
      return { text: t("done.restored", { task: label(task) }), select: task.id };
    }
  }
}

/** n: the now task with its resume note; an emptied note is cleared with a second call. */
async function makeNow(task: Task, note: string, ctx: EffectContext): Promise<Done> {
  const input: Record<string, unknown> = { taskId: task.id };
  if (note && note !== task.resumeNote) input.resumeNote = note;
  const now = await ctx.api.change<Task>("set_now", input);
  if (!note && task.resumeNote) await ctx.api.change("update_task", { taskId: task.id, resumeNote: null });
  return { text: t("done.now", { task: label(now) }) + (note ? t("done.nowNext", { note }) : ""), select: now.id };
}

/** e: the changed fields in one update_task call. */
async function edit(task: Task, changes: Partial<Record<EditKey, string>>, ctx: EffectContext): Promise<Done> {
  const input: Record<string, unknown> = { taskId: task.id };
  if (changes.title !== undefined) {
    if (!changes.title) throw usageError(t("error.emptyTitle"));
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
  if (changes.resumeNote !== undefined) input.resumeNote = changes.resumeNote || null;
  const updated = await ctx.api.change<Task>("update_task", input);
  return { text: t("done.saved", { task: label(updated) }), select: updated.id };
}

function parseDue(text: string, ctx: EffectContext): When {
  try {
    return parseWhen(text, { now: ctx.now(), timezone: ctx.timezone });
  } catch (error) {
    if (error instanceof WhenError) throw usageError(t("error.due", { message: error.message }));
    throw error;
  }
}

/** E: title on the first line, the note after a blank line, as `dayhand edit` on a terminal. */
async function editor(task: Task, ctx: EffectContext): Promise<Done> {
  const text = await ctx.editText(`${task.title}\n\n${task.note ? `${task.note}\n` : ""}`, `dayhand-task-${task.ref ?? "task"}.md`);
  const [first = "", ...rest] = text.split(/\r?\n/);
  const title = first.trim();
  if (!title) throw usageError(t("error.editorEmpty"));
  const note = rest.join("\n").replace(/^(\s*\n)+/, "").replace(/\s+$/, "");
  const input: Record<string, unknown> = { taskId: task.id };
  if (title !== task.title) input.title = title;
  if (note !== (task.note ?? "")) input.note = note === "" ? null : note;
  if (Object.keys(input).length === 1) return { text: t("done.noChanges"), select: task.id };
  const updated = await ctx.api.change<Task>("update_task", input);
  return { text: t("done.saved", { task: label(updated) }), select: updated.id };
}
