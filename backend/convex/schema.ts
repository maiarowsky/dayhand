import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { scopeValidator } from "./lib/oauthConfig";
import { webhookEventValidator } from "./lib/webhookEvents";
import {
  acceptanceItemValidator,
  actorValidator,
  approvalOptionValidator,
  checklistItemValidator,
  claimHolderValidator,
  keyKindValidator,
  keyScopeValidator,
  linkValidator,
  policyRuleValidator,
  projectColorValidator,
  proofValidator,
  reminderValidator,
  repeatValidator,
  statusValidator,
  taskSourceValidator,
} from "./lib/validators";

const clientTypeValidator = v.union(v.literal("cimd"), v.literal("dcr"));

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
    // Since 0.5.0, optional so older tasks stay valid. Absent = no checklist.
    checklist: v.optional(v.array(checklistItemValidator)),
    // Absent = the default reminders from settings; [] = no reminders.
    reminders: v.optional(v.array(reminderValidator)),
    // Since 0.10.0, agent work (docs/agent-work.md); all optional so older tasks stay valid.
    // What "done" means; absent = no criteria.
    acceptance: v.optional(v.array(acceptanceItemValidator)),
    // How the work will be done, as free text.
    plan: v.optional(v.string()),
    // What the last complete_task was given to show the work is done.
    proof: v.optional(proofValidator),
    // Tasks that must be done before this one is ready; absent = none.
    dependsOn: v.optional(v.array(v.id("tasks"))),
    // Why the task cannot go on; a blocked task is not ready.
    blockedReason: v.optional(v.string()),
    // A time-boxed claim (claim_task): who works on the task and until when.
    // Kept after it expires until it is released or claimed again.
    claimedBy: v.optional(claimHolderValidator),
    claimExpiresAt: v.optional(v.number()),
    // Since 0.11.0, proposals (docs/agent-work.md#7-the-proposal-inbox): a task an
    // agent or integration proposed stays out of Today, the board, list_all and
    // the calendar until the owner accepts it (the field is then removed).
    proposedAt: v.optional(v.number()),
    // Where the task came from (an alert, an issue); one source makes one task.
    source: v.optional(taskSourceValidator),
    // Who asked for the task: given by the caller, or the agent that added it.
    requestedBy: v.optional(v.string()),
    // Webhooks that get task.returned with the proof when the task closes.
    returnTo: v.optional(v.array(v.id("webhooks"))),
    // A proposal merged into another task (it is then in the trash).
    mergedInto: v.optional(v.id("tasks")),
    // Since 0.13.0: the task's project, at most one (lib/projectOps.ts); absent = no project.
    projectId: v.optional(v.id("projects")),
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
    .index("by_user_proposedAt", ["userId", "proposedAt"])
    .index("by_user_project", ["userId", "projectId"])
    .index("by_deletedAt", ["deletedAt"]),

  // Since 0.13.0: the user's projects (lib/projectOps.ts). A task is in at most
  // one project (tasks.projectId); labels stay free tags across projects. The
  // list is flat, in the order of `position`, with an archive.
  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    // The name trimmed, in NFC and lower case: unique per user, archived projects included.
    nameKey: v.string(),
    color: v.optional(projectColorValidator),
    // One emoji shown instead of the color dot.
    icon: v.optional(v.string()),
    // What the project is about, for people and agents.
    note: v.optional(v.string()),
    // Place in the menu, lowest first; a new project goes last (the highest + 1024).
    position: v.number(),
    // An archived project leaves the menu and the project pickers; its tasks stay where they are.
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Client-generated id that makes project creation idempotent.
    clientId: v.optional(v.string()),
  })
    .index("by_user", ["userId", "position"])
    .index("by_user_nameKey", ["userId", "nameKey"])
    .index("by_user_clientId", ["userId", "clientId"]),

  // Since 0.11.0: which task each outside source made (task.source), so the same
  // alert never makes two tasks. A merged proposal's sources point at the task it
  // was merged into. Removed with the task when the trash is purged.
  taskSources: defineTable({
    userId: v.string(),
    kind: v.string(),
    ref: v.string(),
    taskId: v.id("tasks"),
  })
    .index("by_user_source", ["userId", "kind", "ref"])
    .index("by_task", ["taskId"]),

  // Since 0.11.0: approval requests (request_approval). An agent asks before it
  // does something; the owner picks one of 2 to 4 options on the phone before
  // expiresAt. Dayhand records the decision; acting on it is the agent's job,
  // except for requests made by a tool policy "ask" (source "policy"), which
  // let exactly one matching call through (usedAt).
  approvals: defineTable({
    userId: v.string(),
    taskId: v.optional(v.id("tasks")),
    title: v.string(),
    detail: v.optional(v.string()),
    options: v.array(approvalOptionValidator),
    reversible: v.boolean(),
    expiresAt: v.number(),
    // Who asked: the API key or agent connection, its kind and name.
    requestedBy: v.object({
      actor: actorValidator,
      keyId: v.optional(v.id("apiKeys")),
      connectionId: v.optional(v.id("oauthGrants")),
      name: v.string(),
    }),
    source: v.union(v.literal("agent"), v.literal("policy")),
    // Policy requests: the tool, the SHA-256 of its arguments and what they were.
    tool: v.optional(v.string()),
    argsHash: v.optional(v.string()),
    arguments: v.optional(v.string()),
    usedAt: v.optional(v.number()),
    // The owner's decision.
    decidedAt: v.optional(v.number()),
    optionId: v.optional(v.string()),
    note: v.optional(v.string()),
    decidedBy: v.optional(actorValidator),
    createdAt: v.number(),
    clientId: v.optional(v.string()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_task", ["taskId"])
    .index("by_user_hash", ["userId", "argsHash"]),

  // Since 0.11.0: the owner's switch that pauses every agent (one row per user,
  // absent = agents run). While pausedAt is set, agent keys and agent connections
  // can read but every change they try is refused with agents_paused.
  agentControls: defineTable({
    userId: v.string(),
    pausedAt: v.optional(v.number()),
    pausedBy: v.optional(actorValidator),
    reason: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Since 0.11.0: what one agent key may do with one write tool (or "*", every
  // write tool without its own row). No row = allow.
  toolPolicies: defineTable({
    userId: v.string(),
    keyId: v.id("apiKeys"),
    tool: v.string(),
    rule: policyRuleValidator,
    updatedAt: v.number(),
  })
    .index("by_key_tool", ["keyId", "tool"])
    .index("by_user", ["userId"]),

  // History of every change, signed with who made it.
  taskEvents: defineTable({
    userId: v.string(),
    // Absent for changes that are not about one task (settings, API keys).
    taskId: v.optional(v.id("tasks")),
    actor: actorValidator,
    // The API key behind a cli or agent change, and its name at the time.
    keyId: v.optional(v.id("apiKeys")),
    // The OAuth connection behind an agent change made through a connector.
    connectionId: v.optional(v.id("oauthGrants")),
    actorName: v.optional(v.string()),
    action: v.string(),
    // Changed fields only: values before and after the change.
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    at: v.number(),
    // Id of the client operation that caused this change (idempotency).
    clientId: v.optional(v.string()),
    // Since 0.10.0: position of a task change in the user's activity log
    // (list_events), strictly growing in commit order (lib/activity.ts).
    // Absent on changes that are not about a task, and on task changes from
    // before 0.10.0 until migrations:backfillEventSeqs has run.
    seq: v.optional(v.number()),
  })
    .index("by_task", ["taskId", "at"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_user", ["userId", "at"])
    .index("by_user_seq", ["userId", "seq"]),

  // Last activity log position given per user (taskEvents.seq). Every task
  // change reads and writes it, so positions follow the order changes commit.
  eventCounters: defineTable({
    userId: v.string(),
    lastSeq: v.number(),
  }).index("by_user", ["userId"]),

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
    // Since 0.8.0: read, write or full; absent = full, as every key before.
    scope: v.optional(keyScopeValidator),
    // Since 0.8.0: the key stops working at this time; absent = never.
    expiresAt: v.optional(v.number()),
    // Since 0.8.0: the key that created this one (POST /api/v1/keys); it
    // works only while that key works, so it cannot outlive its revocation.
    parentKeyId: v.optional(v.id("apiKeys")),
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

  // Failed-attempt (and OAuth creation) counters, one row per bucket.
  authLimits: defineTable({
    bucket: v.string(),
    windowStart: v.number(),
    failures: v.number(),
  }).index("by_bucket", ["bucket"]),

  // ---- OAuth for MCP clients such as the Claude apps (docs/oauth.md) ----

  // Clients registered with Dynamic Client Registration; public clients only.
  // Clients identified by a metadata document URL are not stored.
  oauthClients: defineTable({
    clientId: v.string(),
    name: v.string(),
    redirectUris: v.array(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_clientId", ["clientId"])
    .index("by_createdAt", ["createdAt"]),

  // One authorization request from the browser, waiting for the phone (10
  // minutes), then carrying its single-use authorization code (2 minutes).
  oauthRequests: defineTable({
    // The browser's handle on the request: selector + SHA-256 of the secret.
    selector: v.string(),
    secretHash: v.string(),
    // SHA-256 of the code shown in the browser and typed on the phone.
    userCodeHash: v.string(),
    clientId: v.string(),
    clientType: clientTypeValidator,
    clientName: v.string(),
    redirectUri: v.string(),
    state: v.optional(v.string()),
    codeChallenge: v.string(),
    scopes: v.array(scopeValidator),
    resource: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    // Set on the phone: the approving user and what they granted, or a refusal.
    userId: v.optional(v.string()),
    grantedScopes: v.optional(v.array(scopeValidator)),
    approvedAt: v.optional(v.number()),
    deniedAt: v.optional(v.number()),
    // The authorization code (SHA-256), given once to the browser.
    codeHash: v.optional(v.string()),
    codeExpiresAt: v.optional(v.number()),
    codeUsedAt: v.optional(v.number()),
    grantId: v.optional(v.id("oauthGrants")),
  })
    .index("by_selector", ["selector"])
    .index("by_userCodeHash", ["userCodeHash"])
    .index("by_codeHash", ["codeHash"])
    .index("by_expiresAt", ["expiresAt"]),

  // Agent connections: what one approval granted to one client. Revoking a
  // connection stops all its tokens on the next request.
  oauthGrants: defineTable({
    userId: v.string(),
    clientId: v.string(),
    clientType: clientTypeValidator,
    clientName: v.string(),
    redirectUri: v.string(),
    scopes: v.array(scopeValidator),
    resource: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // When the current refresh token expires; the connection ends with it.
    refreshExpiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Access tokens (one hour) and refresh tokens (60 days, rotated on use) of
  // a connection: selector + SHA-256 of the secret.
  oauthTokens: defineTable({
    grantId: v.id("oauthGrants"),
    kind: v.union(v.literal("access"), v.literal("refresh")),
    selector: v.string(),
    secretHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    // A refresh token used once; using it again revokes the connection.
    rotatedAt: v.optional(v.number()),
    // Set when a refresh narrowed the scopes; otherwise the grant's apply.
    scopes: v.optional(v.array(scopeValidator)),
  })
    .index("by_selector", ["selector"])
    .index("by_grant", ["grantId"])
    .index("by_expiresAt", ["expiresAt"]),

  // MCP calls per API key in the current one-minute window, one row per key
  // and kind of call (read or write).
  callLimits: defineTable({
    // One of the two: an API key, or an agent connection (OAuth).
    keyId: v.optional(v.id("apiKeys")),
    connectionId: v.optional(v.id("oauthGrants")),
    kind: v.union(v.literal("read"), v.literal("write")),
    windowStart: v.number(),
    calls: v.number(),
  })
    .index("by_key_kind", ["keyId", "kind"])
    .index("by_connection_kind", ["connectionId", "kind"]),

  // The read-only calendar feed of a user, at most one: GET /cal/<selector><secret>.ics.
  // The secret is kept (not hashed) so the address can be shown again; it
  // only reads the plan stored next to it. A new address replaces the row.
  calendarFeeds: defineTable({
    userId: v.string(),
    selector: v.string(),
    secret: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_selector", ["selector"]),

  // Webhooks (docs/webhooks.md): HTTPS endpoints that get the user's task
  // events, signed per Standard Webhooks. The secret is kept (not hashed)
  // because every delivery is signed with it; it is shown once, at creation.
  webhooks: defineTable({
    userId: v.string(),
    url: v.string(),
    events: v.array(webhookEventValidator),
    description: v.optional(v.string()),
    secret: v.string(),
    createdAt: v.number(),
    // Deliveries in a row that failed on every attempt; the webhook is turned
    // off when it reaches the limit, and a success sets it back to 0.
    failureStreak: v.number(),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    disabledAt: v.optional(v.number()),
    disabledReason: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // One message to one webhook and its attempts: the delivery log.
  webhookDeliveries: defineTable({
    userId: v.string(),
    webhookId: v.id("webhooks"),
    // webhook-id: the same on every retry, so the receiver can drop duplicates.
    eventId: v.string(),
    type: v.string(),
    // The exact body sent (and signed) on every attempt.
    payload: v.string(),
    status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
    attempts: v.array(
      v.object({
        at: v.number(),
        durationMs: v.number(),
        responseStatus: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    nextAttemptAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_webhook", ["webhookId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

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
