# Architecture

## One operations layer, thin identity layers

```
Android app ──(Convex client, JWT)──> convex/app.ts ─┐
                                                      ├─> domain operations (convex/lib/*.ts)
AI agent ──(MCP, API key)──> /mcp (convex/mcp.ts) ───┤      registered as internal functions
helm CLI ──(MCP tools/call, API key)─────────────────┘      in convex/ops.ts
```

- Domain operations take the acting identity explicitly: `userId` and `actor` (`app` or `agent`).
  They are exposed as Convex **internal** functions (`convex/ops.ts`), so no client can call
  them directly.
- `convex/app.ts` takes `userId` from the signed-in user (`ctx.auth`) and sets `actor: "app"`.
- `convex/mcp.ts` takes `userId` from the personal API key and sets `actor: "agent"`.
  Arguments that try to set `userId` or `actor` are rejected.
- The CLI is an MCP client too, so app, agent and CLI run exactly the same code.

## Data model (`convex/schema.ts`)

| Table | Purpose |
|---|---|
| `tasks` | `title`, `note`, `dueDate` (YYYY-MM-DD), optional `dueTime` (HH:MM), `status` (`todo`/`doing`/`done`), `isNow`, `resumeNote`, `repeat`, `labels`, `links`, `completedAt`, `archivedAt`, `deletedAt`, `createdAt`, `updatedAt`, `clientId` |
| `taskEvents` | History: `actor`, `action`, changed fields `before` and `after`, `at`, `clientId` |
| `apiKeys` | `name`, SHA-256 `hash` of the key, `createdAt`, `revokedAt` |
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
- **History.** Every change writes a `taskEvents` row with the actor and only the changed
  fields. Settings and API key changes are recorded without a task id.
- **Idempotency.** Every mutation accepts an optional `clientId`. Adding a task with a
  `clientId` that already exists returns the existing task; any other operation whose
  `clientId` is already in the history is not applied again. The Android outbox relies on this.

## Authentication

- **Agent:** personal API keys (`helm_` + 32 random bytes, base64url). Keys are generated in an
  action (mutations have a deterministic random source), shown once, and stored as SHA-256 only.
  A missing, wrong or revoked key gets HTTP 401.
- **App:** a custom ES256 JWT. The deployment trusts the public key given in `HELM_JWKS`
  (a JWKS `data:` URI) for issuer `HELM_JWT_ISSUER`, audience `helm`; `userId` is the token
  identifier `<issuer>|<subject>`. `scripts/jwt.mjs` creates a key pair and tokens for tests;
  `scripts/app-token.mjs` (`npm run app-token`) issues the token that is pasted into the
  Android app. Pairing with a QR code is a later idea, see [pairing.md](pairing.md).
