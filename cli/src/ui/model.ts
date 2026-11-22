// What the controller knows besides the key state: the server's data per view,
// the connection, the last message, and what the screens list from them.
import type { Project } from "../projects.js";
import type { Board, Detail, Task, TodayView } from "../render/model.js";
import { agentItems, type Agents, type Health } from "./agents.js";
import { addDays } from "../when/calendar.js";
import { boardColumns, matches, sectionTasks, todayLayout, weekDays, type Column, type Day, type PlanData, type Section } from "./lists.js";
import type { Lists, UiState } from "./state.js";

export type Data = {
  projects?: Project[];
  today?: TodayView;
  health?: Health;
  agents?: Agents;
  board?: Board;
  week?: { start: string; tasks: Task[] };
  /** Beside Today: open tasks of the next days and those without a day. */
  plan?: PlanData;
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

/** From this many columns To plan is a column beside Today's agenda; below, it is behind l. */
export const BESIDE_COLUMNS = 120;

/** Today's agenda and To plan; `beside` when To plan has a column of its own, `toPlan` when a narrow terminal shows it instead. */
export type TodayParts = { agenda: Section[]; toPlan: Section[]; beside: boolean; showsPlan: boolean };

export type Derived = { today: TodayParts; columns: Column[]; days: Day[]; lists: Lists };

export function derive(s: Pick<Snapshot, "ui" | "data" | "today" | "rows" | "columns">): Derived {
  const { ui, data, today } = s;
  const projects = data.projects ?? [];
  const beside = s.columns >= BESIDE_COLUMNS;
  const showsPlan = !beside && ui.toPlan;
  const parts = data.today ? todayLayout(data.today, data.plan, { filter: ui.filter, projects, beside, doneOpen: ui.doneOpen }) : { agenda: [], toPlan: [] };
  const agendaTasks = showsPlan ? [] : sectionTasks(parts.agenda);
  const planTasks = beside || showsPlan ? sectionTasks(parts.toPlan) : [];
  const columns = boardColumns(data.board ?? { todo: [], doing: [], done: [] }, ui.filter, projects);
  const weekTasks = data.week?.start === ui.weekStart ? data.week.tasks : [];
  const days = weekDays(ui.weekStart, weekTasks, today, ui.filter, projects);
  const lists: Lists = {
    today: [...agendaTasks, ...planTasks],
    todaySplit: beside ? agendaTasks.length : undefined,
    board: [columns[0]!.tasks, columns[1]!.tasks, columns[2]!.tasks],
    week: days.map((d) => d.tasks),
    weekDates: Array.from({ length: 7 }, (_, i) => addDays(ui.weekStart, i)),
    trash: (data.trash ?? []).filter((t) => matches(t, ui.filter, projects)),
    agents: agentItems(data.agents, ui.filter, projects),
    paused: data.agents?.controls.paused,
    detail: ui.detail && data.detail?.task.id === ui.detail.taskId ? data.detail.task : undefined,
    date: today,
    page: contentHeight(s.rows),
  };
  return { today: { ...parts, beside, showsPlan }, columns, days, lists };
}
