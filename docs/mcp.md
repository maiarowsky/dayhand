# MCP endpoint

- URL: `<deployment HTTP actions URL>/mcp`, e.g. `http://127.0.0.1:3211/mcp` locally or
  `https://<deployment>.convex.site/mcp` on Convex Cloud.
- Transport: Streamable HTTP, stateless, JSON responses (`application/json`); no SSE stream.
  Every message is one `POST`; notifications get `202`; `GET` and `DELETE` get `405`.
- Protocol: 2026-07-28 and the 2025 revisions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05)
  on the same URL; see [Protocol versions](#protocol-versions).
- Authentication: `Authorization: Bearer <personal API key>`, or an OAuth access token of an
  agent connection the owner approved on the phone, which is how the Claude apps connect
  ([oauth.md](oauth.md)). Missing, wrong, expired or revoked credentials get HTTP 401 with a
  `WWW-Authenticate` header that points OAuth clients at the authorization server. A request
  with a browser `Origin` header gets HTTP 403 unless the origin is listed in
  `HELM_MCP_ALLOWED_ORIGINS` ([deploy.md](deploy.md#environment-variables)).
- Every change is recorded with the key's kind as the actor (`cli` for the user at a terminal,
  `agent` for an AI agent) and the key's name, or as `agent` with the OAuth client's name; see
  [Keys and actors](#keys-and-actors).
- Pass a `clientId` (e.g. a UUID) with changes you might retry; a repeated `clientId` is not
  applied twice. Pass `dryRun: true` to check a change without saving it ([Dry runs](#dry-runs)).
- Each key or connection may make 120 reads and 60 changes a minute ([Limits](#limits)).
- The server identifies itself as `{ "name": "helm", "version": "0.5.0" }` (`serverInfo` of
  `initialize`, `_meta` of 2026-07-28 results); see [Versions](#versions).

## Tools

The input schemas are generated from the same validators the operations enforce; the output
schemas come from [schemas/](schemas/), the contract `hlm --json` follows too.

Every task has an `id` and a `ref`: the user's task number (1, 2, 3, …). It is given once, kept
through the trash, the archive and a restore, and never given to another task, even after the
task is purged. Every tool that takes a `taskId` accepts either the `id` or the number written
as `"#42"`.

`tools/list` returns the tools in this order. Read-only tools are marked R, destructive ones D
(`destructiveHint`); every change except `add_task` is idempotent (`idempotentHint`: repeating
it with the same arguments changes nothing more), and no tool reaches outside Helm
(`openWorldHint: false`). Each tool also has a `title`.

| Tool | Title | Hints | Result ([schema](schemas/)) | Operation |
|---|---|---|---|---|
| `add_task` | Add task | | `task` | Add a task (title; optional note, dueDate, dueTime, status, resumeNote, repeat, labels, links) |
| `update_task` | Update task | | `task` | Change fields; `null` clears an optional field |
| `set_status` | Set task status | | `task` | `todo` / `doing` / `done` |
| `set_now` | Set the now task | | `set-now` | Make one task the "now" task, optionally with a resume note; `taskId: null` clears it |
| `complete_task` | Complete task | | `complete` | Mark done; repeating tasks return their next occurrence |
| `reschedule_task` | Reschedule task | | `task` | Move to another day/time; `dueDate: null` removes the date |
| `archive_task` | Archive task | | `task` | Archive |
| `delete_task` | Move task to trash | D | `task` | Move to the trash (purged after 30 days) |
| `restore_task` | Restore task | | `task` | Restore from the trash, or from the archive |
| `list_today` | Today | R | `today` | Overdue, today, done today and the now task |
| `list_all` | Find tasks | R | `task-list` | Tasks not in the trash: search, filters and pages ([below](#finding-tasks-list_all)) |
| `list_trash` | Trash | R | `task-list` | Tasks in the trash |
| `board` | Board | R | `board` | Three columns: todo, doing, done |
| `get_task` | Task with history | R | `task-detail` | One task with its change history |
| `export_plan` | Export plan | R | `export` | Markdown or JSON export of the whole plan |
| `get_settings` | Settings | R | `settings` | Time zone, summary time, default reminders |
| `update_settings` | Update settings | D | `settings` | Change them |

### Results

A successful call returns the result as `structuredContent` (a list as `{ "result": [...] }`,
`null` as `{ "result": null }`) and as JSON in its text block. A Markdown export's text block is
the Markdown itself and its `structuredContent` is `{ "format": "markdown", "content": "…" }`.

Each tool's `outputSchema` is the result's schema from [schemas/](schemas/) or the
[tool error](schemas/tool-error.schema.json) (`anyOf`), with every referenced schema inlined
under `$defs`: clients never fetch a URL. The top level is an object, as 2025 clients require.
`backend/convex/lib/outputSchemas.ts` is generated from `docs/schemas` by `npm run schemas` in
`backend/`; a test fails when it is out of date.

### Finding tasks (`list_all`)

| Argument | Meaning |
|---|---|
| `query` | Tasks whose title, note, resume note or labels contain this text, in any case |
| `status` | Only these statuses, e.g. `["todo", "doing"]`; done tasks are included only when listed |
| `labels` | Only tasks having all of these labels |
| `dueBefore`, `dueAfter` | Only tasks due before / after this day (`YYYY-MM-DD`, `"today"`, `"tomorrow"`); tasks without a day never match |
| `overdue` | `true`: only overdue tasks; `false`: only the others |
| `includeDone`, `includeArchived` | Done tasks (default `true`; ignored when `status` is given), archived ones (default `false`) |
| `limit` | Page size, 1 to 200 |
| `cursor` | `nextCursor` of the previous page |

Tasks come oldest due first (tasks without a day first, timed before untimed on one day). The
result is `{ "result": [...], "total": <all matches>, "nextCursor": <string or null> }`; pass
`nextCursor` back as `cursor` with the same filters for the next page. The cursor is opaque and
stays valid when tasks are added or removed in the meantime.

Without `limit`, every match comes back at once and the text block holds the plain task array,
as before 0.4.0, so clients that read the text keep working; with `limit` or `cursor` the text
block holds the whole object.

### Dry runs

Every changing tool takes `dryRun: true`. The change runs with every check, then Helm rolls it
back: nothing is saved and nothing enters the history. The result is what the real call would
return, marked `"dryRun": true` (for `set_now` with `taskId: null`, `{ "result": null, "dryRun":
true }`). A dry run of `add_task` shows the number the task would get, but does not reserve it.
A change that would fail fails its dry run with the same error. Dry runs count as changes for
the [limits](#limits).

## Resources

| URI | Type | Content |
|---|---|---|
| `helm://today` | `application/json` | `list_today` |
| `helm://guide` | `text/markdown` | How an agent should work with Helm: numbers, the now task, retries, dry runs, limits |
| `helm://tasks/{ref}` (template) | `application/json` | `get_task` of task `#ref`, e.g. `helm://tasks/42` |

`resources/list` returns the first two, `resources/templates/list` the template. Reading a
resource that does not exist (also a task number that does not) is a JSON-RPC error with
`data: { "uri" }`: `-32602` on 2026-07-28, `-32002` on 2025 revisions.

## Prompts

| Prompt | Arguments | What it starts |
|---|---|---|
| `plan_day` | `focus` (optional) | Go through overdue and today's tasks, agree on an order and set the now task; the Today screen is attached as the resource `helm://today` |
| `weekly_review` | | Look back at the last 7 days (board's done column) and ahead at the next 7 (`list_all` with dates), then tidy the plan |
| `triage_overdue` | | Decide, task by task, what happens to each overdue task; the overdue tasks are attached |

Each prompt tells the agent to ask before changing anything, to pass a `clientId` and to preview
larger changes with `dryRun`. An unknown prompt or argument is a JSON-RPC error `-32602`.

## Limits

Each API key, and each agent connection (OAuth), may make 120 reads and 60 changes a minute
(`convex/callLimits.ts`). The minute
starts with the first call; reads and changes are counted apart. Reads are tool calls of
read-only tools, `resources/read` of `helm://today` and `helm://tasks/…`, and `prompts/get`;
listing tools, resources and prompts, `server/discover` and `helm://guide` are not counted.

A call over the limit is refused before it runs, so nothing is applied:

- a tool call returns the tool error `rate_limited` with `retryAfterMs`, HTTP 200 and a
  `Retry-After` header (seconds);
- `resources/read` and `prompts/get` get HTTP 429 with `Retry-After` and the JSON-RPC error
  `{ "code": 429, "message": "Too many reads with this API key: …", "data": { "retryAfterMs" } }`.

`npx convex run callLimits:reset '{"keyId":"<key id>"}'` clears a key's counters
(`'{"connectionId":"<connection id>"}'` a connection's).

## Errors

A failed tool call is a normal result with `isError: true`. The text block holds a message
for people; `structuredContent.error` holds the same message and a code for programs:

```json
{
  "content": [{ "type": "text", "text": "Task #404 not found" }],
  "structuredContent": { "error": { "code": "not_found", "message": "Task #404 not found" } },
  "isError": true
}
```

| Code | Meaning | Example message |
|---|---|---|
| `invalid_argument` | Wrong or missing arguments, or an operation the task's state does not allow | `dueDate must be YYYY-MM-DD, "today" or "tomorrow", got "someday"`; `Invalid arguments: taskId must be a task id or "#<number>", got "nope"`; `Task is in the trash; restore it first` |
| `not_found` | No such task (or API key, device) for this user | `Task #404 not found` |
| `rate_limited` | Too many calls with this key or connection; `retryAfterMs` says when to try again | `Too many changes with this API key: at most 60 a minute. Try again in 12 s.` |
| `unauthenticated` | Reserved for identity errors inside a tool; a missing, wrong or revoked key or token gets HTTP 401 before any tool runs | |
| `internal` | Anything unexpected; the message says only `Internal error` | `Internal error` |

New codes may be added in a minor version; treat an unknown code like `internal`.

Errors outside tools are JSON-RPC errors:

| Code | When | HTTP |
|---|---|---|
| `-32602` | Unknown tool or prompt, bad prompt arguments, a resource that does not exist (2026-07-28), a missing `_meta` field (2026-07-28) | 200; 400 for the `_meta` field |
| `-32002` | A resource that does not exist (2025 revisions) | 200 |
| `-32601` | Unknown method | 200; 404 on 2026-07-28 |
| `-32020` | 2026-07-28 header mismatch: a standard header missing or not matching the body | 400 |
| `-32022` | Unsupported protocol version; `data: { supported, requested }` | 400 |
| `429` | Too many reads outside tools ([Limits](#limits)) | 429 |
| `-32600`, `-32700` | Not a JSON-RPC request, a batch, a body over 256 KB, a browser origin not allowed | 400, 413, 403 |

An OAuth access token whose scopes do not cover the request gets HTTP 403 with
`WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` and no JSON-RPC body: a tool
of the other scope, or, without `tasks:read`, `resources/read` of the user's data and
`prompts/get` ([oauth.md](oauth.md#requests-scopes-and-tokens)). `tools/list` shows only the
tools the token's scopes allow.

## Protocol versions

One endpoint serves both eras of MCP, the way the specification describes a dual-era server:

- **2025 revisions** (2025-11-25 and earlier): the client sends `initialize`, and the server
  answers with the requested version when it knows it, otherwise `2025-11-25`. `ping` works.
  Results have no `resultType`. Helm keeps no session, so every request stands alone anyway.
- **2026-07-28**: no `initialize`; a request is served as 2026-07-28 when its `params._meta`
  carries `io.modelcontextprotocol/protocolVersion`. It must also carry
  `io.modelcontextprotocol/clientCapabilities` (else `-32602`, HTTP 400) and the headers
  `MCP-Protocol-Version` (equal to that version), `Mcp-Method` and, for `tools/call`,
  `prompts/get` and `resources/read`, `Mcp-Name` (plain or `=?base64?…?=`), all matching the
  body (else `-32020`, HTTP 400). `server/discover` returns `supportedVersions` (both eras),
  the capabilities and the instructions. Every result has `resultType: "complete"` and
  `_meta["io.modelcontextprotocol/serverInfo"]`; `server/discover`, `tools/list`,
  `prompts/list`, `resources/list` and `resources/templates/list` carry `ttlMs: 300000` and
  `cacheScope: "public"`, `resources/read` carries `ttlMs: 0` and `cacheScope: "private"`
  (`helm://guide`: public). `ping` no longer exists and unknown methods get HTTP 404.

Not offered in either era: `subscriptions/listen` (and `listChanged` notifications), logging,
completion, sampling, elicitation and the tasks extension. Helm never asks the client for
input, so no request returns `input_required`.

The official TypeScript SDK v2 reaches the 2026-07-28 era with
`versionNegotiation: { mode: "auto" }` (or a pin); without it, it speaks 2025 like SDK v1.
Both are tested (`backend/tests/mcp-modern.test.ts`).

## Keys and actors

Every API key has a name and a kind:

- `cli`: the user at a terminal. History shows changes as `cli`.
- `agent`: an AI agent. History shows changes as `agent: <key name>`, e.g. `agent: claude-code`.

Changes made in the app are `app`. Changes made through an agent connection (OAuth, e.g. the
Claude app) are `agent` with the client's name, e.g. `agent: Claude`
([oauth.md](oauth.md#connections-history-and-revocation)). `get_task` returns each history
entry with `actor` (`app`, `cli` or `agent`), `actorName` (the key's or client's name, `null`
for the app) and `by`, the label above. Give each agent its own key so it can be told apart and revoked on its own.

Keys without a kind (created before 0.3.0) act as `agent` keys; the 0.3.0 migration records
that ([deploy.md](deploy.md#upgrading-to-030)). A new key is an `agent` key unless created with
`"kind": "cli"`:

```sh
npx convex run apiKeys:create '{"userId":"<issuer>|owner","actor":"app","name":"macbook","kind":"cli"}'
npx convex run apiKeys:create '{"userId":"<issuer>|owner","actor":"app","name":"claude-code"}'
```

The app does the same with `app.createApiKey({ name, kind })`; `app.listApiKeys` returns each
key's `kind`.

Creating and revoking API keys is not exposed to the agent on purpose: a key that can mint
keys could outlive its own revocation. Keys are managed by the app (`app.createApiKey`,
`app.revokeApiKey`) or by the deployment admin (`npx convex run apiKeys:create`).

Phone pairing is not an MCP tool either. The CLI pairs phones through separate endpoints
(`/devices/*`, see [pairing.md](pairing.md)) that accept the same API key.

## Versions

`serverInfo.version` is the backend version (`backend/package.json`) and the one clients use
to check compatibility. It follows semver: a minor version only adds tools, fields, error codes
and accepted values; a major version may change or remove them. A client written for 0.3
works with any 0.x from 0.3 on.

| Version | Changes |
|---|---|
| 0.5.0 | OAuth 2.1 for the Claude apps and other MCP clients: access tokens next to API keys, `WWW-Authenticate` with `resource_metadata`, scopes `tasks:read` and `tasks:write` (`tools/list` filtered, `403 insufficient_scope`), limits per connection ([oauth.md](oauth.md)) |
| 0.4.0 | MCP 2026-07-28 next to the 2025 revisions; tool titles, all behaviour hints and output schemas; `list_all` search, filters and pages (`total`, `nextCursor`); `dryRun` on every change; resources `helm://today`, `helm://guide`, `helm://tasks/{ref}`; prompts `plan_day`, `weekly_review`, `triage_overdue`; limits per key and error `rate_limited`; structured content for a Markdown export; `Origin` check |
| 0.3.0 | Task numbers (`ref`, `taskId: "#42"`); error codes in `structuredContent.error`; key kinds and named actors in history (`actor: "cli"`, `actorName`, `by`) |
| 0.2.0 | Phone pairing endpoints (`/devices/*`, `/auth/*`) |
| 0.1.0 | MCP endpoint with 17 tools |

## Connecting a client

The Claude apps (claude.ai, Desktop, Android, iOS) add Helm as a custom connector with the URL
`<deployment HTTP actions URL>/mcp` and sign in with OAuth; the owner approves the connection
on the phone. The steps are in [oauth.md](oauth.md#connecting-the-claude-app-manual-procedure).

Any MCP client with Streamable HTTP and custom headers works with an API key, for example:

```sh
claude mcp add --transport http helm http://127.0.0.1:3211/mcp \
  --header "Authorization: Bearer $HELM_API_KEY"
```
