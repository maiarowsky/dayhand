# MCP endpoint

- URL: `<deployment HTTP actions URL>/mcp`, e.g. `http://127.0.0.1:3211/mcp` locally or
  `https://<deployment>.convex.site/mcp` on Convex Cloud.
- Transport: Streamable HTTP, stateless, JSON responses (`application/json`); no SSE stream.
  `POST` handles `initialize`, `ping`, `tools/list` and `tools/call`; notifications get `202`;
  `GET` and `DELETE` get `405`.
- Authentication: `Authorization: Bearer <personal API key>`. Missing, wrong or revoked keys
  get HTTP 401.
- Every change is recorded with the key's kind as the actor (`cli` for the user at a terminal,
  `agent` for an AI agent) and the key's name; see [Keys and actors](#keys-and-actors).
- Pass a `clientId` (e.g. a UUID) with changes you might retry; a repeated `clientId` is not
  applied twice.
- `initialize` returns `serverInfo: { "name": "helm", "version": "0.3.0" }`; see
  [Versions](#versions).

## Tools

The input schemas are generated from the same validators the operations enforce.

Every task has an `id` and a `ref`: the user's task number (1, 2, 3, …). It is given once, kept
through the trash, the archive and a restore, and never given to another task, even after the
task is purged. Every tool that takes a `taskId` accepts either the `id` or the number written
as `"#42"`.

| Tool | Operation |
|---|---|
| `add_task` | Add a task (title; optional note, dueDate, dueTime, status, resumeNote, repeat, labels, links) |
| `update_task` | Change fields; `null` clears an optional field |
| `set_status` | `todo` / `doing` / `done` |
| `set_now` | Make one task the "now" task, optionally with a resume note; `taskId: null` clears it |
| `complete_task` | Mark done; repeating tasks return their next occurrence |
| `reschedule_task` | Move to another day/time; `dueDate: null` removes the date |
| `archive_task` | Archive |
| `delete_task` | Move to the trash (purged after 30 days) |
| `restore_task` | Restore from the trash, or from the archive |
| `list_today` | Overdue, today, done today and the now task |
| `list_all` | All tasks not in the trash, filtered by labels |
| `list_trash` | Tasks in the trash |
| `board` | Three columns: todo, doing, done |
| `get_task` | One task with its change history |
| `export_plan` | Markdown or JSON export of the whole plan |
| `get_settings` | Time zone, summary time, default reminders |
| `update_settings` | Change them |

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
| `unauthenticated` | Reserved for identity errors inside a tool; a missing, wrong or revoked key gets HTTP 401 before any tool runs | |
| `internal` | Anything unexpected; the message says only `Internal error` | `Internal error` |

An unknown tool is a JSON-RPC error (`-32602`), not a tool result. New codes may be added in a
minor version; treat an unknown code like `internal`.

## Keys and actors

Every API key has a name and a kind:

- `cli`: the user at a terminal. History shows changes as `cli`.
- `agent`: an AI agent. History shows changes as `agent: <key name>`, e.g. `agent: claude-code`.

Changes made in the app are `app`. `get_task` returns each history entry with `actor`
(`app`, `cli` or `agent`), `actorName` (the key's name, `null` for the app) and `by`, the label
above. Give each agent its own key so it can be told apart and revoked on its own.

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
| 0.3.0 | Task numbers (`ref`, `taskId: "#42"`); error codes in `structuredContent.error`; key kinds and named actors in history (`actor: "cli"`, `actorName`, `by`) |
| 0.2.0 | Phone pairing endpoints (`/devices/*`, `/auth/*`) |
| 0.1.0 | MCP endpoint with 17 tools |

## Connecting a client

Any MCP client with Streamable HTTP and custom headers works, for example:

```sh
claude mcp add --transport http helm http://127.0.0.1:3211/mcp \
  --header "Authorization: Bearer $HELM_API_KEY"
```
