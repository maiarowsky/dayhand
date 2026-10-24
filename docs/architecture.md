# Architecture

## One operations layer, thin identity layers

```
Android app ──(Convex client, JWT)──> convex/app.ts ─┐
                                                      ├─> domain operations (convex/lib/*.ts)
AI agent ──(MCP, API key)──> /mcp (convex/mcp.ts) ───┤      registered as internal functions
Claude app ──(MCP, OAuth access token)──> /mcp ──────┤      in convex/ops.ts
dayhand CLI ──(MCP tools/call, API key)──────────────┤
integration ──(REST /api/v1, API key)──> convex/rest.ts ┘   (same tools, lib/restRoutes.ts)

Android app ──(device token)──> /auth/token ─┐
            ──(pairing code)──> /auth/pair  ─┼─> convex/pairing.ts ──> convex/devices.ts
dayhand CLI ──(API key)──> /devices/* ───────┘

Claude app ──> /.well-known/*, /oauth/* (convex/oauthHttp.ts) ──> convex/oauth.ts
Android app ──(JWT)──> app.lookup/decideConnectionRequest ─┐
dayhand CLI ──(API key)──> /connections* ──────────────────┴──> convex/oauthOwner.ts

calendar app ──(secret address)──> GET /cal/<token>.ics ─┐
Android app ──(JWT)──> app.*CalendarFeed ────────────────┼─> convex/calendarFeeds.ts ──> lib/ical.ts
dayhand CLI ─(API key)─> /calendar/feed* (calendar.ts) ──┘
```

- Domain operations take the acting identity explicitly: `userId` and `actor` (`app`, `cli` or
  `agent`), plus `keyId` and `actorName` for changes made with an API key. They are exposed as
  Convex **internal** functions (`convex/ops.ts`), so no client can call them directly.
- `convex/app.ts` takes `userId` from the signed-in user (`ctx.auth`) and sets `actor: "app"`.
- `convex/mcp.ts` takes `userId` from the personal API key and sets `actor` to the key's kind
  (`cli` or `agent`), `actorName` to its name and `keyId` to its id; for an OAuth access token
  it sets `actor: "agent"`, `actorName` to the client's name and `connectionId` to the
  connection, and allows only the tools of the token's scopes ([oauth.md](oauth.md)). Arguments that try to set
  any of these are rejected. The `/devices/*` endpoints do the same. Around it:
  `lib/mcpTools.ts` (tool catalog, input schemas from the validators, output schemas from
  `docs/schemas` via the generated `lib/outputSchemas.ts`, behaviour hints),
  `lib/mcpContent.ts` (resources and prompts, read through the same internal queries) and
  `lib/mcpProtocol.ts` (the 2025 and 2026-07-28 protocol eras on one endpoint).
- `dryRun` exists only on the MCP layer: the internal mutation runs the operation, every check
  included, then throws its result, so Convex rolls the transaction back (`convex/ops.ts`).
- The CLI is an MCP client too, so app, agent and CLI run exactly the same code.
- `convex/rest.ts` is the REST API ([api.md](api.md)): each route of `lib/restRoutes.ts` names
  the MCP tool it runs, so it calls the same internal function with the same arguments. It adds
  only HTTP: problem details (`lib/problem.ts`), `Idempotency-Key` as `clientId`, `ETag` and
  `If-Match` (checked inside the mutation, `ops.ts`), `X-RateLimit-*` from the same per-key
  counters as `/mcp`. `lib/openapi.ts` builds the OpenAPI 3.1 document from the same table,
  validators and `docs/schemas`; `lib/toolResults.ts` holds the result and error shapes both
  surfaces share.
- Webhooks: `recordEvent` (`lib/core.ts`), which every change of a task goes through, also
  queues a message for each live webhook of the user that wants its type
  (`lib/webhookEvents.ts`), in the same transaction, so a rolled-back change (a dry run, an
  error) sends nothing. `convex/webhooks.ts` delivers it from the scheduler, signed per Standard
  Webhooks (`lib/webhookSign.ts`), to an address checked against SSRF (`lib/webhookTarget.ts`),
  and retries it with the same `webhook-id`.

## Data model (`convex/schema.ts`)

| Table | Purpose |
|---|---|
| `tasks` | `ref` (the user's task number), `title`, `note`, `dueDate` (YYYY-MM-DD), optional `dueTime` (HH:MM), `status` (`todo`/`doing`/`done`), `isNow`, `resumeNote`, `repeat`, `labels`, `links`, `checklist` (items `id`, `title`, `done`), `reminders` (own reminders; absent = the defaults), `completedAt`, `archivedAt`, `deletedAt`, `createdAt`, `updatedAt`, `clientId` |
| `taskEvents` | History: `actor`, `keyId` or `connectionId` and `actorName` (the API key or agent connection behind a `cli` or `agent` change), `action`, changed fields `before` and `after`, `at`, `clientId` |
| `taskCounters` | Last task number given per user (`lastRef`) |
| `apiKeys` | `name`, `kind` (`cli` or `agent`), `scope` (`read`, `write` or `full`; absent = `full`), `expiresAt`, `parentKeyId` (the key that created it through `/api/v1/keys`), SHA-256 `hash` of the key, `createdAt`, `revokedAt` |
| `pairingCodes` | One-time pairing codes: public `selector`, SHA-256 `secretHash` of the secret part, `createdBy`, `expiresAt` (10 minutes), `usedAt`, `failedAttempts` |
| `devices` | Paired phones: `name`, token `selector`, SHA-256 `secretHash`, `pairedBy`, `createdAt`, `lastUsedAt`, `revokedAt` |
| `authLimits` | Fixed-window counters, one row per bucket: failed `POST /auth/pair` attempts, and the OAuth limits (`oauth:*`: requests per client, registrations, wrong codes typed on the phone) |
| `callLimits` | MCP calls per API key or agent connection in the current one-minute window: `keyId` or `connectionId`, `kind` (`read` or `write`), `windowStart`, `calls` |
| `oauthClients` | Clients from Dynamic Client Registration: `clientId` (`helmc_…`), `name`, `redirectUris`, `createdAt`, `lastUsedAt` (clients with a metadata document URL are not stored) |
| `oauthRequests` | Authorization requests waiting for the phone: browser handle `selector` + `secretHash`, SHA-256 of the code shown (`userCodeHash`), client, `redirectUri`, `state`, PKCE `codeChallenge`, `scopes`, `resource`, then the decision (`userId`, `grantedScopes`, `approvedAt`/`deniedAt`) and the single-use authorization code (`codeHash`, `codeExpiresAt`, `codeUsedAt`) |
| `oauthGrants` | Agent connections: `userId`, client (`clientId`, `clientType`, `clientName`), `redirectUri`, `scopes`, `resource`, `createdAt`, `lastUsedAt`, `refreshExpiresAt`, `revokedAt` |
| `oauthTokens` | Access and refresh tokens of a connection: `kind`, `selector`, SHA-256 `secretHash`, `expiresAt`, `rotatedAt` (refresh), `scopes` (after a narrowing refresh) |
| `calendarFeeds` | The read-only calendar feed, at most one per user: `selector` and `secret` of the address `/cal/<selector><secret>.ics` (the secret is kept so the address can be shown again, [calendar.md](calendar.md#threat-model)), `createdAt` |
| `webhooks` | HTTPS endpoints for task events ([webhooks.md](webhooks.md)): `url`, `events`, `description`, signing `secret` (`whsec_…`, kept to sign), `failureStreak`, `lastSuccessAt`, `lastFailureAt`, `disabledAt`, `disabledReason` |
| `webhookDeliveries` | The delivery log: one message to one webhook, `eventId` (the `webhook-id`, the same on every retry), `type`, the exact `payload`, `status` (`pending`, `succeeded`, `failed`), `attempts` (time, duration, HTTP status or error), `nextAttemptAt`, `finishedAt`; 30 days |
| `settings` | `timezone` (default `Europe/London`), `summaryTime` (default `05:00`), `defaultReminderMinutes` (default `[0]`) |

## Rules

- **Today and overdue.** "Today" is the calendar date in the user's time zone. A task is
  overdue when it is not done, not archived, not in the trash and its `dueDate` is before
  today. This is decided in one place, `convex/lib/dates.ts` (`localDate`, `isOverdue`).
  Views accept an optional `at` (Unix ms) so clients can re-evaluate after midnight;
  Convex caches queries, so a subscribed client should pass the current time.
- **One now task.** `setNow` clears `isNow` on every other task of the user and moves the
  chosen task to `doing`. Leaving `doing`, completing, archiving or deleting clears it.
- **Repeat.** Completing a repeating task creates the next occurrence: the first date of the
  series after the due date that is also after today (a late completion does not create an
  overdue task), or, for a rule counted from completion, the first date after today. A series
  ends with `until` or `count`. The logic is one pure module, `convex/lib/repeat.ts`: `advance`
  for completing and `occurrences` for listing a series ahead; `convex/lib/rrule.ts` maps rules
  to and from RFC 5545 RRULE ([mcp.md](mcp.md#repeat-rules)). The Android app has the same
  logic in `domain/Recurrence.kt`.
- **Trash.** `softDelete` sets `deletedAt`; `restore` clears it. A daily cron
  (`convex/crons.ts`, 03:30 UTC) permanently removes tasks deleted more than 30 days ago,
  with their history.
- **Task numbers.** Adding a task (and a repeat's next occurrence) takes the next number from
  the user's `taskCounters` row. Numbers only grow, so a purged task's number is never given
  again. Every operation that takes a `taskId` also accepts `"#<number>"`.
- **History.** Every change writes a `taskEvents` row with the actor and only the changed
  fields. History is shown as `app`, `cli` or `agent: <key or client name>`. Settings, API key and device changes are recorded without a task id.
- **Idempotency.** Every mutation accepts an optional `clientId`. Adding a task with a
  `clientId` that already exists returns the existing task; any other operation whose
  `clientId` is already in the history is not applied again. The Android outbox relies on this.

## Authentication

- **Agent and CLI:** personal API keys (`dayhand_` + 32 random bytes, base64url), each with a
  name and a kind (`cli` or `agent`, default `agent`) that becomes the actor of its changes. Keys are generated in an
  action (mutations have a deterministic random source), shown once, and stored as SHA-256 only.
  A missing, wrong or revoked key gets HTTP 401. Each key may make 120 reads and 60 changes a
  minute over MCP (`convex/callLimits.ts`); a call over the limit is refused before it runs.
- **Agent connections (OAuth 2.1):** the Claude apps and other MCP clients get an access token
  (`helmat_…`, one hour) and a rotating refresh token (`helmrt_…`, 60 days) through an
  authorization code with PKCE, after the owner approves the request on the paired phone by the
  code its sign-in page shows. Tokens are selector + secret, stored as SHA-256, bound to
  `<issuer>/mcp`, and stop at once when the connection is revoked. Protocol and limits:
  [oauth.md](oauth.md); threats: [oauth-threat-model.md](oauth-threat-model.md).
- **App:** a custom ES256 JWT. The deployment trusts the public key given in `DAYHAND_JWKS`
  (a JWKS `data:` URI) for issuer `DAYHAND_JWT_ISSUER`, audience `helm`; `userId` is the token
  identifier `<issuer>|<subject>`. The deployment itself signs these tokens with
  `DAYHAND_JWT_PRIVATE_JWK`, an environment variable read only by `POST /auth/token`
  (`convex/lib/appToken.ts`); it checks that the key matches `DAYHAND_JWKS` and answers `503`
  when it does not.
- **Pairing:** `dayhand pair` (or the admin) creates a one-time code, valid 10 minutes. The phone
  exchanges it at `POST /auth/pair` for a long-lived, revocable device token, and the device
  token at `POST /auth/token` for an app JWT valid one hour. Codes and device tokens are
  selector + secret; only SHA-256 of the secret is stored and compared in constant time.
  Pairing failures are limited per deployment. `dayhand devices` and `dayhand revoke` manage
  devices; a revoked device gets no new JWTs. Protocol: [pairing.md](pairing.md); deployment
  and key migration: [deploy.md](deploy.md).
- **Tokens by hand:** `scripts/jwt.mjs` creates a key pair and tokens for tests;
  `scripts/app-token.mjs` (`npm run app-token`) signs a long-lived token from a key file for
  scripts and local development. The Android app pairs instead (version 0.2 took such a
  token pasted, and keeps one stored until the phone is paired).

## Reminders

Reminders and the morning summary are computed on the phone, not on the server: the server
stores only the settings (`summaryTime`, `defaultReminderMinutes`) and each task's own
`reminders` (which replace the defaults for that task), and the Android app arms AlarmManager
from its Room copy of the tasks, in the time zone from these settings. See
[android/README.md](../android/README.md#reminders-and-the-morning-summary).
