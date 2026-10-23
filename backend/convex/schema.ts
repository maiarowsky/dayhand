import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { actorValidator, keyKindValidator, linkValidator, repeatValidator, statusValidator } from "./lib/validators";

export default defineSchema({
  tasks: defineTable({
    userId: v.string(),
    // Stable number of the task per user (#42): given once from taskCounters,
    // never reused. Optional only for tasks created before 0.3.0 that the
    // migrations:backfillTaskRefs migration has not reached yet.
    ref: v.optional(v.number()),
    title: v.string(),
    note: v.optional(v.string()),
    // Calendar day in the user's time zone, YYYY-MM-DD.
    dueDate: v.optional(v.string()),
    // Local wall-clock time, HH:MM; only meaningful with dueDate.
    dueTime: v.optional(v.string()),
    status: statusValidator,
    // At most one task per user has isNow === true.
    isNow: v.boolean(),
    // "Where I stopped / next step".
    resumeNote: v.optional(v.string()),
    repeat: v.optional(repeatValidator),
    labels: v.array(v.string()),
    links: v.array(linkValidator),
    completedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    // Soft delete: the task sits in the trash for 30 days, then a cron purges it.
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Client-generated id that makes task creation idempotent.
    clientId: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_user_ref", ["userId", "ref"])
    .index("by_user_status_dueDate", ["userId", "status", "dueDate"])
    .index("by_user_isNow", ["userId", "isNow"])
    .index("by_user_completedAt", ["userId", "completedAt"])
    .index("by_deletedAt", ["deletedAt"]),

  // History of every change, signed with who made it.
  taskEvents: defineTable({
    userId: v.string(),
    // Absent for changes that are not about one task (settings, API keys).
    taskId: v.optional(v.id("tasks")),
    actor: actorValidator,
    // The API key behind a cli or agent change, and its name at the time.
    keyId: v.optional(v.id("apiKeys")),
    actorName: v.optional(v.string()),
    action: v.string(),
    // Changed fields only: values before and after the change.
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    at: v.number(),
    // Id of the client operation that caused this change (idempotency).
    clientId: v.optional(v.string()),
  })
    .index("by_task", ["taskId", "at"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_user", ["userId", "at"]),

  // Last task number given per user; numbers only grow, so a purged task's
  // number is never given again.
  taskCounters: defineTable({
    userId: v.string(),
    lastRef: v.number(),
  }).index("by_user", ["userId"]),

  apiKeys: defineTable({
    userId: v.string(),
    name: v.string(),
    // cli: the user at a terminal; agent: an AI agent. Changes made with the
    // key are recorded with this actor. Keys created before 0.3.0 have no
    // kind until migrations:backfillKeyKinds runs and count as agent.
    kind: v.optional(keyKindValidator),
    // SHA-256 of the key, hex. The key itself is never stored.
    hash: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_user", ["userId"]),

  // One-time codes that pair a phone; valid 10 minutes, used at most once.
  pairingCodes: defineTable({
    userId: v.string(),
    // Public first part of the code, used to find it among active codes.
    selector: v.string(),
    // SHA-256 of the secret part, hex. The code itself is never stored.
    secretHash: v.string(),
    // Who created the code: `API key "<name>"` or `admin`.
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    // Wrong secrets for this selector; the code dies at the limit.
    failedAttempts: v.number(),
  })
    .index("by_selector", ["selector"])
    .index("by_expiresAt", ["expiresAt"]),

  // Paired phones. The device token is long-lived and revocable; the phone
  // exchanges it for short-lived app JWTs at POST /auth/token.
  devices: defineTable({
    userId: v.string(),
    name: v.string(),
    selector: v.string(),
    // SHA-256 of the device token's secret part, hex.
    secretHash: v.string(),
    pairedBy: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_selector", ["selector"])
    .index("by_user", ["userId"]),

  // Failed-attempt counters of unauthenticated endpoints, one row per bucket.
  authLimits: defineTable({
    bucket: v.string(),
    windowStart: v.number(),
    failures: v.number(),
  }).index("by_bucket", ["bucket"]),

  // MCP calls per API key in the current one-minute window, one row per key
  // and kind of call (read or write).
  callLimits: defineTable({
    keyId: v.id("apiKeys"),
    kind: v.union(v.literal("read"), v.literal("write")),
    windowStart: v.number(),
    calls: v.number(),
  }).index("by_key_kind", ["keyId", "kind"]),

  settings: defineTable({
    userId: v.string(),
    timezone: v.string(),
    // HH:MM local time of the morning summary.
    summaryTime: v.string(),
    // Minutes before a timed task's due time; 0 means at the due time.
    defaultReminderMinutes: v.array(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
