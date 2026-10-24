// What a key does: a pure function from the state, the key name and the lists
// to the next state and at most one effect (a server call, a reload, quitting),
// which the controller carries out. Keys follow keys.ts.
import { t } from "../i18n/index.js";
import type { Task } from "../render/model.js";
import { addDays, isoWeekday } from "../when/calendar.js";
import { editLine, line } from "./line.js";
import { weekStart } from "./lists.js";
import { clamp, moveColumn, moveRow, selectedTask, VIEWS, type EditField, type EditKey, type Lists, type Mode, type UiState } from "./state.js";

export type Effect =
  | { kind: "quit" }
  | { kind: "refresh" }
  | { kind: "detail"; taskId: string }
  | { kind: "add"; text: string; date: string; status?: "doing" }
  | { kind: "complete" | "reopen" | "start" | "stop" | "restore"; task: Task }
  | { kind: "delete"; taskId: string; label: string }
  | { kind: "clearNow" }
  | { kind: "now"; task: Task; note: string }
  | { kind: "move"; task: Task; text: string }
  | { kind: "shift"; task: Task; days: number }
  | { kind: "status"; task: Task; to: "todo" | "doing" | "done" }
  | { kind: "edit"; task: Task; changes: Partial<Record<EditKey, string>> }
  | { kind: "editor"; task: Task }
  | { kind: "undo"; taskId: string }
  | { kind: "flash"; text: string };

export type Result = { state: UiState; effect?: Effect };

const NORMAL: Mode = { kind: "normal" };
const STATUSES = ["todo", "doing", "done"] as const;

export function handleKey(state: UiState, name: string, lists: Lists): Result {
  if (name === "C-c") return { state, effect: { kind: "quit" } };
  switch (state.mode.kind) {
    case "help":
      return help(state, name);
    case "prompt":
      return prompt(state, state.mode, name, lists);
    case "confirm":
      return confirm(state, state.mode, name);
    case "edit":
      return edit(state, state.mode, name, lists);
    case "normal":
      return normal(state, name, lists);
  }
}

function help(state: UiState, name: string): Result {
  const mode = state.mode as Extract<Mode, { kind: "help" }>;
  if (name === "j" || name === "down") return { state: { ...state, mode: { ...mode, scroll: mode.scroll + 1 } } };
  if (name === "k" || name === "up") return { state: { ...state, mode: { ...mode, scroll: Math.max(0, mode.scroll - 1) } } };
  return { state: { ...state, mode: NORMAL } };
}

const flash = (state: UiState, text: string): Result => ({ state, effect: { kind: "flash", text } });

function normal(state: UiState, name: string, lists: Lists): Result {
  const moved = navigation(state, name, lists);
  if (moved) return moved;
  const task = selectedTask(state, lists);
  const inTrash = Boolean(task?.deletedAt);
  const act = (make: (task: Task) => Result): Result => (!task ? flash(state, t("flash.noTask")) : inTrash ? flash(state, t("flash.inTrash")) : make(task));
  switch (name) {
    case "a":
      return { state: { ...state, mode: { kind: "prompt", prompt: "add", line: line(), date: addDate(state, lists), ...(boardDoing(state) ? { status: "doing" as const } : {}) } } };
    case "space":
    case "x":
      return act((t) => ({ state, effect: { kind: t.status === "done" ? "reopen" : "complete", task: t } }));
    case "s":
      return act((t) => ({ state, effect: { kind: t.status === "doing" ? "stop" : "start", task: t } }));
    case "n":
      return act((t) => ({ state: { ...state, mode: { kind: "prompt", prompt: "note", line: line(t.resumeNote ?? ""), taskId: t.id } } }));
    case "N":
      return { state, effect: { kind: "clearNow" } };
    case "e":
      return act((t) => ({ state: { ...state, mode: { kind: "edit", taskId: t.id, fields: editFields(t), focus: 0 } } }));
    case "E":
      return act((t) => ({ state, effect: { kind: "editor", task: t } }));
    case "m":
      return act((t) => ({ state: { ...state, mode: { kind: "prompt", prompt: "move", line: line(), taskId: t.id } } }));
    case "d":
      return act((t) => ({ state: { ...state, mode: { kind: "confirm", taskId: t.id, ref: t.ref === undefined ? "" : `#${t.ref}`, title: t.title } } }));
    case "r":
      return task && inTrash ? { state, effect: { kind: "restore", task } } : flash(state, t("flash.restoreWhere"));
    case "u":
      return state.lastDeleted ? { state: { ...state, lastDeleted: undefined }, effect: { kind: "undo", taskId: state.lastDeleted } } : flash(state, t("flash.nothingToUndo"));
    case "H":
    case "L":
      return act((t) => sideways(state, t, name === "H" ? -1 : 1));
    case "enter":
      if (task) return { state: { ...state, detail: { taskId: task.id, scroll: 0 } }, effect: { kind: "detail", taskId: task.id } };
      if (state.view === "week") return normal(state, "a", lists);
      return { state };
    default:
      return { state };
  }
}

/** Keys that only move: views, cursor, details scrolling, help, filter, quit. */
function navigation(state: UiState, name: string, lists: Lists): Result | undefined {
  const half = Math.max(1, Math.floor(lists.page / 2));
  const rows: Record<string, number> = { j: 1, down: 1, k: -1, up: -1, g: -Infinity, home: -Infinity, G: Infinity, end: Infinity, "C-d": half, pgdn: half, "C-u": -half, pgup: -half };
  if (name in rows) {
    const delta = rows[name]!;
    if (state.detail) {
      const scroll = Number.isFinite(delta) ? Math.max(0, state.detail.scroll + delta) : delta > 0 ? Number.MAX_SAFE_INTEGER : 0;
      return { state: { ...state, detail: { ...state.detail, scroll } } };
    }
    return { state: moveRow(state, lists, delta) };
  }
  const view = (index: number): Result => ({ state: { ...state, view: VIEWS[(index + VIEWS.length) % VIEWS.length]!, detail: undefined }, effect: { kind: "refresh" } });
  switch (name) {
    case "q":
      return state.detail ? { state: { ...state, detail: undefined } } : { state, effect: { kind: "quit" } };
    case "esc":
      if (state.detail) return { state: { ...state, detail: undefined } };
      return { state: { ...state, filter: "" } };
    case "?":
      return { state: { ...state, mode: { kind: "help", scroll: 0 } } };
    case "tab":
      return view(VIEWS.indexOf(state.view) + 1);
    case "S-tab":
      return view(VIEWS.indexOf(state.view) - 1);
    case "1":
    case "2":
    case "3":
    case "4":
      return view(Number(name) - 1);
    case "R":
    case "C-r":
      return { state, effect: { kind: "refresh" } };
    case "/":
      return { state: { ...state, detail: undefined, mode: { kind: "prompt", prompt: "filter", line: line(state.filter) } } };
    case "h":
    case "left":
      return state.detail ? { state } : { state: moveColumn(state, -1) };
    case "l":
    case "right":
      return state.detail ? { state } : { state: moveColumn(state, 1) };
    case "[":
    case "]":
      if (state.view !== "week" || state.detail) return undefined;
      return { state: { ...state, weekStart: addDays(state.weekStart, name === "[" ? -7 : 7), cursor: { ...state.cursor, weekRow: 0 } }, effect: { kind: "refresh" } };
    case "t":
      if (state.view !== "week" || state.detail) return undefined;
      return { state: { ...state, weekStart: weekStart(lists.date), cursor: { ...state.cursor, weekDay: isoWeekday(lists.date) - 1, weekRow: 0 } }, effect: { kind: "refresh" } };
    default:
      return undefined;
  }
}

/** The day a new task gets: the selected day in the week, else today. */
const addDate = (state: UiState, lists: Lists) => (state.view === "week" && !state.detail ? (lists.weekDates[state.cursor.weekDay] ?? lists.date) : lists.date);
const boardDoing = (state: UiState) => state.view === "board" && !state.detail && state.cursor.boardColumn === 1;

/** H/L: on the board the next column (status), in the week the next day. */
function sideways(state: UiState, task: Task, delta: number): Result {
  if (state.view === "week") {
    if (!task.dueDate) return flash(state, t("flash.noDay"));
    const cursor = { ...state.cursor, weekDay: clamp(state.cursor.weekDay + delta, 7) };
    return { state: { ...state, cursor }, effect: { kind: "shift", task, days: delta } };
  }
  if (state.view !== "board") return flash(state, t("flash.shiftWhere"));
  const to = STATUSES[STATUSES.indexOf(task.status) + delta];
  if (!to) return { state };
  const board = [...state.cursor.board] as UiState["cursor"]["board"];
  const column = STATUSES.indexOf(to);
  board[column] = 0;
  return { state: { ...state, cursor: { ...state.cursor, boardColumn: column, board } }, effect: { kind: "status", task, to } };
}

function prompt(state: UiState, mode: Extract<Mode, { kind: "prompt" }>, name: string, lists: Lists): Result {
  const closed = { ...state, mode: NORMAL };
  if (name === "esc") return { state: mode.prompt === "filter" ? { ...closed, filter: "" } : closed };
  if (name === "enter") {
    const text = mode.line.text.trim();
    const task = mode.taskId ? findTask(lists, mode.taskId, state) : undefined;
    switch (mode.prompt) {
      case "filter":
        return { state: { ...closed, filter: text } };
      case "add":
        return text ? { state: closed, effect: { kind: "add", text, date: mode.date ?? lists.date, ...(mode.status ? { status: mode.status } : {}) } } : { state: closed };
      case "move":
        return task && text ? { state: closed, effect: { kind: "move", task, text } } : { state: closed };
      case "note":
        return task ? { state: closed, effect: { kind: "now", task, note: text } } : { state: closed };
    }
  }
  const edited = editLine(mode.line, name);
  if (!edited) return { state };
  const next = { ...state, mode: { ...mode, line: edited } };
  return { state: mode.prompt === "filter" ? { ...next, filter: edited.text } : next };
}

function confirm(state: UiState, mode: Extract<Mode, { kind: "confirm" }>, name: string): Result {
  const closed = { ...state, mode: NORMAL };
  if (name !== "y" && name !== "Y") return { state: closed, effect: { kind: "flash", text: t("flash.kept") } };
  return { state: { ...closed, detail: undefined, lastDeleted: mode.taskId }, effect: { kind: "delete", taskId: mode.taskId, label: `${mode.ref} ${mode.title}`.trim() } };
}

function edit(state: UiState, mode: Extract<Mode, { kind: "edit" }>, name: string, lists: Lists): Result {
  const closed = { ...state, mode: NORMAL };
  const focus = (delta: number) => ({ state: { ...state, mode: { ...mode, focus: (mode.focus + delta + mode.fields.length) % mode.fields.length } } });
  switch (name) {
    case "esc":
      return { state: closed, effect: { kind: "flash", text: t("flash.editCancelled") } };
    case "tab":
    case "down":
      return focus(1);
    case "S-tab":
    case "up":
      return focus(-1);
    case "enter": {
      const task = findTask(lists, mode.taskId, state);
      const changes = Object.fromEntries(mode.fields.filter((f) => f.line.text.trim() !== f.initial).map((f) => [f.key, f.line.text.trim()]));
      if (!task || Object.keys(changes).length === 0) return { state: closed, effect: { kind: "flash", text: t("done.noChanges") } };
      return { state: closed, effect: { kind: "edit", task, changes } };
    }
    default: {
      const field = mode.fields[mode.focus]!;
      const edited = editLine(field.line, name);
      if (!edited) return { state };
      const fields = mode.fields.map((f, i) => (i === mode.focus ? { ...f, line: edited } : f));
      return { state: { ...state, mode: { ...mode, fields } } };
    }
  }
}

/** The edit form's fields, prefilled from the task (the due field as "YYYY-MM-DD HH:MM"). */
export function editFields(task: Task): EditField[] {
  const values: [EditKey, string, string][] = [
    ["title", t("field.title"), task.title],
    ["due", t("field.due"), [task.dueDate, task.dueTime].filter(Boolean).join(" ")],
    ["labels", t("field.labels"), task.labels.join(", ")],
    ["resumeNote", t("field.resumeNote"), task.resumeNote ?? ""],
  ];
  return values.map(([key, label, value]) => ({ key, label, line: line(value), initial: value }));
}

/** The task a prompt or form was opened for: still selected, or open in details. */
function findTask(lists: Lists, id: string, state: UiState): Task | undefined {
  const all = [lists.detail, ...lists.today, ...lists.board.flat(), ...lists.week.flat(), ...lists.trash];
  return all.find((t) => t?.id === id) ?? (selectedTask(state, lists)?.id === id ? selectedTask(state, lists) : undefined);
}
