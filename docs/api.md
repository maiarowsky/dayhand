# REST API

Since backend 0.8.0, Dayhand has a REST API for integrations that do not speak MCP: Shortcuts,
n8n, Home Assistant, a cron script. It lives under `<deployment HTTP actions URL>/api/v1`
(e.g. `https://<name>.convex.site/api/v1`) and is described by an OpenAPI 3.1 document at
[`/api/v1/openapi.json`](#openapi), which needs no key.

The REST API is a thin layer: every task route runs the same domain operation as one MCP tool
([mcp.md](mcp.md#tools)), with the same arguments, the same results and the same error codes.
The route table is `backend/convex/lib/restRoutes.ts`; the dispatcher (`convex/rest.ts`) only
checks the key, counts the call and translates HTTP to the tool's arguments and back. A contract
test (`backend/tests/rest-contract.test.ts`) runs the same steps through MCP and REST and
compares the results.

## Authentication and scopes

Send a personal API key as a Bearer token:

```sh
curl -s https://<name>.convex.site/api/v1/today -H "Authorization: Bearer $DAYHAND_API_KEY"
```

OAuth access tokens of agent connections are bound to `/mcp` (RFC 8707) and get `401` here.

Each route needs a key **scope** ([mcp.md](mcp.md#keys-and-actors)): `read` for `GET` routes,
`write` for changes to tasks and settings, `full` for the account routes (API keys, webhooks,
import). The OpenAPI document gives it per operation as `x-dayhand-scope`; a key with less gets
`403 insufficient_scope`. Give an integration the smallest scope it needs and an expiry date:

```sh
dayhand key create n8n --scope read --expires 90d
```

Changes are recorded in the task history like changes made through MCP: `agent: <key name>`
for an agent key, `cli` for a CLI key.

## Routes

| Method and path | MCP tool | Scope |
|---|---|---|
| `GET /tasks` | `list_all` (query parameters `query`, `status`, `labels`, `dueBefore`, `dueAfter`, `overdue`, `ready`, `includeDone`, `includeArchived`, `limit`, `cursor`, `at`) | read |
| `POST /tasks` | `add_task` (`201`, `Location: /api/v1/tasks/<number>`) | write |
| `GET /tasks/{taskId}` | `get_task`: `{ task, history }` | read |
| `PATCH /tasks/{taskId}` | `update_task` | write |
| `DELETE /tasks/{taskId}` | `delete_task` (to the trash) | write |
| `POST /tasks/{taskId}/complete` | `complete_task` (`{ "proof": { "summary": "…", "checks": [ … ] } }` optional) | write |
| `POST /tasks/{taskId}/status` | `set_status` (`{ "status": "doing" }`) | write |
| `POST /tasks/{taskId}/reschedule` | `reschedule_task` (`{ "dueDate": "2026-11-09", "dueTime": "07:00" }`) | write |
| `POST /tasks/{taskId}/now` | `set_now` (`{ "resumeNote": "…" }` optional) | write |
| `DELETE /now` | `set_now` with `taskId: null` | write |
| `POST /tasks/{taskId}/archive` | `archive_task` | write |
| `POST /tasks/{taskId}/restore` | `restore_task` | write |
| `POST /tasks/{taskId}/claim` | `claim_task` (`{ "minutes": 30 }` optional; `409` while another agent holds it) | write |
| `POST /tasks/{taskId}/claim/renew` | `renew_claim` (`{ "minutes": 30 }` optional) | write |
| `POST /tasks/{taskId}/release` | `release_task` (`{ "note": "…" }` optional) | write |
| `GET /events` | `list_events` (query parameters `since`, `by`, `taskId`, `limit`): the activity log ([agent-work.md](agent-work.md)) | read |
| `GET /today` | `list_today` | read |
| `GET /board` | `board` | read |
| `GET /trash` | `list_trash` | read |
| `GET /export?format=markdown\|json\|ics` | `export_plan` | read |
| `GET /settings`, `PATCH /settings` | `get_settings`, `update_settings` | read, write |
| `GET /keys`, `POST /keys`, `DELETE /keys/{keyId}` | none ([API keys](#api-keys)) | full |
| `GET/POST /webhooks`, `GET/DELETE /webhooks/{webhookId}`, `POST /webhooks/{webhookId}/test`, `POST /webhooks/{webhookId}/enable`, `GET /webhooks/{webhookId}/deliveries` | none ([webhooks.md](webhooks.md)) | full |
| `POST /import` | none ([Import](#import)) | full |
| `GET /openapi.json` | none; no key needed | |

`{taskId}` is the task number (`/tasks/42`) or its id. Bodies are JSON (`Content-Type:
application/json`; `PATCH` also takes `application/merge-patch+json`); a route whose tool takes
no further arguments needs no body. Query parameters are typed as the tool's arguments: lists as
repeated parameters or comma-separated (`status=todo,doing`), booleans as `true`/`false`. An
unknown query parameter or body field is refused (`422`), like an unknown tool argument.

Results are the tool's `structuredContent`: an object as it is, a list or `null` as
`{ "result": … }` (`GET /trash` gives `{ "result": [ … ] }`). The schemas are the ones in
[`docs/schemas/`](schemas/), included in the OpenAPI document.

### Changing a task: PATCH

`PATCH /tasks/{taskId}` is a JSON Merge Patch (RFC 7386) of the task's fields: a field left out
keeps its value, `null` clears it.

```sh
curl -s -X PATCH https://<name>.convex.site/api/v1/tasks/42 \
  -H "Authorization: Bearer $DAYHAND_API_KEY" -H 'Content-Type: application/merge-patch+json' \
  -H 'If-Match: "1793011200000"' \
  -d '{"note": null, "labels": ["work"], "dueDate": "tomorrow"}'
```

One difference from RFC 7386: an object or list value (`repeat`, `labels`, `links`,
`checklist`, `reminders`) replaces the old one as a whole, as `update_task` does; it is not
merged key by key. Status, now, archive and trash have their own routes.

### Pages

`GET /tasks` without `limit` returns every match, as `list_all` does. With `limit` (1 to 200) it
returns a page, `total` (all matches) and `nextCursor`, and a `Link: <…&cursor=…>; rel="next"`
header while there is a next page.

## Idempotency, versions and dry runs

- **`Idempotency-Key`**: a unique id per change (e.g. a UUID), the operation's `clientId`.
  Sending the same change again with the same key does not apply it twice; `POST /tasks` returns
  the task created the first time. A body `clientId` that differs from the header is refused.
- **`ETag` and `If-Match`**: every answer about one task carries `ETag`, the task's version (it
  changes with every change to the task). Send it back in `If-Match` on a change and the change
  applies only while the task is still at that version; otherwise `412 precondition_failed` and
  nothing changes, so a client never overwrites a change it has not seen. `If-Match: *` matches
  any version. A retry of an applied change with the same `Idempotency-Key` still succeeds,
  even though the version has moved on. `GET /tasks/{taskId}` with `If-None-Match` answers `304`
  while the task is unchanged. The version covers the stored task; derived fields such as
  `overdue` (which changes at midnight) are not part of it.
- **`?dryRun=true`** on a change checks it and returns what it would produce, marked
  `"dryRun": true`, without saving anything (`200`, also for `POST /tasks`).

## Errors

Errors are problem details (RFC 9457) with `Content-Type: application/problem+json`. `code`
is the same code an MCP tool error has ([mcp.md](mcp.md#errors)), and `detail` the same message:

```json
{
  "type": "https://schemas.dayhand.invalid/problems/invalid_argument",
  "title": "Invalid argument",
  "status": 422,
  "detail": "dueDate must be YYYY-MM-DD, \"today\" or \"tomorrow\", got \"someday\"",
  "code": "invalid_argument"
}
```

`type` names the code; it is an identifier, not a page to fetch.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_argument` | The body is not JSON, or not a JSON object |
| 401 | `unauthenticated` | No key, or an invalid, expired or revoked key, or an OAuth access token (`WWW-Authenticate: Bearer realm="dayhand"`) |
| 403 | `insufficient_scope` | The key's scope does not cover the route |
| 404 | `not_found` | No such task, key or webhook, or no such route |
| 405 | `method_not_allowed` | The path exists with other methods (`Allow` lists them) |
| 409 | `conflict` | Another agent holds the task's claim (`claim_task`) |
| 412 | `precondition_failed` | `If-Match` does not match the task's version, or the task's state does not allow the change yet (an agent completing a task with unmet acceptance criteria, renewing a claim it does not hold) |
| 413 | `payload_too_large` | A body over 256 KB (2 MB for `POST /import`) |
| 415 | `unsupported_media_type` | A body that is not JSON |
| 422 | `invalid_argument` | Wrong or missing arguments, an unknown field or query parameter, or a change the task's state does not allow |
| 429 | `rate_limited` | Too many calls with this key (`Retry-After`, `retryAfterMs`) |
| 500 | `internal` | Anything unexpected; the detail says only `Internal error` |

New codes may be added in a minor version; treat an unknown code like `internal`.

## Limits

The REST API shares the limits of the key on `/mcp` ([mcp.md](mcp.md#limits)): 120 reads
(`GET`) and 60 changes a minute per key, counted together over both surfaces. Every answer to an
authenticated request carries:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Calls of this kind (reads or changes) a minute |
| `X-RateLimit-Remaining` | Calls of this kind left in the current minute |
| `X-RateLimit-Reset` | When the current minute ends, Unix seconds |

A call over the limit gets `429` with `Retry-After` (seconds) and is not applied.

## API keys

A full key manages keys for integrations:

| Route | What it does |
|---|---|
| `GET /keys` | Every key (`id`, `name`, `kind`, `scope`, `createdAt`, `expiresAt`, `revokedAt`, `createdWith`); never a key or its hash |
| `POST /keys` | `{ "name": "n8n", "scope": "read", "expiresAt": 1798761600000, "kind": "agent" }`: a new key, shown once in `key` (`201`) |
| `DELETE /keys/{keyId}` | Revokes a key; the keys it created stop with it |

A key created this way has scope `read` (the default) or `write`, never `full`; it expires no
later than the key that created it, and it works only while that key works. So a key can never
outlive its parent's revocation, and an integration can never mint keys of its own.
`dayhand key list`, `dayhand key create` and `dayhand key revoke` use these routes.

## Import

`POST /import` brings a plan into Dayhand from a file:

| `format` | File | What becomes of it |
|---|---|---|
| `dayhand-json` | Dayhand's own JSON export (`dayhand export --format json`, `export_plan` format `json`, version 1); `helm-json`, its name before the rename, is still accepted | Every task outside the trash with all its fields: status, dates, repeat rule, labels, links, checklist, reminders, done and archived times. Task numbers are kept where this account never gave them, so an export into an empty account keeps its numbers. History and settings are not imported. |
| `ics` | iCalendar: `VTODO` and `VEVENT` | `SUMMARY` → title, `DESCRIPTION` → note, `DUE` (or `DTSTART`) → day and time in your time zone (UTC and `TZID` times are converted), `RRULE` → repeat rule, `CATEGORIES` → labels, `URL` → link, `STATUS:COMPLETED`/`IN-PROCESS` → done/doing, `VALARM` before the start → reminders. Cancelled entries and changed occurrences of a series (`RECURRENCE-ID`) are skipped. Dayhand's own calendar file (`dayhand calendar export`) reads back without its `✓` and `Dayhand #n` marks. |
| `todoist-csv` | Todoist's CSV export of a project | Rows of type `task`; `@label` words in the content → labels; the section → a label; `note` rows → the task's note; sub-tasks (`INDENT` 2 or more) → checklist items of their task; `DATE` in English (`2026-11-03`, `today`, `tomorrow at 9am`, `Nov 20 15:30`, a weekday, `every day`, `every 2 weeks`, `every monday, friday`, `every weekday`) → day, time and repeat rule. A date it does not understand stays in the note, with a warning. Priorities are not imported. Todoist's CSV format is not documented by Todoist; this reader follows its current export. |

```sh
curl -s -X POST "https://<name>.convex.site/api/v1/import?dryRun=true" \
  -H "Authorization: Bearer $DAYHAND_API_KEY" -H 'Content-Type: application/json' \
  --data "$(jq -Rs '{content: .}' todoist.csv)"
```

The body is `{ "content": "<the file's text>", "format": "auto" }`; `auto` (the default)
recognises the format from the content. The answer (`docs/schemas/import-result.schema.json`)
says how many tasks the file had (`total`), how many were imported (`created`, and the tasks in
`tasks`), which were `skipped` and why, which `failed` add_task's checks (with the message; the
others are imported all the same) and `warnings` about what could not be carried over.

- Every task is checked by the same rules as `add_task`, gets an `import` history entry with
  the key's actor, and sends `task.created` to webhooks.
- **Importing the same file again imports nothing twice**: each task's `clientId` is a hash of
  the format and its place in the file. A task from a Dayhand export whose id is still in this
  account is skipped too, so importing an export into the account it came from changes nothing.
- `?dryRun=true` reads the file and checks every task without storing anything (`dryRun: true`).
- At most 2000 tasks per import; the server stores them in batches of 200, so a failure halfway
  leaves the first batches imported, and running the same import again completes it.

`dayhand import <file> [--format …] [--dry-run]` sends a file this way.

## OpenAPI

`GET /api/v1/openapi.json` serves the OpenAPI 3.1 document of this deployment (`servers` is its
URL). It is generated from the same sources as the API: the route table, the tools' argument
validators (the MCP `inputSchema`) and the result schemas of `docs/schemas`, so it cannot
drift from what the server does. Each operation names its MCP tool (`x-mcp-tool`) and the key
scope it needs (`x-dayhand-scope`). Load it into Swagger UI, Postman, n8n's HTTP Request node or a
client generator. The tests validate it against the official OpenAPI 3.1 schema and check every
answer they get against the response schema it gives.

The document is public on purpose: it describes the API, not anyone's data. It is the same for
every deployment of a version, apart from `servers`.

## Not offered

- CORS: browsers cannot call the API from another site (keys do not belong in web pages).
- OAuth access tokens: they are for `/mcp` only.
- Server-sent events or long polling: use [webhooks](webhooks.md) to hear about changes.
