# Architecture

## One operations layer, thin identity layers

```
Android app ──(Convex client, JWT)──> convex/app.ts ─┐
                                                      ├─> domain operations (convex/lib/*.ts)
AI agent ──(MCP, API key)──> /mcp (convex/mcp.ts) ───┤      registered as internal functions
helm CLI ──(MCP tools/call, API key)─────────────────┘      in convex/ops.ts

Android app ──(device token)──> /auth/token ─┐
            ──(pairing code)──> /auth/pair  ─┼─> convex/pairing.ts ──> convex/devices.ts
helm CLI ──(API key)──> /devices/* ──────────┘
```

- Domain operations take the acting identity explicitly: `userId` and `actor` (`app`, `cli` or
  `agent`), plus `keyId` and `actorName` for changes made with an API key. They are exposed as
  Convex **internal** functions (`convex/ops.ts`), so no client can call them directly.
- `convex/app.ts` takes `userId` from the signed-in user (`ctx.auth`) and sets `actor: "app"`.
- `convex/mcp.ts` takes `userId` from the personal API key and sets `actor` to the key's kind
  (`cli` or `agent`), `actorName` to its name and `keyId` to its id. Arguments that try to set
  any of these are rejected. The `/devices/*` endpoints do the same. Around it:
  `lib/mcpTools.ts` (tool catalog, input schemas from the validators, output schemas from
  `docs/schemas` via the generated `lib/outputSchemas.ts`, behaviour hints),
  `lib/mcpContent.ts` (resources and prompts, read through the same internal queries) and
  `lib/mcpProtocol.ts` (the 2025 and 2026-07-28 protocol eras on one endpoint).
- `dryRun` exists only on the MCP layer: the internal mutation runs the operation, every check
  included, then throws its result, so Convex rolls the transaction back (`convex/ops.ts`).
- The CLI is an MCP client too, so app, agent and CLI run exactly the same code.

## Data model (`convex/schema.ts`)

| Table | Purpose |
|---|---|
| `tasks` | `ref` (the user's task number), `title`, `note`, `dueDate` (YYYY-MM-DD), optional `dueTime` (HH:MM), `status` (`todo`/`doing`/`done`), `isNow`, `resumeNote`, `repeat`, `labels`, `links`, `completedAt`, `archivedAt`, `deletedAt`, `createdAt`, `updatedAt`, `clientId` |
| `taskEvents` | History: `actor`, `keyId` and `actorName` (the API key behind a `cli` or `agent` change), `action`, changed fields `before` and `after`, `at`, `clientId` |
| `taskCounters` | Last task number given per user (`lastRef`) |
| `apiKeys` | `name`, `kind` (`cli` or `agent`), SHA-256 `hash` of the key, `createdAt`, `revokedAt` |
| `pairingCodes` | One-time pairing codes: public `selector`, SHA-256 `secretHash` of the secret part, `createdBy`, `expiresAt` (10 minutes), `usedAt`, `failedAttempts` |
| `devices` | Paired phones: `name`, token `selector`, SHA-256 `secretHash`, `pairedBy`, `createdAt`, `lastUsedAt`, `revokedAt` |
| `authLimits` | Failed-attempt counter of `POST /auth/pair` (one row per bucket) |
| `callLimits` | MCP calls per API key in the current one-minute window: `keyId`, `kind` (`read` or `write`), `windowStart`, `calls` |
| `settings` | `timezone` (default `Europe/London`), `summaryTime` (default `05:00`), `defaultReminderMinutes` (default `[0]`) |

## Rules

- **Today and overdue.** "Today" is the calendar date in the user's time zone. A task is
  overdue when it is not done, not archived, not in the trash and its `dueDate` is before
  today. This is decided in one place, `convex/lib/dates.ts` (`localDate`, `isOverdue`).
  Views accept an optional `at` (Unix ms) so clients can re-evaluate after midnight;
  Convex caches queries, so a subscribed client should pass the current time.
- **One now task.** `setNow` clears `isNow` on every other task of the user and moves the
  chosen task to `doing`. Leaving `doing`, completing, archiving or deleting clears it.
- **Repeat.** Completing a repeating task creates the next occurrence: the first date after
  the due date that is also after today (a late completion does not create an overdue task).
- **Trash.** `softDelete` sets `deletedAt`; `restore` clears it. A daily cron
  (`convex/crons.ts`, 03:30 UTC) permanently removes tasks deleted more than 30 days ago,
  with their history.
- **Task numbers.** Adding a task (and a repeat's next occurrence) takes the next number from
  the user's `taskCounters` row. Numbers only grow, so a purged task's number is never given
  again. Every operation that takes a `taskId` also accepts `"#<number>"`.
- **History.** Every change writes a `taskEvents` row with the actor and only the changed
  fields. History is shown as `app`, `cli` or `agent: <key name>`. Settings, API key and device changes are recorded without a task id.
- **Idempotency.** Every mutation accepts an optional `clientId`. Adding a task with a
  `clientId` that already exists returns the existing task; any other operation whose
  `clientId` is already in the history is not applied again. The Android outbox relies on this.

## Authentication

- **Agent and CLI:** personal API keys (`helm_` + 32 random bytes, base64url), each with a
  name and a kind (`cli` or `agent`, default `agent`) that becomes the actor of its changes. Keys are generated in an
  action (mutations have a deterministic random source), shown once, and stored as SHA-256 only.
  A missing, wrong or revoked key gets HTTP 401. Each key may make 120 reads and 60 changes a
  minute over MCP (`convex/callLimits.ts`); a call over the limit is refused before it runs.
- **App:** a custom ES256 JWT. The deployment trusts the public key given in `HELM_JWKS`
  (a JWKS `data:` URI) for issuer `HELM_JWT_ISSUER`, audience `helm`; `userId` is the token
  identifier `<issuer>|<subject>`. The deployment itself signs these tokens with
  `HELM_JWT_PRIVATE_JWK`, an environment variable read only by `POST /auth/token`
  (`convex/lib/appToken.ts`); it checks that the key matches `HELM_JWKS` and answers `503`
  when it does not.
- **Pairing:** `helm pair` (or the admin) creates a one-time code, valid 10 minutes. The phone
  exchanges it at `POST /auth/pair` for a long-lived, revocable device token, and the device
  token at `POST /auth/token` for an app JWT valid one hour. Codes and device tokens are
  selector + secret; only SHA-256 of the secret is stored and compared in constant time.
  Pairing failures are limited per deployment. `helm devices` and `helm revoke` manage
  devices; a revoked device gets no new JWTs. Protocol: [pairing.md](pairing.md); deployment
  and key migration: [deploy.md](deploy.md).
- **Tokens by hand:** `scripts/jwt.mjs` creates a key pair and tokens for tests;
  `scripts/app-token.mjs` (`npm run app-token`) signs a long-lived token from a key file for
  scripts and local development. The Android app pairs instead (version 0.2 took such a
  token pasted, and keeps one stored until the phone is paired).

## Reminders

Reminders and the morning summary are computed on the phone, not on the server: the server
stores only the settings (`summaryTime`, `defaultReminderMinutes`), and the Android app arms
AlarmManager from its Room copy of the tasks, in the time zone from these settings. See
[android/README.md](../android/README.md#reminders-and-the-morning-summary).
