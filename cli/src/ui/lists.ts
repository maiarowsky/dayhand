// What each screen lists, from the backend's results: Today's sections, the
// board's columns, the week's days and the trash, narrowed by the `/` filter.
// The cursor moves over these lists, so the screens and the keys share them.
import { t } from "../i18n/index.js";
import { projectKey, projectToken } from "../projects.js";
import type { Board, Task, TodayView } from "../render/model.js";
import { addDays, isoWeekday } from "../when/calendar.js";

export type Section = { key: "now" | "overdue" | "today" | "done"; label: string; tasks: Task[]; empty?: string };
export type Column = { key: "todo" | "doing" | "done"; label: string; tasks: Task[] };
export type Day = { date: string; isToday: boolean; tasks: Task[] };

/** Title, labels, notes or the number contain the text, in any case. */
export function matches(task: Task, filter: string): boolean {
  const tokens = filter.trim().split(/\s+/);
  const projects = tokens.filter((token) => token.startsWith("+"));
  const projectMatches = projects.every((token) => task.project !== undefined && projectKey(projectToken(task.project)) === projectKey(token.slice(1)));
  if (!projectMatches) return false;
  const needle = tokens.filter((token) => !token.startsWith("+")).join(" ").toLowerCase();
  if (!needle) return true;
  const haystack = [task.title, task.note ?? "", task.resumeNote ?? "", ...task.labels.map((l) => `#${l}`), task.ref === undefined ? "" : `#${task.ref}`];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

const only = (tasks: Task[], filter: string) => tasks.filter((t) => matches(t, filter));

/** The now task leads; it is not repeated in Overdue or Today. */
export function todaySections(view: TodayView, filter = ""): Section[] {
  const now = view.now && matches(view.now, filter) ? [view.now] : [];
  const open = (tasks: Task[]) => only(tasks, filter).filter((t) => !t.isNow);
  const sections: Section[] = [
    { key: "now", label: t("section.now"), tasks: now },
    { key: "overdue", label: t("section.overdue"), tasks: open(view.overdue) },
    { key: "today", label: t("section.today"), tasks: open(view.today), empty: filter ? t("section.noMatch") : t("section.nothingPlanned") },
    { key: "done", label: t("section.doneToday"), tasks: only(view.doneToday, filter) },
  ];
  return sections.filter((s) => s.tasks.length > 0 || s.key === "today");
}

/** Today's tasks in the order the cursor walks them. */
export const todayTasks = (sections: Section[]) => sections.flatMap((s) => s.tasks);

export function boardColumns(board: Board, filter = ""): Column[] {
  return [
    { key: "todo", label: t("column.todo"), tasks: only(board.todo, filter) },
    { key: "doing", label: t("column.doing"), tasks: only(board.doing, filter) },
    { key: "done", label: t("column.done"), tasks: only(board.done, filter) },
  ];
}

/** The Monday of the week of `date` (weeks start on Monday, as Dayhand's repeat rules do). */
export const weekStart = (date: string) => addDays(date, 1 - isoWeekday(date));

/**
 * Seven days from `start` with the tasks due on each: open ones first, untimed
 * before timed, timed by time; done ones last. Overdue tasks stay on their day.
 */
export function weekDays(start: string, tasks: Task[], today: string, filter = ""): Day[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const due = only(tasks, filter).filter((t) => t.dueDate === date && !t.deletedAt && !t.archivedAt);
    return { date, isToday: date === today, tasks: [...due].sort(byDay) };
  });
}

function byDay(a: Task, b: Task): number {
  const done = Number(a.status === "done") - Number(b.status === "done");
  if (done) return done;
  const timed = Number(Boolean(a.dueTime)) - Number(Boolean(b.dueTime));
  if (timed) return timed;
  const time = (a.dueTime ?? "").localeCompare(b.dueTime ?? "");
  return time || a.createdAt - b.createdAt;
}
