// Argument validators of every domain operation, shared by the internal
// domain functions, the app layer and the MCP tool schemas.
import { v } from "convex/values";
import {
  checklistInputValidator,
  clearable,
  keyKindValidator,
  linkValidator,
  reminderValidator,
  repeatInputValidator,
  statusValidator,
} from "./validators";

const clientId = v.optional(v.string());
// A task id, or the task's number written as "#42".
const taskId = v.string();
const at = v.optional(v.number());

export const args = {
  add: {
    title: v.string(),
    note: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    status: v.optional(v.union(v.literal("todo"), v.literal("doing"))),
    resumeNote: v.optional(v.string()),
    repeat: v.optional(repeatInputValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
    checklist: v.optional(v.array(checklistInputValidator)),
    reminders: v.optional(v.array(reminderValidator)),
    clientId,
  },
  update: {
    taskId,
    title: v.optional(v.string()),
    note: clearable(v.string()),
    dueDate: clearable(v.string()),
    dueTime: clearable(v.string()),
    resumeNote: clearable(v.string()),
    repeat: clearable(repeatInputValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
    checklist: clearable(v.array(checklistInputValidator)),
    reminders: clearable(v.array(reminderValidator)),
    clientId,
  },
  setStatus: { taskId, status: statusValidator, clientId },
  setNow: { taskId: v.union(taskId, v.null()), resumeNote: v.optional(v.string()), clientId },
  complete: { taskId, clientId },
  reschedule: { taskId, dueDate: v.union(v.string(), v.null()), dueTime: clearable(v.string()), clientId },
  archive: { taskId, clientId },
  softDelete: { taskId, clientId },
  restore: { taskId, clientId },
  listToday: { at },
  listAll: {
    labels: v.optional(v.array(v.string())),
    includeDone: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    at,
  },
  // list_all through MCP: listAll plus search, filters and pages.
  findTasks: {
    labels: v.optional(v.array(v.string())),
    includeDone: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    query: v.optional(v.string()),
    status: v.optional(v.array(statusValidator)),
    dueBefore: v.optional(v.string()),
    dueAfter: v.optional(v.string()),
    overdue: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    at,
  },
  listTrash: {},
  board: { doneLimit: v.optional(v.number()), at },
  getTask: { taskId, at },
  exportPlan: { format: v.union(v.literal("markdown"), v.literal("json"), v.literal("ics")), at },
  getSettings: {},
  updateSettings: {
    timezone: v.optional(v.string()),
    summaryTime: v.optional(v.string()),
    defaultReminderMinutes: v.optional(v.array(v.number())),
    clientId,
  },
  revokeApiKey: { keyId: v.id("apiKeys") },
  listApiKeys: {},
  createApiKey: { name: v.string(), kind: v.optional(keyKindValidator) },
};

// Only the MCP endpoint offers a dry run: the app always applies its changes.
export const dryRunArgs = { dryRun: v.optional(v.boolean()) };

/** Code of the error that rolls a dry run back; its data carries the result the change would have had. */
export const DRY_RUN_CODE = "dry_run";
