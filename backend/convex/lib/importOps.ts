// Import as a domain operation (docs/api.md#import): tasks read from a file
// (lib/importFormats.ts) are checked by the same rules as add_task and stored
// with an "import" history entry. Each task's clientId comes from where it was
// in the file, so importing the same file again skips what is already here.
// A task that fails its checks is reported and the others are imported.
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  checkChecklist,
  checkDueDate,
  checkDueTime,
  checkLabels,
  checkLinks,
  checkReminders,
  checkRepeat,
  checkSchedule,
  checkText,
  checkTitle,
  fail,
  loadSettings,
  nextTaskRef,
  recordEvent,
  toTask,
  type Identity,
} from "./core";
import { localDate } from "./dates";
import {
  checklistInputValidator,
  linkValidator,
  reminderValidator,
  repeatInputValidator,
  statusValidator,
} from "./validators";

/** Tasks per call; the REST layer sends a large file in several calls. */
export const IMPORT_BATCH = 200;

export const importItemValidator = v.object({
  /** Where the task was in the file (a hash); its clientId is "import:<key>". */
  key: v.string(),
  originalId: v.optional(v.string()),
  ref: v.optional(v.number()),
  title: v.string(),
  note: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  dueTime: v.optional(v.string()),
  status: v.optional(statusValidator),
  resumeNote: v.optional(v.string()),
  repeat: v.optional(repeatInputValidator),
  labels: v.optional(v.array(v.string())),
  links: v.optional(v.array(linkValidator)),
  checklist: v.optional(v.array(checklistInputValidator)),
  reminders: v.optional(v.array(reminderValidator)),
  completedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
});
export type ImportTask = Infer<typeof importItemValidator>;

export const importArgs = { items: v.array(importItemValidator) };

type Outcome = {
  created: ReturnType<typeof toTask>[];
  skipped: { title: string; reason: string }[];
  failed: { title: string; message: string }[];
};

/** The task's fields as add_task would store them, or a domain error. */
function checkedFields(item: ImportTask, timezone: string, today: string, now: number) {
  const dueDate = item.dueDate === undefined ? undefined : checkDueDate(item.dueDate, today);
  const dueTime = item.dueTime === undefined ? undefined : checkDueTime(item.dueTime);
  checkSchedule(dueDate, dueTime);
  const status = item.status ?? "todo";
  return {
    title: checkTitle(item.title),
    note: item.note === undefined ? undefined : checkText("note", item.note),
    dueDate,
    dueTime,
    status,
    isNow: false,
    resumeNote: item.resumeNote === undefined ? undefined : checkText("resumeNote", item.resumeNote),
    repeat: item.repeat === undefined ? undefined : checkRepeat(item.repeat, timezone),
    labels: checkLabels(item.labels ?? []),
    links: checkLinks(item.links ?? []),
    checklist: item.checklist === undefined ? undefined : checkChecklist(item.checklist),
    reminders: item.reminders === undefined ? undefined : checkReminders(item.reminders),
    completedAt: status === "done" ? (item.completedAt ?? now) : undefined,
    archivedAt: item.archivedAt,
  };
}

/** The number from the export when this deployment never gave it to this user (numbers are never reused), else the next one. */
async function taskRef(ctx: MutationCtx, userId: string, wanted: number | undefined): Promise<number> {
  const counter = await ctx.db
    .query("taskCounters")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const last = counter?.lastRef ?? 0;
  if (wanted === undefined || !Number.isInteger(wanted) || wanted <= last) return nextTaskRef(ctx, userId);
  if (counter) await ctx.db.patch(counter._id, { lastRef: wanted });
  else await ctx.db.insert("taskCounters", { userId, lastRef: wanted });
  return wanted;
}

/** Why a task is already here, or null. */
async function alreadyHere(ctx: MutationCtx, userId: string, item: ImportTask, clientId: string): Promise<string | null> {
  const imported = await ctx.db
    .query("tasks")
    .withIndex("by_user_clientId", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .first();
  if (imported) return "imported before";
  const id = item.originalId === undefined ? null : ctx.db.normalizeId("tasks", item.originalId);
  const original: Doc<"tasks"> | null = id ? await ctx.db.get(id) : null;
  return original && original.userId === userId ? "the task itself is here (same id)" : null;
}

export async function importTasks(ctx: MutationCtx, identity: Identity, input: { items: ImportTask[] }) {
  if (input.items.length > IMPORT_BATCH) fail("invalid_argument", `at most ${IMPORT_BATCH} tasks per call`);
  const { timezone } = await loadSettings(ctx, identity.userId);
  const now = Date.now();
  const today = localDate(now, timezone);
  const outcome: Outcome = { created: [], skipped: [], failed: [] };
  for (const item of input.items) {
    const clientId = `import:${item.key}`;
    if (item.key === "" || clientId.length > 128) fail("invalid_argument", "key must be 1 to 120 characters");
    const reason = await alreadyHere(ctx, identity.userId, item, clientId);
    if (reason) {
      outcome.skipped.push({ title: item.title, reason });
      continue;
    }
    let fields;
    try {
      fields = checkedFields(item, timezone, today, now);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      outcome.failed.push({ title: item.title, message: (error.data as { message: string }).message });
      continue;
    }
    const ref = await taskRef(ctx, identity.userId, item.ref);
    const taskId = await ctx.db.insert("tasks", { userId: identity.userId, ref, ...fields, createdAt: now, updatedAt: now, clientId });
    await recordEvent(ctx, identity, { taskId, action: "import", after: { ...fields, ...(item.ref !== undefined ? { importedRef: item.ref } : {}) }, clientId });
    outcome.created.push(toTask((await ctx.db.get(taskId))!));
  }
  return outcome;
}
