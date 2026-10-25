// Backlog.md import and export as domain operations (docs/backlog-md.md).
// import_backlog reads task files (lib/backlogMd.ts) into tasks with the source
// { kind: "backlog-md", ref: <id> }: one source makes one task, so a
// folder imported again brings only what is new. Dependencies are created
// first and point at the tasks they made. export_backlog writes the plan as
// such files, with each status mapped to the nearest Backlog.md status.
import { ConvexError, type ObjectType } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { checkAcceptance, checkCompletion, checkDependsOn, checkLongText, checkProof } from "./agentWork";
import type { args } from "./args";
import {
  BACKLOG_KIND,
  BacklogFormatError,
  DEFAULT_STATUSES,
  placeOf,
  readDate,
  readTask,
  statusesOf,
  statusFor,
  writeConfig,
  writeTask,
  type BacklogFile,
  type BacklogTask,
  type TaskFile,
} from "./backlogMd";
import { checkLabels, checkLinks, checkText, checkTitle, fail, loadSettings, nextTaskRef, recordEvent, toTask, type Identity } from "./core";
import { localDateTime } from "./dates";
import { FrontmatterError } from "./frontmatter";
import { loadProject, projectTarget } from "./projectOps";
import { addSource, checkRequestedBy, checkSource, taskOfSource } from "./proposals";
import type { Link, Status } from "./validators";

type Args<K extends keyof typeof args> = ObjectType<(typeof args)[K]>;

/** Files per call and characters per file. */
export const BACKLOG_LIMITS = { files: 200, content: 100_000, path: 500, prefix: 16 };

type Skipped = { path: string; reason: string; id?: string; title?: string; taskId?: Id<"tasks">; ref?: number };
type Failed = { path: string; title: string | null; message: string };
type Warning = { path: string | null; message: string };

const sourceRef = (ref: string) => ref.toUpperCase();

const SKIP_REASONS: Partial<Record<BacklogTask["place"], string>> = {
  "archived-draft": "an archived draft, not a task",
  doc: "a document, not a task",
  decision: "a decision record, not a task",
  milestone: "a milestone, not a task",
};

// ---- Import ----

/** The files as task files to import, and what was skipped on the way: other files, unreadable ones, an id given twice. */
function readFiles(files: BacklogFile[], skipped: Skipped[], warnings: Warning[]): { tasks: BacklogTask[]; statuses: string[] } {
  let statuses = DEFAULT_STATUSES;
  const config = files.find((f) => placeOf(f.path) === "config");
  if (config) {
    try {
      statuses = statusesOf(config.content);
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error;
      warnings.push({ path: config.path, message: `config.yml could not be read (${error.message}); the default statuses apply` });
    }
  }
  const tasks: BacklogTask[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    if (file === config) continue;
    if (!/\.md$/i.test(file.path)) {
      skipped.push({ path: file.path, reason: "not a Markdown file" });
      continue;
    }
    let task: BacklogTask;
    try {
      task = readTask(file);
    } catch (error) {
      if (!(error instanceof BacklogFormatError)) throw error;
      skipped.push({ path: file.path, reason: error.message });
      continue;
    }
    const why = SKIP_REASONS[task.place];
    const first = seen.get(sourceRef(task.id));
    if (why || first) {
      skipped.push({ path: file.path, reason: why ?? `the same id as ${first}`, id: task.id, title: task.title });
      continue;
    }
    seen.set(sourceRef(task.id), file.path);
    tasks.push(task);
  }
  return { tasks, statuses };
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Dependencies first, else in id order; a cycle is broken where it closes (its tasks come last). */
function inOrder(tasks: BacklogTask[]): BacklogTask[] {
  const pending = [...tasks].sort((a, b) => natural.compare(a.id, b.id));
  const inCall = new Set(pending.map((t) => sourceRef(t.id)));
  const done = new Set<string>();
  const ordered: BacklogTask[] = [];
  while (pending.length) {
    const index = pending.findIndex((t) => t.dependencies.every((d) => !inCall.has(sourceRef(d)) || done.has(sourceRef(d))));
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    done.add(sourceRef(next!.id));
    ordered.push(next!);
  }
  return ordered;
}

/** The task an earlier import made from this id; Backlog.md ids are the same in any case (TASK-1, task-1). */
async function importedBefore(ctx: QueryCtx, userId: string, id: string): Promise<Doc<"tasks"> | null> {
  return taskOfSource(ctx, userId, { kind: BACKLOG_KIND, ref: sourceRef(id) });
}

/** The Dayhand task a Backlog.md id leads to: made in this call, or by an earlier import. */
async function dependencyOf(ctx: QueryCtx, userId: string, id: string, made: Map<string, Id<"tasks">>): Promise<Id<"tasks"> | null> {
  return made.get(sourceRef(id)) ?? (await importedBefore(ctx, userId, id))?._id ?? null;
}

const isUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** The note: the description, then every other section and the references that are not links. */
function noteOf(task: BacklogTask, done: boolean): string | undefined {
  const others = [...task.references.filter((r) => !isUrl(r)), ...task.references.filter(isUrl).slice(20)];
  const parts = [task.description, ...task.extra];
  if (task.finalSummary && !done) parts.push(`## Final Summary\n\n${task.finalSummary}`);
  if (others.length) parts.push(`References:\n${others.map((r) => `- ${r}`).join("\n")}`);
  const note = parts.filter(Boolean).join("\n\n");
  return note === "" ? undefined : checkText("note", note);
}

/** The fields of the new task, checked as add_task checks them, or a domain error. */
function fieldsOf(task: BacklogTask, statuses: string[], identity: Identity, timezone: string, now: number, warnings: Warning[]) {
  const mapped = statusFor(task.status, statuses);
  const status: Status = task.place === "completed" ? "done" : task.place === "draft" ? "todo" : mapped.status;
  if (mapped.guessed) warnings.push({ path: task.path, message: `status "${task.status}" is not one of the project's statuses; read as ${status}` });
  if (task.place === "draft" && mapped.status !== "todo") warnings.push({ path: task.path, message: "a draft becomes a proposal, which starts in todo" });
  const urls = task.references.filter(isUrl);
  const links: Link[] = checkLinks(urls.slice(0, 20).map((url) => ({ url: url.trim() })));
  const proof = status === "done" && task.finalSummary ? checkProof({ summary: task.finalSummary }) : undefined;
  const acceptance = task.acceptance.length ? checkAcceptance(task.acceptance) : undefined;
  // An agent's import keeps the rule of complete_task: a done task with criteria needs them met and a summary.
  if (status === "done") checkCompletion({ acceptance } as Doc<"tasks">, identity, proof);
  return {
    title: checkTitle(task.title),
    note: noteOf(task, status === "done"),
    status,
    isNow: false,
    labels: checkLabels(task.labels),
    links,
    acceptance,
    plan: task.plan === undefined ? undefined : checkLongText("plan", task.plan),
    proof,
    completedAt: status === "done" ? (readDate(task.updated, timezone) ?? now) : undefined,
    archivedAt: task.place === "archived" ? now : undefined,
    proposedAt: task.place === "draft" ? now : undefined,
    requestedBy: checkRequestedBy(identity, undefined, task.place === "draft"),
    source: checkSource({ kind: BACKLOG_KIND, ref: sourceRef(task.id) }),
  };
}

/** Header keys Dayhand has no field for, once for the whole call: "priority (3 files)". */
function droppedWarning(tasks: BacklogTask[]): Warning[] {
  const counts = new Map<string, number>();
  for (const task of tasks) for (const key of task.dropped) counts.set(key, (counts.get(key) ?? 0) + 1);
  if (counts.size === 0) return [];
  const keys = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => `${key} (${n} ${n === 1 ? "file" : "files"})`);
  return [{ path: null, message: `Not carried over, Dayhand has no field for them: ${keys.join(", ")}` }];
}

type Made = { ids: Map<string, Id<"tasks">>; inCall: Set<string> };

async function dependenciesOf(ctx: MutationCtx, userId: string, task: BacklogTask, made: Made, warnings: Warning[]) {
  const ids: Id<"tasks">[] = [];
  for (const dependency of task.dependencies) {
    const id = await dependencyOf(ctx, userId, dependency, made.ids);
    if (id && !ids.includes(id)) ids.push(id);
    if (id) continue;
    const why = made.inCall.has(sourceRef(dependency))
      ? "which is in these files but was not imported before this one (it failed, or the two wait for each other)"
      : "which is neither in these files nor imported before";
    warnings.push({ path: task.path, message: `depends on ${dependency}, ${why}; left out` });
  }
  return checkDependsOn(ctx, userId, null, ids);
}

/** Since 0.13.0, with projectId every new task goes into that project; tasks imported before stay where they are. */
export async function importBacklog(ctx: MutationCtx, identity: Identity, input: Args<"importBacklog"> & { dryRun?: boolean }) {
  if (input.files.length > BACKLOG_LIMITS.files) fail("invalid_argument", `at most ${BACKLOG_LIMITS.files} files per call; import it by subdirectories`);
  for (const file of input.files) {
    if (!file.path.trim() || file.path.length > BACKLOG_LIMITS.path) fail("invalid_argument", `file paths must be 1 to ${BACKLOG_LIMITS.path} characters`);
    if (file.content.length > BACKLOG_LIMITS.content) fail("invalid_argument", `${file.path} is longer than ${BACKLOG_LIMITS.content} characters`);
  }
  const projectId = input.projectId === undefined ? undefined : await projectTarget(ctx, identity.userId, input.projectId);
  const { timezone } = await loadSettings(ctx, identity.userId);
  const now = Date.now();
  const skipped: Skipped[] = [];
  const failed: Failed[] = [];
  const warnings: Warning[] = [];
  const created: ReturnType<typeof toTask>[] = [];
  const { tasks, statuses } = readFiles(input.files, skipped, warnings);
  const made: Made = { ids: new Map(), inCall: new Set(tasks.map((t) => sourceRef(t.id))) };
  for (const task of inOrder(tasks)) {
    const before = await importedBefore(ctx, identity.userId, task.id);
    if (before) {
      made.ids.set(sourceRef(task.id), before._id);
      skipped.push({ path: task.path, reason: "imported before", id: task.id, title: task.title, taskId: before._id, ref: before.ref });
      continue;
    }
    let fields;
    try {
      fields = { ...fieldsOf(task, statuses, identity, timezone, now, warnings), dependsOn: await dependenciesOf(ctx, identity.userId, task, made, warnings), projectId };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      failed.push({ path: task.path, title: task.title, message: (error.data as { message: string }).message });
      continue;
    }
    const ref = await nextTaskRef(ctx, identity.userId);
    const taskId = await ctx.db.insert("tasks", { userId: identity.userId, ref, ...fields, createdAt: now, updatedAt: now });
    await addSource(ctx, identity.userId, fields.source, taskId);
    await recordEvent(ctx, identity, { taskId, action: "import", after: { ...fields, importedFrom: task.path } });
    made.ids.set(sourceRef(task.id), taskId);
    created.push(toTask((await ctx.db.get(taskId))!));
  }
  return {
    format: BACKLOG_KIND,
    dryRun: input.dryRun === true,
    files: input.files.length,
    created: created.length,
    tasks: created,
    skipped,
    failed,
    warnings: [...warnings, ...droppedWarning(tasks)],
  };
}

// ---- Export ----

const PREFIX = /^[A-Za-z][A-Za-z0-9]*$/;
const BACKLOG_ID = /^([A-Za-z][A-Za-z0-9]*)-(\d+(?:\.\d+)*)$/;

/** Each task's Backlog.md id: the one it was imported with, else <PREFIX>-<number> (DRAFT-<number> for a proposal), never one taken. */
function idsOf(tasks: Doc<"tasks">[], prefix: string): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const task of tasks) {
    const ref = task.source?.kind === BACKLOG_KIND ? task.source.ref : undefined;
    if (ref && BACKLOG_ID.test(ref) && !taken.has(ref.toLowerCase())) {
      ids.set(task._id, ref);
      taken.add(ref.toLowerCase());
    }
  }
  const highest = (p: string) =>
    Math.max(0, ...[...taken].map((id) => BACKLOG_ID.exec(id)).filter((m) => m && m[1]!.toLowerCase() === p.toLowerCase()).map((m) => Number(m![2]!.split(".")[0])));
  for (const task of tasks) {
    if (ids.has(task._id)) continue;
    const p = task.proposedAt !== undefined ? "DRAFT" : prefix.toUpperCase();
    let id = `${p}-${task.ref ?? highest(p) + 1}`;
    if (taken.has(id.toLowerCase())) id = `${p}-${highest(p) + 1}`;
    ids.set(task._id, id);
    taken.add(id.toLowerCase());
  }
  return ids;
}

/** The task's own text for the Description: its note, then its checklist. */
function descriptionOf(task: Doc<"tasks">): string | undefined {
  const checklist = task.checklist?.length ? `Checklist:\n${task.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.title}`).join("\n")}` : undefined;
  return [task.note, checklist].filter(Boolean).join("\n\n") || undefined;
}

function summaryOf(task: Doc<"tasks">): string | undefined {
  const proof = task.proof;
  if (!proof) return undefined;
  const lines = [
    proof.summary,
    ...(proof.links ?? []).map((l) => `- ${l.title ? `${l.title}: ` : ""}${l.url}`),
    ...(proof.checks ?? []).map((c) => `- ${c.name}: ${c.result}${c.url ? ` ${c.url}` : ""}`),
  ];
  return lines.filter(Boolean).join("\n") || undefined;
}

function fileOf(task: Doc<"tasks">, ids: Map<string, string>, timezone: string): BacklogFile {
  const status = DEFAULT_STATUSES[task.status === "todo" ? 0 : task.status === "doing" ? 1 : 2]!;
  const notes = [task.resumeNote && `Resume: ${task.resumeNote}`, task.blockedReason && `Blocked: ${task.blockedReason}`].filter(Boolean).join("\n\n");
  const file: TaskFile = {
    id: ids.get(task._id)!,
    place: task.archivedAt !== undefined ? task.proposedAt !== undefined ? "archived-draft" : "archived" : task.proposedAt !== undefined ? "draft" : "task",
    title: task.title,
    status,
    labels: task.labels,
    dependencies: (task.dependsOn ?? []).map((id) => ids.get(id)).filter((id): id is string => id !== undefined),
    references: task.links.map((l) => l.url),
    created: localDateTime(task.createdAt, timezone),
    updated: localDateTime(task.updatedAt, timezone),
    description: descriptionOf(task),
    acceptance: (task.acceptance ?? []).map(({ text, met }) => ({ text, met })),
    plan: task.plan,
    notes: notes || undefined,
    finalSummary: summaryOf(task),
  };
  return writeTask(file);
}

function fileSizeNotes(file: BacklogFile): string[] {
  return file.content.length > BACKLOG_LIMITS.content
    ? [`${file.path}: exported file exceeds Dayhand import limit (${BACKLOG_LIMITS.content} characters); text was not truncated`]
    : [];
}

function overflowNotes(file: BacklogFile & { id: string }): string[] {
  const task = readTask(file);
  const done = statusFor(task.status, DEFAULT_STATUSES).status === "done";
  const checks = [
    () => noteOf(task, done),
    () => done && task.finalSummary ? checkProof({ summary: task.finalSummary }) : undefined,
  ];
  const errors: string[] = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      errors.push((error.data as { message: string }).message);
    }
  }
  return errors.length ? [`${file.id} (${task.title}): exported fields exceed Dayhand import limits (${errors.join("; ")}); text was not truncated`] : [];
}

/** What Backlog.md has no place for, as counts: "3 due dates". */
function exportNotes(tasks: Doc<"tasks">[], ids: Map<string, string>, oneProject: boolean): string[] {
  const count = (test: (t: Doc<"tasks">) => boolean) => tasks.filter(test).length;
  const missing = count((t) => (t.dependsOn ?? []).some((id) => !ids.has(id)));
  const notes = [
    [count((t) => t.dueDate !== undefined), "due date(s) and time(s)"],
    [count((t) => t.repeat !== undefined), "repeat rule(s)"],
    [count((t) => t.reminders !== undefined), "reminder setting(s)"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, what]) => `${n} ${what} left out: Backlog.md has no field for them`);
  const where = oneProject ? "archived, in the trash or in another project" : "archived or in the trash";
  if (missing) notes.push(`${missing} task(s) depend on tasks not exported (${where}); those dependencies are left out`);
  return notes;
}

/** Since 0.13.0, with projectId only that project's tasks, and config.yml carries its name. */
export async function exportBacklog(ctx: QueryCtx, identity: Identity, input: Args<"exportBacklog">) {
  const prefix = input.prefix?.trim() || "task";
  if (!PREFIX.test(prefix) || prefix.length > BACKLOG_LIMITS.prefix) fail("invalid_argument", `prefix is 1 to ${BACKLOG_LIMITS.prefix} letters and digits, starting with a letter`);
  const project = input.projectId === undefined ? undefined : await loadProject(ctx, identity.userId, input.projectId);
  const { timezone } = await loadSettings(ctx, identity.userId);
  const tasks = (
    await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect()
  )
    .filter((t) => t.deletedAt === undefined && (input.includeArchived === true || t.archivedAt === undefined))
    .filter((t) => project === undefined || t.projectId === project._id)
    .sort((a, b) => (a.ref ?? 0) - (b.ref ?? 0));
  const ids = idsOf(tasks, prefix);
  const files = tasks.map((task) => ({ ...fileOf(task, ids, timezone), id: ids.get(task._id)!, taskId: task._id, ref: task.ref ?? null }));
  const labels = [...new Set(tasks.flatMap((t) => t.labels))].sort();
  const config = writeConfig(prefix, labels, project?.name);
  const notes = [...exportNotes(tasks, ids, project !== undefined), ...files.flatMap(overflowNotes), ...files.flatMap(fileSizeNotes), ...fileSizeNotes(config)];
  return { format: BACKLOG_KIND, prefix, total: files.length, config, files, notes };
}
