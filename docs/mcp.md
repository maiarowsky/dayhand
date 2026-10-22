# MCP endpoint

- URL: `<deployment HTTP actions URL>/mcp`, e.g. `http://127.0.0.1:3211/mcp` locally or
  `https://<deployment>.convex.site/mcp` on Convex Cloud.
- Transport: Streamable HTTP, stateless, JSON responses (`application/json`); no SSE stream.
  `POST` handles `initialize`, `ping`, `tools/list` and `tools/call`; notifications get `202`;
  `GET` and `DELETE` get `405`.
- Authentication: `Authorization: Bearer <personal API key>`. Missing, wrong or revoked keys
  get HTTP 401.
- Every change is recorded with actor `agent`. Pass a `clientId` (e.g. a UUID) with changes you
  might retry; a repeated `clientId` is not applied twice.

## Tools

The input schemas are generated from the same validators the operations enforce.

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

Creating and revoking API keys is not exposed to the agent on purpose: a key that can mint
keys could outlive its own revocation. Keys are managed by the app (`app.createApiKey`,
`app.revokeApiKey`) or by the deployment admin (`npx convex run apiKeys:create`).

Phone pairing is not an MCP tool either. The CLI pairs phones through separate endpoints
(`/devices/*`, see [pairing.md](pairing.md)) that accept the same API key.

## Connecting a client

Any MCP client with Streamable HTTP and custom headers works, for example:

```sh
claude mcp add --transport http helm http://127.0.0.1:3211/mcp \
  --header "Authorization: Bearer $HELM_API_KEY"
```
