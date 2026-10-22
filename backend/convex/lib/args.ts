// Argument validators of every domain operation, shared by the internal
// domain functions, the app layer and the MCP tool schemas.
import { v } from "convex/values";
import { clearable, linkValidator, repeatValidator, statusValidator } from "./validators";

const clientId = v.optional(v.string());
const taskId = v.id("tasks");
const at = v.optional(v.number());

export const args = {
  add: {
    title: v.string(),
    note: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    status: v.optional(v.union(v.literal("todo"), v.literal("doing"))),
    resumeNote: v.optional(v.string()),
    repeat: v.optional(repeatValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
    clientId,
  },
  update: {
    taskId,
    title: v.optional(v.string()),
    note: clearable(v.string()),
    dueDate: clearable(v.string()),
    dueTime: clearable(v.string()),
    resumeNote: clearable(v.string()),
    repeat: clearable(repeatValidator),
    labels: v.optional(v.array(v.string())),
    links: v.optional(v.array(linkValidator)),
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
  listTrash: {},
  board: { doneLimit: v.optional(v.number()), at },
  getTask: { taskId, at },
  exportPlan: { format: v.union(v.literal("markdown"), v.literal("json")), at },
  getSettings: {},
  updateSettings: {
    timezone: v.optional(v.string()),
    summaryTime: v.optional(v.string()),
    defaultReminderMinutes: v.optional(v.array(v.number())),
    clientId,
  },
  revokeApiKey: { keyId: v.id("apiKeys") },
  listApiKeys: {},
  createApiKey: { name: v.string() },
};
