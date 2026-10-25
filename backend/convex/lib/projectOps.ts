// Projects (since 0.13.0): a flat list of the user's projects in the order of
// `position`, with an archive. A task is in at most one project
// (tasks.projectId); labels stay free tags across projects. A project is named
// by its id or by its name in any case, as a task is by its id or "#42"; in
// filters and as a target "none" means no project. Changes of a project are
// recorded in history without a task (projectAdd, projectUpdate,
// projectDelete), as settings are; moving a task is an ordinary change of the
// task ("update"), with its history entry and task.updated webhook.
import { ConvexError, type ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { checkClaim } from "./agentWork";
import type { args } from "./args";
import { appliedOperation, checkClientId, checkLabels, diff, fail, loadSettings, ownerOnly, patchTask, recordEvent, type Identity } from "./core";
import { isOverdue, localDate } from "./dates";
import type { ProjectColor } from "./validators";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

/** Names are as long as labels, so a label always fits as a name and back (projectsToLabels). */
export const PROJECT_LIMITS = { name: 50, note: 2_000, icon: 16, projects: 200, move: 1_000, position: 1e15 };
/** Distance between the positions of projects added at the end. */
export const POSITION_STEP = 1024;
/** In filters and as a target: no project. Reserved, so no project has this name. */
export const NO_PROJECT = "none";

// ---- Checks ----

/** The key that keeps names unique: trimmed, NFC, lower case. */
export const nameKeyOf = (name: string) => name.trim().normalize("NFC").toLowerCase();

const isNone = (ref: string) => nameKeyOf(ref) === NO_PROJECT;

/** A name as stored: trimmed and in NFC, 1 to 50 characters, on one line, not "none". */
export function checkProjectName(name: string): string {
  const trimmed = name.trim().normalize("NFC");
  if (!trimmed) fail("invalid_argument", "name must not be empty");
  if (trimmed.length > PROJECT_LIMITS.name) fail("invalid_argument", `name is longer than ${PROJECT_LIMITS.name} characters`);
  if (/\p{Cc}/u.test(trimmed)) fail("invalid_argument", "name must be one line without control characters");
  if (isNone(trimmed)) fail("invalid_argument", `"${NO_PROJECT}" is reserved: in filters it means tasks without a project`);
  return trimmed;
}

const EMOJI_COMPONENT = String.raw`(?:\p{Emoji_Modifier_Base}\uFE0F?\p{Emoji_Modifier}|\p{Extended_Pictographic}\uFE0F?)`;
const EMOJI = new RegExp(
  String.raw`^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|${EMOJI_COMPONENT}(?:\u200D${EMOJI_COMPONENT})*)$`,
  "u",
);

/** The icon as stored: one emoji (up to 16 UTF-16 code units, no spaces); empty = none. */
export function checkIcon(icon: string): string | undefined {
  const value = icon.trim();
  if (value === "") return undefined;
  if (value.length > PROJECT_LIMITS.icon || !EMOJI.test(value)) {
    fail("invalid_argument", `icon must be a single emoji (up to ${PROJECT_LIMITS.icon} UTF-16 code units, no spaces)`);
  }
  return value;
}

/** The note as stored: up to 2000 characters; blank = none. */
export function checkProjectNote(note: string): string | undefined {
  if (note.length > PROJECT_LIMITS.note) fail("invalid_argument", `note is longer than ${PROJECT_LIMITS.note} characters`);
  return note.trim() === "" ? undefined : note;
}

export function checkPosition(position: number): number {
  if (!Number.isFinite(position) || Math.abs(position) > PROJECT_LIMITS.position) {
    fail("invalid_argument", `position must be a number from -${PROJECT_LIMITS.position} to ${PROJECT_LIMITS.position}`);
  }
  return position;
}

function checkNameFree(taken: Doc<"projects"> | null | undefined) {
  if (taken) fail("invalid_argument", `A project named "${taken.name}" already exists${taken.archivedAt !== undefined ? " (archived)" : ""}`);
}

// ---- Reading ----

/** A project as returned to clients: stable `id`, `archived` spelled out, no internal fields. */
export function toProject(doc: Doc<"projects">) {
  const { _id, _creationTime, userId, nameKey, ...fields } = doc;
  return { id: _id, ...fields, archived: doc.archivedAt !== undefined };
}
export type ProjectView = ReturnType<typeof toProject>;

/** Every project of the user, archived ones included, in menu order. */
export async function allProjects(ctx: QueryCtx, userId: string): Promise<Doc<"projects">[]> {
  return ctx.db
    .query("projects")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

/** The user's project with this name (any case), if any. */
export async function projectNamed(ctx: QueryCtx, userId: string, name: string): Promise<Doc<"projects"> | null> {
  return ctx.db
    .query("projects")
    .withIndex("by_user_nameKey", (q) => q.eq("userId", userId).eq("nameKey", nameKeyOf(name)))
    .first();
}

/** Loads one of the user's projects by its id or its name (any case). */
export async function loadProject(ctx: QueryCtx, userId: string, ref: string): Promise<Doc<"projects">> {
  const id = ctx.db.normalizeId("projects", ref);
  const byId = id ? await ctx.db.get(id) : null;
  if (byId && byId.userId === userId) return byId;
  const byName = await projectNamed(ctx, userId, ref);
  if (!byName) fail("not_found", `Project "${ref.trim().slice(0, 100)}" not found`);
  return byName;
}

/**
 * The project a task goes into: a project, or undefined for "none". An archived
 * project takes no task, except the one the task is already in.
 */
export async function projectTarget(ctx: QueryCtx, userId: string, ref: string, current?: Id<"projects">): Promise<Id<"projects"> | undefined> {
  if (isNone(ref)) return undefined;
  const project = await loadProject(ctx, userId, ref);
  if (project.archivedAt !== undefined && project._id !== current) fail("invalid_argument", `Project "${project.name}" is archived; restore it first`);
  return project._id;
}

/** A filter on the project: tasks of one project, tasks without a project ("none"), or every task. */
export async function projectFilter(ctx: QueryCtx, userId: string, ref: string | undefined): Promise<(task: Doc<"tasks">) => boolean> {
  if (ref === undefined) return () => true;
  if (isNone(ref)) return (task) => task.projectId === undefined;
  const { _id } = await loadProject(ctx, userId, ref);
  return (task) => task.projectId === _id;
}

type Counts = { open: number; overdue: number; dueToday: number; done: number };

/** In the plan, as the counts see it: not archived, not in the trash, not a proposal. */
const counted = (task: Doc<"tasks">) => task.archivedAt === undefined && task.deletedAt === undefined && task.proposedAt === undefined;

/**
 * list_projects: the projects in menu order (archived ones with includeArchived),
 * each with the counts of its tasks, and the same for tasks without a project.
 * Open tasks are not done; overdue and dueToday count open tasks only.
 */
export async function listProjects(ctx: QueryCtx, identity: Identity, input: Args<"listProjects">) {
  const today = localDate(input.at ?? Date.now(), (await loadSettings(ctx, identity.userId)).timezone);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const counts = new Map<string, Counts>();
  const countsOf = (key: string) => counts.get(key) ?? { open: 0, overdue: 0, dueToday: 0, done: 0 };
  for (const task of tasks.filter(counted)) {
    const key = task.projectId ?? NO_PROJECT;
    const c = countsOf(key);
    const open = task.status !== "done";
    counts.set(key, {
      open: c.open + (open ? 1 : 0),
      overdue: c.overdue + (isOverdue(task, today) ? 1 : 0),
      dueToday: c.dueToday + (open && task.dueDate === today ? 1 : 0),
      done: c.done + (open ? 0 : 1),
    });
  }
  const projects = (await allProjects(ctx, identity.userId)).filter((p) => input.includeArchived === true || p.archivedAt === undefined);
  const none = countsOf(NO_PROJECT);
  return {
    result: projects.map((p) => ({ ...toProject(p), counts: countsOf(p._id) })),
    noProject: { open: none.open, overdue: none.overdue },
  };
}

// ---- Changes ----

type TaskRef = { id: Id<"tasks">; ref: number | null };
type SkippedTask = TaskRef & { projectId?: Id<"projects">; reason: string };

const refOf = (task: Doc<"tasks">): TaskRef => ({ id: task._id, ref: task.ref ?? null });

/** The tasks an applied operation moved, from its history entries (a retry answers with them). */
async function movedBy(ctx: QueryCtx, userId: string, clientId: string): Promise<TaskRef[]> {
  const events = await ctx.db
    .query("taskEvents")
    .withIndex("by_user_clientId", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .collect();
  const moved: TaskRef[] = [];
  for (const event of events) {
    const task = event.taskId ? await ctx.db.get(event.taskId) : null;
    if (task) moved.push(refOf(task));
  }
  return moved;
}

/** The project an applied operation changed: a retry answers with its current state. */
async function projectOf(ctx: QueryCtx, event: Doc<"taskEvents">): Promise<Doc<"projects">> {
  const raw = event.after?.projectId ?? event.before?.projectId;
  const id = typeof raw === "string" ? ctx.db.normalizeId("projects", raw) : null;
  const project = id ? await ctx.db.get(id) : null;
  if (!project) fail("not_found", "Project of this operation no longer exists");
  return project;
}

/**
 * Moves the label's tasks that have no project into the project, and takes the
 * label off them with removeLabel. Tasks already in a project stay and are
 * listed as skipped, as are tasks another agent holds a claim on.
 */
async function moveLabel(ctx: MutationCtx, identity: Identity, label: string, projectId: Id<"projects">, removeLabel: boolean, clientId?: string) {
  const tasks = (
    await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect()
  ).filter((t) => t.labels.includes(label));
  const skipped: SkippedTask[] = [];
  const moving: Doc<"tasks">[] = [];
  for (const task of tasks) {
    if (task.projectId !== undefined) {
      skipped.push({ ...refOf(task), projectId: task.projectId, reason: "already in a project" });
      continue;
    }
    try {
      checkClaim(task, identity);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      skipped.push({ ...refOf(task), reason: (error.data as { message: string }).message });
      continue;
    }
    moving.push(task);
  }
  if (moving.length > PROJECT_LIMITS.move) {
    fail("invalid_argument", `Label "${label}" is on ${moving.length} tasks without a project; at most ${PROJECT_LIMITS.move} move at once`);
  }
  for (const task of moving) {
    const patch: Partial<Doc<"tasks">> = removeLabel ? { projectId, labels: task.labels.filter((l) => l !== label) } : { projectId };
    await patchTask(ctx, identity, task, "update", patch, clientId);
  }
  return { moved: moving.map(refOf), skipped };
}

export type NewProject = { name: string; color?: ProjectColor; icon?: string; note?: string; position?: number; archived?: boolean };

/**
 * Checks and stores a new project, at the end of the menu unless `position` is
 * given, with its projectAdd history entry (`extra` adds to what it records).
 */
export async function insertProject(ctx: MutationCtx, identity: Identity, input: NewProject, projects: readonly Doc<"projects">[], clientId?: string, extra: Record<string, unknown> = {}) {
  const name = checkProjectName(input.name);
  checkNameFree(projects.find((project) => project.nameKey === nameKeyOf(name)));
  if (projects.length >= PROJECT_LIMITS.projects) fail("invalid_argument", `at most ${PROJECT_LIMITS.projects} projects, archived ones included; delete one first`);
  const last = projects.reduce((max, p) => Math.max(max, p.position), 0);
  const now = Date.now();
  const fields = {
    name,
    color: input.color,
    icon: input.icon === undefined ? undefined : checkIcon(input.icon),
    note: input.note === undefined ? undefined : checkProjectNote(input.note),
    position: input.position === undefined ? Math.min(last + POSITION_STEP, PROJECT_LIMITS.position) : checkPosition(input.position),
    archivedAt: input.archived ? now : undefined,
  };
  const projectId = await ctx.db.insert("projects", { userId: identity.userId, ...fields, nameKey: nameKeyOf(name), createdAt: now, updatedAt: now, clientId });
  await recordEvent(ctx, identity, { action: "projectAdd", after: { projectId, ...fields, ...extra }, clientId });
  return projectId;
}

/**
 * add_project: a new project at the end of the menu (or at `position`). With
 * fromLabel the label's tasks without a project move into it (moveLabel).
 * Idempotent by clientId: a retry returns the project and the tasks it moved.
 */
export async function addProject(ctx: MutationCtx, identity: Identity, input: Args<"addProject">) {
  const clientId = checkClientId(input.clientId);
  if (clientId !== undefined) {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_user_clientId", (q) => q.eq("userId", identity.userId).eq("clientId", clientId))
      .first();
    if (existing) return { project: toProject(existing), moved: await movedBy(ctx, identity.userId, clientId), skipped: [] as SkippedTask[] };
    if (await appliedOperation(ctx, identity.userId, clientId)) fail("not_found", "Project of this operation no longer exists");
  }
  const label = input.fromLabel === undefined ? undefined : checkLabels([input.fromLabel])[0];
  if (input.fromLabel !== undefined && label === undefined) fail("invalid_argument", "fromLabel must not be empty");
  if (input.removeLabel && label === undefined) fail("invalid_argument", "removeLabel needs fromLabel");
  const { name, color, icon, note, position } = input;
  const from = label === undefined ? {} : { fromLabel: label, removeLabel: input.removeLabel === true };
  const projectId = await insertProject(ctx, identity, { name, color, icon, note, position }, await allProjects(ctx, identity.userId), clientId, from);
  const { moved, skipped } = label === undefined ? { moved: [], skipped: [] } : await moveLabel(ctx, identity, label, projectId, input.removeLabel === true, clientId);
  return { project: toProject((await ctx.db.get(projectId))!), moved, skipped };
}

/** update_project: name, color, icon, note (null clears), position, archived. Idempotent. */
export async function updateProject(ctx: MutationCtx, identity: Identity, input: Args<"updateProject">) {
  const clientId = checkClientId(input.clientId);
  const applied = await appliedOperation(ctx, identity.userId, clientId);
  if (applied) return toProject(await projectOf(ctx, applied));
  const project = await loadProject(ctx, identity.userId, input.projectId);
  const patch: Partial<Doc<"projects">> = {};
  if (input.name !== undefined) {
    const name = checkProjectName(input.name);
    // The same name in another case keeps its key; any other name must be free.
    if (nameKeyOf(name) !== project.nameKey) checkNameFree(await projectNamed(ctx, identity.userId, name));
    patch.name = name;
  }
  if (input.color !== undefined) patch.color = input.color ?? undefined;
  if (input.icon !== undefined) patch.icon = input.icon === null ? undefined : checkIcon(input.icon);
  if (input.note !== undefined) patch.note = input.note === null ? undefined : checkProjectNote(input.note);
  if (input.position !== undefined) patch.position = checkPosition(input.position);
  if (input.archived !== undefined) patch.archivedAt = input.archived ? (project.archivedAt ?? Date.now()) : undefined;
  const { before, after, changed } = diff(project, patch);
  if (!changed) return toProject(project);
  await ctx.db.patch(project._id, { ...patch, ...(patch.name ? { nameKey: nameKeyOf(patch.name) } : {}), updatedAt: Date.now() });
  await recordEvent(ctx, identity, { action: "projectUpdate", before: { projectId: project._id, ...before }, after: { projectId: project._id, ...after }, clientId });
  return toProject((await ctx.db.get(project._id))!);
}

/**
 * delete_project, the owner's alone. When any task points at the project (open,
 * done, archived, in the trash or a proposal), moveTasksTo says where they go:
 * another project or "none"; each moved task gets a history entry. No task is
 * left pointing at a project that is gone, also after a restore from the trash.
 */
export async function deleteProject(ctx: MutationCtx, identity: Identity, input: Args<"deleteProject">) {
  ownerOnly(identity, "delete projects");
  const clientId = checkClientId(input.clientId);
  const applied = await appliedOperation(ctx, identity.userId, clientId);
  if (applied) {
    if (applied.action !== "projectDelete") fail("not_found", "Project of this operation no longer exists");
    return { project: applied.before as ProjectView, moved: await movedBy(ctx, identity.userId, clientId!) };
  }
  const project = await loadProject(ctx, identity.userId, input.projectId);
  const target = input.moveTasksTo === undefined ? undefined : await projectTarget(ctx, identity.userId, input.moveTasksTo);
  if (target === project._id) fail("invalid_argument", `moveTasksTo must be another project or "${NO_PROJECT}"`);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user_project", (q) => q.eq("userId", identity.userId).eq("projectId", project._id))
    .collect();
  if (tasks.length > 0 && input.moveTasksTo === undefined) {
    const trashed = tasks.filter((t) => t.deletedAt !== undefined).length;
    const count = `${tasks.length} task${tasks.length === 1 ? "" : "s"}${trashed ? ` (${trashed} in the trash)` : ""}`;
    fail("precondition_failed", `Project "${project.name}" has ${count}: pass moveTasksTo, a project or "${NO_PROJECT}"`);
  }
  if (tasks.length > PROJECT_LIMITS.move) {
    fail("invalid_argument", `Project "${project.name}" has ${tasks.length} tasks; at most ${PROJECT_LIMITS.move} move at once, move some with update_task first`);
  }
  const view = toProject(project);
  await recordEvent(ctx, identity, { action: "projectDelete", before: view, after: { moveTasksTo: target ?? null }, clientId });
  for (const task of tasks) await patchTask(ctx, identity, task, "update", { projectId: target }, clientId);
  await ctx.db.delete(project._id);
  return { project: view, moved: tasks.map(refOf) };
}
