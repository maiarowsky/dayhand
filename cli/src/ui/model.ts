// What the controller knows besides the key state: the server's data per view,
// the connection, the last message, and what the screens list from them.
import type { Board, Detail, Task, TodayView } from "../render/model.js";
import { agentItems, type Agents, type Health } from "./agents.js";
import { addDays } from "../when/calendar.js";
import { boardColumns, matches, todaySections, todayTasks, weekDays, type Column, type Day, type Section } from "./lists.js";
import type { Lists, UiState } from "./state.js";

export type Data = {
  today?: TodayView;
  health?: Health;
  agents?: Agents;
  board?: Board;
  week?: { start: string; tasks: Task[] };
  trash?: Task[];
  detail?: Detail;
};

export type Conn =
  | { state: "connecting" }
  | { state: "online"; at: number }
  | { state: "offline"; message: string; at?: number }
  | { state: "rejected"; message: string }
  | { state: "throttled"; message: string; at?: number };

export type Flash = { text: string; tone: "ok" | "error" | "info" };

export type Snapshot = {
  ui: UiState;
  data: Data;
  conn: Conn;
  flash?: Flash;
  /** Changes sent and not answered yet. */
  busy: number;
  columns: number;
  rows: number;
  timezone?: string;
  /** Today in the user's time zone. */
  today: string;
  now: number;
  /** Seconds between refreshes. */
  interval: number;
};

/** Rows of the content area: the frame takes 4 (tabs, heading, status, keys). */
export const contentHeight = (rows: number) => Math.max(1, rows - 4);

export type Derived = { sections: Section[]; columns: Column[]; days: Day[]; lists: Lists };

export function derive(s: Pick<Snapshot, "ui" | "data" | "today" | "rows">): Derived {
  const { ui, data, today } = s;
  const sections = data.today ? todaySections(data.today, ui.filter) : [];
  const columns = boardColumns(data.board ?? { todo: [], doing: [], done: [] }, ui.filter);
  const weekTasks = data.week?.start === ui.weekStart ? data.week.tasks : [];
  const days = weekDays(ui.weekStart, weekTasks, today, ui.filter);
  const lists: Lists = {
    today: todayTasks(sections),
    board: [columns[0]!.tasks, columns[1]!.tasks, columns[2]!.tasks],
    week: days.map((d) => d.tasks),
    weekDates: Array.from({ length: 7 }, (_, i) => addDays(ui.weekStart, i)),
    trash: (data.trash ?? []).filter((t) => matches(t, ui.filter)),
    agents: agentItems(data.agents, ui.filter),
    paused: data.agents?.controls.paused,
    detail: ui.detail && data.detail?.task.id === ui.detail.taskId ? data.detail.task : undefined,
    date: today,
    page: contentHeight(s.rows),
  };
  return { sections, columns, days, lists };
}
