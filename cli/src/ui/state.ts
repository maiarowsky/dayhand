// The state of dayhand ui that keys change: the view, the cursor in each view,
// what is open over it (help, details, a prompt, the edit form) and the filter.
// Data from the server is not here: keys see it through `Lists`.
import { t } from "../i18n/index.js";
import type { Task } from "../render/model.js";
import type { Line } from "./line.js";

export type ViewName = "today" | "board" | "week" | "trash";
export const VIEWS: ViewName[] = ["today", "board", "week", "trash"];
export const viewLabel = (view: ViewName): string => t(`view.${view}`);

export type Prompt = "add" | "move" | "note" | "filter";

export type EditKey = "title" | "due" | "labels" | "resumeNote";
export type EditField = { key: EditKey; label: string; line: Line; initial: string };

export type Mode =
  | { kind: "normal" }
  | { kind: "help"; scroll: number }
  | { kind: "prompt"; prompt: Prompt; line: Line; taskId?: string; date?: string; status?: "doing" }
  | { kind: "confirm"; taskId: string; ref: string; title: string }
  | { kind: "edit"; taskId: string; fields: EditField[]; focus: number };

export type Cursor = {
  today: number;
  boardColumn: number;
  board: [number, number, number];
  weekDay: number;
  weekRow: number;
  trash: number;
};

export type UiState = {
  view: ViewName;
  mode: Mode;
  /** Task details open over the view (Enter); `scroll` is the first history row shown. */
  detail?: { taskId: string; scroll: number };
  cursor: Cursor;
  /** Monday of the week shown. */
  weekStart: string;
  filter: string;
  /** The task last moved to the trash, for u (undo). */
  lastDeleted?: string;
};

/** What the keys can reach: each view's tasks in cursor order (filtered), plus the day for adding. */
export type Lists = {
  today: Task[];
  board: [Task[], Task[], Task[]];
  week: Task[][];
  weekDates: string[];
  trash: Task[];
  detail?: Task;
  /** Today in the user's time zone. */
  date: string;
  /** Rows of the content area, for half-page moves. */
  page: number;
};

export function initialState(view: ViewName, weekStart: string): UiState {
  return {
    view,
    mode: { kind: "normal" },
    cursor: { today: 0, boardColumn: 0, board: [0, 0, 0], weekDay: 0, weekRow: 0, trash: 0 },
    weekStart,
    filter: "",
  };
}

export const clamp = (value: number, length: number) => Math.max(0, Math.min(value, length - 1));

/** The task under the cursor (in details: the task shown), if any. */
export function selectedTask(state: UiState, lists: Lists): Task | undefined {
  if (state.detail) return lists.detail;
  const c = state.cursor;
  switch (state.view) {
    case "today":
      return lists.today[clamp(c.today, lists.today.length)];
    case "board": {
      const column = lists.board[c.boardColumn] ?? [];
      return column[clamp(c.board[c.boardColumn] ?? 0, column.length)];
    }
    case "week": {
      const day = lists.week[c.weekDay] ?? [];
      return day[clamp(c.weekRow, day.length)];
    }
    case "trash":
      return lists.trash[clamp(c.trash, lists.trash.length)];
  }
}

/** Puts the cursor back on task `id` after a refresh moved it, if it is still listed. */
export function reanchor(state: UiState, id: string | undefined, lists: Lists): UiState {
  if (!id || state.detail) return state;
  const c = state.cursor;
  const at = (tasks: Task[]) => tasks.findIndex((t) => t.id === id);
  switch (state.view) {
    case "today": {
      const i = at(lists.today);
      return i < 0 || i === c.today ? state : { ...state, cursor: { ...c, today: i } };
    }
    case "board": {
      const column = lists.board.findIndex((tasks) => at(tasks) >= 0);
      if (column < 0) return state;
      const board = [...c.board] as Cursor["board"];
      board[column] = at(lists.board[column]!);
      return { ...state, cursor: { ...c, boardColumn: column, board } };
    }
    case "week": {
      const day = lists.week.findIndex((tasks) => at(tasks) >= 0);
      return day < 0 ? state : { ...state, cursor: { ...c, weekDay: day, weekRow: at(lists.week[day]!) } };
    }
    case "trash": {
      const i = at(lists.trash);
      return i < 0 || i === c.trash ? state : { ...state, cursor: { ...c, trash: i } };
    }
  }
}

/** Moves the cursor of the current view by `delta` rows (j/k, pages, g/G as ±Infinity). */
export function moveRow(state: UiState, lists: Lists, delta: number): UiState {
  const c = state.cursor;
  const step = (value: number, length: number) => {
    if (length === 0) return 0;
    if (!Number.isFinite(delta)) return delta > 0 ? length - 1 : 0;
    return clamp(clamp(value, length) + delta, length);
  };
  switch (state.view) {
    case "today":
      return { ...state, cursor: { ...c, today: step(c.today, lists.today.length) } };
    case "board": {
      const board = [...c.board] as Cursor["board"];
      board[c.boardColumn] = step(c.board[c.boardColumn] ?? 0, lists.board[c.boardColumn]?.length ?? 0);
      return { ...state, cursor: { ...c, board } };
    }
    case "week":
      return moveInWeek(state, lists, delta);
    case "trash":
      return { ...state, cursor: { ...c, trash: step(c.trash, lists.trash.length) } };
  }
}

/** j/k in the week: within the day, then on into the next or previous day. */
function moveInWeek(state: UiState, lists: Lists, delta: number): UiState {
  const c = state.cursor;
  const length = (day: number) => lists.week[day]?.length ?? 0;
  if (!Number.isFinite(delta)) return { ...state, cursor: { ...c, weekRow: delta > 0 ? Math.max(0, length(c.weekDay) - 1) : 0 } };
  let day = c.weekDay;
  let row = clamp(c.weekRow, length(day)) + delta;
  while (row >= Math.max(1, length(day)) && day < 6) {
    row -= Math.max(1, length(day));
    day++;
  }
  while (row < 0 && day > 0) {
    day--;
    row += Math.max(1, length(day));
  }
  return { ...state, cursor: { ...c, weekDay: day, weekRow: clamp(row, Math.max(1, length(day))) } };
}

/** h/l: the board column or the week day. */
export function moveColumn(state: UiState, delta: number): UiState {
  const c = state.cursor;
  if (state.view === "board") return { ...state, cursor: { ...c, boardColumn: clamp(c.boardColumn + delta, 3) } };
  if (state.view === "week") return { ...state, cursor: { ...c, weekDay: clamp(c.weekDay + delta, 7), weekRow: 0 } };
  return state;
}
