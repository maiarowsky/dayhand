// Read-side operations: Today, All, board, task details, trash.
import type { ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { loadSettings, loadTask, toTask, type Identity } from "./core";
import { isOverdue, localDate } from "./dates";
import type { Status } from "./validators";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DONE_LIMIT = 50;

function isActive(task: Doc<"tasks">) {
  return task.archivedAt === undefined && task.deletedAt === undefined;
}

/** Timed tasks first by time, then untimed by creation. */
function bySchedule(a: Doc<"tasks">, b: Doc<"tasks">) {
  const dateOrder = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  if (dateOrder !== 0) return dateOrder;
  if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
  if (a.dueTime) return -1;
  if (b.dueTime) return 1;
  return a.createdAt - b.createdAt;
}

async function openTasksDueBy(ctx: QueryCtx, userId: string, status: Status, lastDate: string) {
  return ctx.db
    .query("tasks")
    .withIndex("by_user_status_dueDate", (q) =>
      q.eq("userId", userId).eq("status", status).gt("dueDate", "").lte("dueDate", lastDate),
    )
    .collect();
}

/** Today screen: overdue first, then today, then what was done today. */
export async function listToday(ctx: QueryCtx, identity: Identity, input: Args<"listToday">) {
  const at = input.at ?? Date.now();
  const { timezone } = await loadSettings(ctx, identity.userId);
  const today = localDate(at, timezone);
  const open = [
    ...(await openTasksDueBy(ctx, identity.userId, "todo", today)),
    ...(await openTasksDueBy(ctx, identity.userId, "doing", today)),
  ].filter(isActive);
  // Completed in the last two days, narrowed to today's local date below.
  const recentlyDone = await ctx.db
    .query("tasks")
    .withIndex("by_user_completedAt", (q) => q.eq("userId", identity.userId).gte("completedAt", at - 2 * DAY_MS))
    .collect();
  const nowTask = await ctx.db
    .query("tasks")
    .withIndex("by_user_isNow", (q) => q.eq("userId", identity.userId).eq("isNow", true))
    .first();
  return {
    date: today,
    timezone,
    now: nowTask && isActive(nowTask) ? toTask(nowTask) : null,
    overdue: open.filter((t) => isOverdue(t, today)).sort(bySchedule).map(toTask),
    today: open.filter((t) => t.dueDate === today).sort(bySchedule).map(toTask),
    doneToday: recentlyDone
      .filter((t) => t.status === "done" && isActive(t) && localDate(t.completedAt!, timezone) === today)
      .sort((a, b) => b.completedAt! - a.completedAt!)
      .map(toTask),
  };
}

/** Every active task, optionally narrowed to tasks having all given labels. */
export async function listAll(ctx: QueryCtx, identity: Identity, input: Args<"listAll">) {
  const at = input.at ?? Date.now();
  const today = localDate(at, (await loadSettings(ctx, identity.userId)).timezone);
  const wanted = (input.labels ?? []).map((l) => l.trim()).filter((l) => l !== "");
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  return tasks
    .filter((t) => t.deletedAt === undefined)
    .filter((t) => input.includeArchived || t.archivedAt === undefined)
    .filter((t) => input.includeDone !== false || t.status !== "done")
    .filter((t) => wanted.every((label) => t.labels.includes(label)))
    .sort(bySchedule)
    .map((t) => ({ ...toTask(t), overdue: isOverdue(t, today) }));
}

export async function listTrash(ctx: QueryCtx, identity: Identity) {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  return tasks
    .filter((t) => t.deletedAt !== undefined)
    .sort((a, b) => b.deletedAt! - a.deletedAt!)
    .map(toTask);
}

/** Kanban: to do / in progress / done. The "now" task is flagged in "doing". */
export async function board(ctx: QueryCtx, identity: Identity, input: Args<"board">) {
  const at = input.at ?? Date.now();
  const today = localDate(at, (await loadSettings(ctx, identity.userId)).timezone);
  const doneLimit = Math.max(0, Math.min(Math.floor(input.doneLimit ?? DEFAULT_DONE_LIMIT), 500));
  const column = async (status: Status) =>
    (
      await ctx.db
        .query("tasks")
        .withIndex("by_user_status_dueDate", (q) => q.eq("userId", identity.userId).eq("status", status))
        .collect()
    )
      .filter(isActive)
      .sort(bySchedule)
      .map((t) => ({ ...toTask(t), overdue: isOverdue(t, today) }));
  const done = [];
  for await (const task of ctx.db
    .query("tasks")
    .withIndex("by_user_completedAt", (q) => q.eq("userId", identity.userId).gte("completedAt", 0))
    .order("desc")) {
    if (done.length >= doneLimit) break;
    if (task.status === "done" && isActive(task)) done.push(toTask(task));
  }
  return { todo: await column("todo"), doing: await column("doing"), done };
}

/** One task with its full change history (oldest first). */
export async function getTask(ctx: QueryCtx, identity: Identity, input: Args<"getTask">) {
  const task = await loadTask(ctx, identity.userId, input.taskId);
  const today = localDate(input.at ?? Date.now(), (await loadSettings(ctx, identity.userId)).timezone);
  const events = await ctx.db
    .query("taskEvents")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .collect();
  return {
    task: { ...toTask(task), overdue: isOverdue(task, today) },
    history: events.map((e) => ({
      at: e.at,
      actor: e.actor,
      action: e.action,
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  };
}
