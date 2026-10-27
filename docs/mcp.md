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
  `DAYHAND_MCP_ALLOWED_ORIGINS` ([deploy.md](deploy.md#environment-variables)).
- Every change is recorded with the key's kind as the actor (`cli` for the user at a terminal,
  `agent` for an AI agent) and the key's name, or as `agent` with the OAuth client's name; see
  [Keys and actors](#keys-and-actors).
- Pass a `clientId` (e.g. a UUID) with changes you might retry; a repeated `clientId` is not
  applied twice. Pass `dryRun: true` to check a change without saving it ([Dry runs](#dry-runs)).
- Each key or connection may make 120 reads and 60 changes a minute ([Limits](#limits)).
- Several agents can share the plan: an activity log, acceptance criteria and proof, dependencies
  and time-boxed claims; agents can ask the owner first, the owner can pause them or set a policy
  per tool, agents propose work into an inbox, and a health report shows what needs a look
  ([agent-work.md](agent-work.md)).
- The server's name and backend release version appear in `serverInfo` of `initialize` and
  `_meta` of 2026-07-28 results. The [server identity](../backend/convex/lib/mcpProtocol.ts) is the
  source of truth; see [Versions](#versions) for release history.

## Tools

The input schemas are generated from the same validators the operations enforce; the output
schemas come from [schemas/](schemas/), the contract `dayhand --json` follows too.

Every task has an `id` and a `ref`: the user's task number (1, 2, 3, …). It is given once, kept
through the trash, the archive and a restore, and never given to another task, even after the
task is purged. Every tool that takes a `taskId` accepts either the `id` or the number written
as `"#42"`.

`tools/list` returns the tools in this order. Tools marked O are the owner's: only the app and
`cli` keys may call them, and `tools/list` leaves them out for agents (agent keys and agent
connections; since 0.11.0). Read-only tools are marked R, destructive ones D
(`destructiveHint`); every change except `add_task` and `add_project` is idempotent (`idempotentHint`: repeating
it with the same arguments changes nothing more), and no tool reaches outside Dayhand
(`openWorldHint: false`). Each tool also has a `title`.

| Tool | Title | Hints | Result ([schema](schemas/)) | Operation |
|---|---|---|---|---|
| `add_task` | Add task | | `task` | Add a task (title; optional note, dueDate, dueTime, status, resumeNote, repeat, labels, links, checklist, reminders, acceptance, plan, dependsOn, blockedReason, proposal, source, requestedBy, returnTo, [projectId](#projects)) |
| `update_task` | Update task | | `task` | Change fields; `null` clears an optional field |
| `set_status` | Set task status | | `task` | `todo` / `doing` / `done` |
| `set_now` | Set the now task | | `set-now` | Make one task the "now" task, optionally with a resume note; `taskId: null` clears it |
| `complete_task` | Complete task | | `complete` | Mark done, optionally with `proof`; ends the claim; repeating tasks return their next occurrence (`next: null` when the series has ended). An agent needs every acceptance criterion met and a proof summary ([below](#agent-work)) |
| `reschedule_task` | Reschedule task | | `task` | Move to another day/time; `dueDate: null` removes the date |
| `archive_task` | Archive task | | `task` | Archive |
| `delete_task` | Move task to trash | D | `task` | Move to the trash (purged after 30 days) |
| `restore_task` | Restore task | | `task` | Restore from the trash, or from the archive |
| `list_today` | Today | R | `today` | Overdue, today, done today and the now task; optional [project filter](#projects) |
| `list_all` | Find tasks | R | `task-list` | Tasks not in the trash: search, filters and pages ([below](#finding-tasks-list_all)) |
| `list_projects` | Projects | R | `project-list` | Projects in menu order, with task counts; `includeArchived`, `at` ([below](#projects)) |
| `add_project` | Add project | | `project-added` | Add a project; `fromLabel` moves unassigned tasks with that label into it |
| `update_project` | Update project | | `project` | Rename, change metadata or position, archive or restore |
| `delete_project` | Delete project | O, D | `project-delete` | Delete a project, moving its tasks to `moveTasksTo` when it has any |
| `list_trash` | Trash | R | `task-list` | Tasks in the trash |
| `board` | Board | R | `board` | Three columns: todo, doing, done; optional [project filter](#projects) |
| `get_task` | Task with history | R | `task-detail` | One task with its change history |
| `export_plan` | Export plan | R | `export` | [Markdown, JSON or iCalendar](#export-formats) export of the whole plan |
| `get_settings` | Settings | R | `settings` | Time zone, summary time, default reminders |
| `update_settings` | Update settings | D | `settings` | Change them |
| `list_events` | Activity log | R | `event-list` | Task changes after a cursor ([below](#activity-log-list_events)) |
| `claim_task` | Claim task | | `task` | Claim a task for `minutes` (default 120); other agents get `conflict` ([below](#claims)) |
| `renew_claim` | Renew claim | | `task` | Extend your claim by `minutes` from now |
| `release_task` | Release task | | `task` | End your claim, optionally with a checkpoint `note` (saved as the resume note) |
| `request_approval` | Ask the owner | | `approval` | Ask the owner to decide before you act: `action`, 2 to 4 `options`, `reversible`, `expiresInMinutes`, optional `taskId` ([below](#approvals-pausing-and-policies)) |
| `get_approval` | Approval request | R | `approval` | One request: `pending`, `decided` (with the chosen option and note) or `expired` |
| `list_approvals` | Approval requests | R | `approval-list` | Requests, newest first, by `status` and `taskId` |
| `decide_approval` | Decide approval request | O | `approval` | Pick an option of a pending request |
| `get_agent_controls` | Agent controls | R | `agent-controls` | Whether agents are paused, and the tool policies |
| `pause_agents` | Pause agents | O | `agent-controls` | `paused: true` refuses every agent's changes until `paused: false` |
| `set_tool_policy` | Set tool policy | O | `agent-controls` | `apiKeyId`, `toolName` (or `"*"`), `rule`: `allow`, `ask` or `deny` |
| `accept_proposal` | Accept proposal | O | `task` | A proposal joins the plan ([below](#proposals)) |
| `merge_proposal` | Merge proposal | O | `merge` | Fold a proposal into a task already in the plan (`intoTaskId`) |
| `reject_proposal` | Reject proposal | O, D | `task` | Move a proposal to the trash, optionally with a `reason` |
| `agent_brief` | Agent brief | R | `agent-brief` | Start of a session: `list_today` plus claims, approvals, ready tasks, projects and `nextSteps` ([below](#agent-brief-agent_brief)) |
| `import_backlog` | Import Backlog.md tasks | | `backlog-import` | Backlog.md task files (`files: [{path, content}]`) as tasks, a file imported before skipped ([backlog-md.md](backlog-md.md)) |
| `export_backlog` | Export as Backlog.md | R | `backlog-export` | The plan as Backlog.md task files and a `config.yml` ([parameters](backlog-md.md#using-it)) |
| `plan_health` | Plan health | R | `plan-health` | What needs a look, in one read ([below](#plan-health-plan_health)) |

### Results

A successful call returns the result as `structuredContent` (a list as `{ "result": [...] }`,
`null` as `{ "result": null }`) and as JSON in its text block. A Markdown export's text block is
the Markdown itself and its `structuredContent` is `{ "format": "markdown", "content": "…" }`;
an iCalendar export (`format: "ics"`) likewise has the calendar text in both.

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
| `projectId` | Optional [project filter](#projects) (since 0.13.0) |
| `ready` | `true`: only tasks ready to work on (not done, no `blockedReason`, not a proposal, every task in `dependsOn` done); `false`: only the others |
| `proposed` | `true`: only proposals waiting in the inbox; without it, or `false`, proposals are left out (since 0.11.0) |
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

### Projects

Since backend 0.13.0, a task may carry `projectId`, the stored project id. `add_task` and
`update_task` accept a project id or its name (case-insensitive); `"none"` means no project.
An omitted field leaves the task unchanged on update; `projectId: null` also clears it.
Selecting an archived project fails with `invalid_argument`, unless an update names the
project the task is already in. Unknown projects return `not_found`.

`list_all`, `list_today` and `board` take the same optional `projectId` selector: one project's
tasks, `"none"` for tasks without a project, or omit it for all projects. The filter applies to
every part of Today, including the now task and done today. Other filters and pagination still
apply.

Backend 0.13.1 exposes four project tools:

| Tool | Arguments | Result |
|---|---|---|
| `list_projects` | `includeArchived?` (default false), `at?` (Unix ms, default now) | `{ result: [project with counts], noProject: { open, overdue } }` |
| `add_project` | `name`, `color?`, `icon?`, `note?`, `position?`, `fromLabel?`, `removeLabel?`, `clientId?`, `dryRun?`, `approvalId?` | `{ project, moved: [{ id, ref }], skipped: [{ id, ref, projectId?, reason }] }` |
| `update_project` | `projectId` (id or name), `name?`, `color?`, `icon?`, `note?`, `position?`, `archived?`, `clientId?`, `dryRun?`, `approvalId?` | The updated project |
| `delete_project` | `projectId`, `moveTasksTo?` (another project or `"none"`), `clientId?`, `dryRun?` | `{ project, moved: [{ id, ref }] }` |

A project has `id`, `name`, `position`, `archived`, `createdAt`, `updatedAt`, and optional `color`,
`icon`, `note`, `archivedAt`, `clientId`; unset fields are omitted, not `null`. Lists are ordered
by `position`, then creation time. `list_projects` adds `counts: { open, overdue, dueToday, done }`.
These counts exclude archived tasks, trashed tasks and proposals; `overdue` and `dueToday` count
only open tasks, in the user's time zone. `noProject` counts open and overdue tasks without a project.

- Names are trimmed and NFC-normalized, 1–50 characters on one line, unique regardless of case
  among all the user's projects, archived ones too. `"none"` is reserved.
- `color`: `red`, `orange`, `amber`, `green`, `teal`, `cyan`, `blue`, `indigo`, `purple`, `pink`,
  `brown` or `gray`; absent means neutral. `icon` is one emoji (up to 16 UTF-16 code units).
  `note` is context for people and agents (up to 2000 characters).
- New projects go to the end of the menu unless `position` is given. To reorder one, pass a
  position between its neighbors. At most 200 projects, including archived ones.
- `update_project` with `color`, `icon` or `note` set to `null` clears that field. `archived: true`
  archives the project, not its tasks; `false` restores it. Its tasks remain in Today and the board.
- `add_project { name, fromLabel }` moves tasks with that exact label and no project, in any state.
  `removeLabel: true` removes the label only from moved tasks; by default it stays. Tasks already
  in a project or claimed by another agent are listed in `skipped` with a reason. A dry run shows
  the result without storing anything. No label is converted automatically.
- Only the owner (`cli` key) may `delete_project`; agent keys and OAuth connections neither see
  nor call it. When any task points at the project, including done, archived, trashed tasks and
  proposals, omitting `moveTasksTo` fails with `precondition_failed` and task counts. Each moved
  task gets a history entry and `task.updated` webhook; no task is deleted. A call can move at
  most 1000 tasks, also for `fromLabel`.

Agents may add and update projects by default, like tasks. Both tools obey the owner's pause and
`allow/ask/deny` policies (`ask` returns `approval_required`). `list_projects` needs `tasks:read`,
the three changes `tasks:write`; a read-only token sees only `list_projects` among these four.
`dayhand://projects` gives the default list. The guide explains projects versus labels, and
`weekly_review` includes a project review.

Project changes themselves do not appear in `list_events` or emit `project.*` webhooks; read the
catalog again for changes to names, colors and notes. The REST routes have no project ETag or
`If-Match`: the last write wins. Client availability is in [architecture](architecture.md#projects).

### Export formats

`export_plan` exports the whole plan. Since backend 0.13.0:

- Markdown task lines show the project as `+Project-name`, with whitespace replaced by hyphens,
  next to the `#labels`. This is readable output, not an import format.
- JSON adds a `projects` catalog in menu order, archived and empty projects included. Each task's
  `projectId` references an id in that catalog. The export version stays 1; older importers
  ignore project fields. [JSON import](api.md#import) describes restoration into another account.

For iCalendar (`ics`), see [calendar.md](calendar.md).

### Agent work

Since 0.10.0 a task may carry fields for agents working on it ([agent-work.md](agent-work.md) has
the reasons). None of them is a new status: the board stays `todo`, `doing`, `done`.

| Field | Set with | Meaning |
|---|---|---|
| `acceptance` | `add_task`, `update_task` | Criteria `{ id, text, met }` in order; new ones get `a1`, `a2`, …; the list is replaced as a whole, `null` or `[]` removes it (at most 50, up to 500 characters each) |
| `plan` | `add_task`, `update_task` | How the work will be done (up to 20000 characters) |
| `proof` | `complete_task` | `{ summary?, links, checks: [{ name, result: "pass" \| "fail", url? }] }`, kept on the task ([schema](schemas/proof.schema.json)) |
| `dependsOn` | `add_task`, `update_task` | Ids of the tasks that must be done first (given as ids or `"#42"`); `[]` removes them; no cycles (at most 50) |
| `blockedReason` | `add_task`, `update_task` | Why the task cannot go on; `null` clears it |
| `claimedBy`, `claimExpiresAt` | `claim_task`, `renew_claim`, `release_task` | Who holds the claim (`keyId` or `connectionId`, and `name`) and until when (Unix ms); kept after expiry until released or claimed again |

When a task has acceptance criteria, an **agent** (an `agent` key or an agent connection) can
complete it only when every criterion is met and the proof has a `summary`; otherwise
`complete_task` (and `set_status` to `done`) fails with `precondition_failed`. The app and `cli`
keys complete tasks as before. A repeating task's next occurrence keeps the criteria, unticked,
and the plan.

#### Claims

`claim_task` gives the caller's key or connection the task for `minutes` (1 to 1440, default 120).
While the claim lasts, another agent's `claim_task`, `renew_claim`, `release_task` and every change
of that task (`update_task`, `set_status`, `set_now`, `complete_task`, `reschedule_task`,
`archive_task`, `delete_task`, `restore_task`) fail with `conflict`, whose message names the holder
and the expiry. Claiming again extends your own claim. `renew_claim` works while nobody else has
claimed the task, also after your claim ran out; without a claim of yours it is
`precondition_failed`. `release_task` ends the claim and saves `note` as the resume note.
Completing the task ends its claim. Done, archived and trashed tasks cannot be claimed
(`invalid_argument`). The owner wins: changes from the app and from `cli` keys are never refused,
and the app can end any claim (`app.release`).

#### Activity log (`list_events`)

| Argument | Meaning |
|---|---|
| `since` | `nextCursor` of an earlier call (`"c…"`), or a time as Unix milliseconds or ISO 8601 with a zone (the changes from then on); without it, the newest changes |
| `by` | Only changes by `app`, `cli`, `agent` (any agent) or `"agent: <name>"` |
| `taskId` | Only changes of this task |
| `limit` | 1 to 500, default 100 |

The result is `{ "events": [...], "nextCursor": "c…", "hasMore": <bool> }`
([schema](schemas/event-list.schema.json)). Each event has `id`, `at`, `taskId`, `ref` and `title`
(the task's now), `action`, `actor`, `actorName`, `by`, `before` and `after`, like a history
entry. Events come oldest first, in the order the changes were committed. Pass `nextCursor` as
`since` next time to get only what changed in between; `hasMore: true` means another page is
already there. Only task changes are listed, not changes of API keys, webhooks or devices. Changes
made before 0.10.0 appear once the deployment ran `migrations:backfillEventSeqs`
([deploy.md](deploy.md#upgrading-to-0100)).

### Approvals, pausing and policies

Since 0.11.0 ([agent-work.md](agent-work.md#5-approval-requests) has the reasons):

- `request_approval` stores a request `{ action, detail?, options: [{ label, consequence?, id? }],
  reversible, expiresInMinutes? (1 to 10080, default 1440), taskId?, clientId? }`; options get
  `o1`, `o2`, … unless they carry an id. The owner decides on the phone (or with a `cli` key,
  `decide_approval`); the agent reads the outcome with `get_approval` or gets the webhook
  `approval.decided` ([webhooks.md](webhooks.md#events)). A request about a task enters that
  task's history and the activity log (`approvalRequest`, `approvalDecide`). **Dayhand records the
  decision; it does not stop an agent from acting without one.** The agent's own tooling has to
  check it.
- `pause_agents` with `paused: true` refuses every change by an agent key or agent connection
  with `agents_paused`, dry runs included, until `paused: false`; reads keep working, and the
  owner's own changes (app, `cli` keys) are never refused.
- `set_tool_policy` sets, for one agent key, `allow`, `ask` or `deny` on a tool that changes the
  plan, or on `"*"` (every such tool without its own rule); no rule means `allow`. `deny` fails
  the call with `forbidden`. `ask` fails it with `approval_required` and an `approvalId`: Dayhand
  has made a request with the options `allow` ("Allow once") and `deny`, bound to this key, this
  tool and these arguments (without `clientId`, `dryRun` and `approvalId`); calling again while it
  waits returns the same request. Once the owner allows it, the same call with `approvalId` runs
  once; another call, a second use, a denied or an expired request is refused. A dry run needs no
  approval. Policies are per API key; agent connections (OAuth) follow only the pause and their
  scopes.

### Proposals

`add_task` with `proposal: true` adds a task with `proposedAt`: it waits in the owner's inbox and
stays out of `list_today`, `board`, `list_all` (unless `proposed: true`), `ready`, the calendar
feed and the phone's Today until the owner accepts it (`accept_proposal`), merges it into another
task (`merge_proposal`; [merge rules](agent-work.md#7-the-proposal-inbox)) or rejects
it (`reject_proposal`: to the trash). A proposal cannot be claimed, made the now task, moved to
`doing` or completed (`invalid_argument`). Three fields work on any new task:

| Field | Meaning |
|---|---|
| `source` | `{ kind, ref, url? }`, e.g. `{ "kind": "sentry", "ref": "CHECKOUT-42" }`. One source makes one task: `add_task` with a source that already made a task returns that task, also when it is in the trash; once the trash is purged the source is free again. A merged proposal's source leads to the task it was merged into |
| `requestedBy` | Who asked for it (up to 200 characters); an agent's proposal without it says `agent: <name>` |
| `returnTo` | Id of one of the user's webhooks: it gets `task.returned` with the outcome (`completed`, `rejected` or `merged`) and the proof, whatever events it subscribes to ([webhooks.md](webhooks.md#events)) |

### Plan health (`plan_health`)

`plan_health` (also `GET /api/v1/health`, `dayhand health`, the prompt `plan_health`) returns, as
of `at`, in the user's time zone: `agentsPaused`; `overdue`, `dueToday`, `inProgress` (each with
`workingBy`: `"agent: <name>"` while a claim lasts), `expiredClaims`, `blocked` (each with
`reasons`: the blocked reason and every dependency not done yet), `awaitingApproval` (tasks with a
pending request, and `pendingApprovals` in all), `completedToday` (each with `proof`, and
`withProof`, `withoutProof`): each `{ count, tasks }` with the first 20 tasks; `proposals.count`;
and `oldestOpen`, the open task created longest ago with `ageDays`
([schema](schemas/plan-health.schema.json)). Proposals and archived tasks are not counted as open.

### Agent brief (`agent_brief`)

`agent_brief` (also `GET /api/v1/brief`, `dayhand prime --json`) is what an agent reads first in a
session, as of `at` and from its own side (since 0.12.0): every field of `list_today`, then
`caller` (`type`, `name`), `agentsPaused` and `pausedReason`, `policies` (the owner's rules for the
caller's own key other than `allow`), `claims.active` and `claims.expired` (each claim with
`claimedBy`, `claimExpiresAt` and `mine`), `approvals.pending` (every request waiting, `mine` when the
caller asked) and `approvals.decided` (the caller's requests decided in the last 24 hours, with the
`decision`), `ready` (tasks ready to work on that no other agent holds, soonest due first), each
`{ count, items }` with the first 10; `projects` (since 0.13.1), also `{ count, items }`, with the
first 10 active projects in menu order, their notes and task counts as in `list_projects`; and
`nextSteps`, sentences most pressing first that name the tools and the [phase guides](#resources) to use ([schema](schemas/agent-brief.schema.json)). While
agents are paused, `nextSteps` says only that.

### Backlog.md (`import_backlog`, `export_backlog`)

`import_backlog` takes `files: [{ path, content }]`, with paths relative to the backlog folder;
`export_backlog` returns the files and configuration to write. The result contracts are
[backlog-import](schemas/backlog-import.schema.json) and
[backlog-export](schemas/backlog-export.schema.json). See [backlog-md.md](backlog-md.md) for field
mappings, source identity, limits, approvals and safe folder handling.

### Dry runs

Every changing tool takes `dryRun: true`. The change runs with every check, then Dayhand rolls it
back: nothing is saved and nothing enters the history. The result is what the real call would
return, marked `"dryRun": true` (for `set_now` with `taskId: null`, `{ "result": null, "dryRun":
true }`). A dry run of `add_task` shows the number the task would get, but does not reserve it.
A change that would fail fails its dry run with the same error. Dry runs count as changes for
the [limits](#limits).

## Resources

| URI | Type | Content |
|---|---|---|
| `dayhand://today` | `application/json` | `list_today` |
| `dayhand://projects` | `application/json` | `list_projects` (active projects and task counts; since 0.13.1) |
| `dayhand://activity` | `application/json` | `list_events` without `since`: the newest changes and the cursor to follow from |
| `dayhand://activity{?since}` (template) | `application/json` | `list_events` with `since`, e.g. `dayhand://activity?since=c1793011200000123` |
| `dayhand://guide` | `text/markdown` | How an agent should work with Dayhand: numbers, the now task, retries, dry runs, limits |
| `dayhand://workflow/intake` | `text/markdown` | Phase 1 of a task: find or add it, proposal or not, acceptance criteria, plan, dependencies (since 0.12.0) |
| `dayhand://workflow/execution` | `text/markdown` | Phase 2: choose ready work, claim it, tick criteria, ask before risky steps, stop with a checkpoint |
| `dayhand://workflow/finalization` | `text/markdown` | Phase 3: check the criteria, complete with proof, ask the owner for the last step, or hand back |
| `dayhand://tasks/{ref}` (template) | `application/json` | `get_task` of task `#ref`, e.g. `dayhand://tasks/42` |

`resources/list` returns the seven without a template, `resources/templates/list` the two templates. The `helm://`
URIs of the same resources, from before the rename, can still be read. Reading a
resource that does not exist (also a task number that does not) is a JSON-RPC error with
`data: { "uri" }`: `-32602` on 2026-07-28, `-32002` on 2025 revisions.

## Prompts

| Prompt | Arguments | What it starts |
|---|---|---|
| `plan_day` | `focus` (optional) | Go through overdue and today's tasks, agree on an order and set the now task; the Today screen is attached as the resource `dayhand://today` |
| `weekly_review` | | Look back at the last 7 days (board's done column) and ahead at the next 7 (`list_all` with dates), then review projects and tidy the plan |
| `triage_overdue` | | Decide, task by task, what happens to each overdue task; the overdue tasks are attached |
| `plan_health` | | Go through what needs a look, most urgent first; the `plan_health` report is attached (since 0.11.0) |

Each prompt tells the agent to ask before changing anything, to pass a `clientId` and to preview
larger changes with `dryRun`. An unknown prompt or argument is a JSON-RPC error `-32602`.

## Limits

Each API key, and each agent connection (OAuth), may make 120 reads and 60 changes a minute
(`convex/callLimits.ts`). The minute
starts with the first call; reads and changes are counted apart. Reads are tool calls of
read-only tools, `resources/read` of `dayhand://today`, `dayhand://projects`, `dayhand://activity…` and `dayhand://tasks/…`, and `prompts/get`;
listing tools, resources and prompts, `server/discover`, `dayhand://guide` and the `dayhand://workflow/…` guides are not counted.

A call over the limit is refused before it runs, so nothing is applied:

- a tool call returns the tool error `rate_limited` with `retryAfterMs`, HTTP 200 and a
  `Retry-After` header (seconds);
- `resources/read` and `prompts/get` get HTTP 429 with `Retry-After` and the JSON-RPC error
  `{ "code": 429, "message": "Too many reads with this API key: …", "data": { "retryAfterMs" } }`.

`npx convex run callLimits:reset '{"keyId":"<key id>"}'` clears a key's counters
(`'{"connectionId":"<connection id>"}'` a connection's).

## Repeat rules

`repeat` is an object, or an [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10)
RRULE string (with or without `RRULE:`) that the server reads into the object. Every repeating
task also comes back with its rule as an RRULE in `rrule`, e.g. `"FREQ=WEEKLY;BYDAY=MO,TH"`.

| Field | Meaning | RRULE |
|---|---|---|
| `every`, `interval` | every day, week, month or year; `interval` 2 = every other (1 to 366) | `FREQ`, `INTERVAL` |
| `weekdays` | weekly rules: days 1 (Monday) to 7 (Sunday) | `BYDAY=MO,TH` |
| `monthDay` | monthly rules: day 1 to 31, or -1 for the last day | `BYMONTHDAY=15`, `BYMONTHDAY=-1` |
| `weekdayOfMonth` | monthly rules: `{ nth, weekday }`, nth 1 to 5 or -1 (last) to -5 | `BYDAY=2TU`, `BYDAY=-1FR` (or `BYDAY=TU;BYSETPOS=2`) |
| `from` | `"due"` (default): the next date follows the due date; `"completion"`: it is counted from the day the task is done | none |
| `until` | last date the series may fall on, YYYY-MM-DD | `UNTIL=20261231` (a UTC date-time is read in the user's time zone) |
| `count` | occurrences left, this one included; `1` = the last one | `COUNT` |

`until` and `count` cannot be combined (as in RFC 5545). Completing a task counted from the due
date creates the first date of the series after today, so a late completion skips the dates it
missed, and those count against `count`. When the series has ended, `complete_task` returns
`next: null`. The next occurrence keeps the title, note, labels, links and reminders, with the
checklist unticked.

Dayhand reads `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY), `INTERVAL`, `BYDAY`, `BYMONTHDAY`,
`BYSETPOS`, `UNTIL`, `COUNT` and `WKST`; anything else (`BYHOUR`, `BYMONTH`, …) is an
`invalid_argument` naming the part. Where Dayhand differs from RFC 5545:

- A day the month does not have (31 in April) falls on the month's last day; RFC 5545 skips the
  month. `rrule` writes such days as `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, which means the same
  in both, and reads that form back as `monthDay: 31`. A plain `BYMONTHDAY=31` is read as
  `monthDay: 31` too, with Dayhand's meaning.
- A plain monthly rule takes its day from the due date; after a shorter month the next
  occurrence keeps that day as `monthDay` (31 Jan, 28 Feb, 31 Mar).
- A yearly rule from 29 February falls on 28 February in other years and stays there.
- `from: "completion"` has no RRULE form; `rrule` describes the dates only.
- Weeks start on Monday; another `WKST` is refused only where it would change the dates (several
  days every two or more weeks).

The rule logic is in `backend/convex/lib/repeat.ts` (`advance`, and `occurrences` to list a series
ahead, e.g. for a calendar) and `lib/rrule.ts` (`toRRule`, `parseRRule`).

## Checklists and reminders

- `checklist`: items `{ id, title, done }` in the order shown. `update_task` replaces the whole
  list: send the items you keep with their ids, new items without one (the server gives `c1`,
  `c2`, …). `null` or `[]` removes it. At most 100 items of up to 500 characters. History records
  the list before and after each change.
- `reminders`: the task's own reminders instead of the default ones from settings. Each is
  `{ minutesBefore }` (before the due time; rings only for timed tasks) or `{ time: "HH:MM",
  daysBefore? }` (that time on the due day, or up to 30 days before; works for untimed tasks
  too). A task without `reminders` uses the defaults; `[]` means no reminders for this task;
  `null` in `update_task` goes back to the defaults. At most 5. Reminders ring on the phone
  ([architecture.md](architecture.md#reminders)).

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
| `not_found` | No such task, project, API key or device for this user | `Task #404 not found` |
| `rate_limited` | Too many calls with this key or connection; `retryAfterMs` says when to try again | `Too many changes with this API key: at most 60 a minute. Try again in 12 s.` |
| `unauthenticated` | Reserved for identity errors inside a tool; a missing, wrong or revoked key or token gets HTTP 401 before any tool runs | |
| `precondition_failed` | The task's state does not allow the change yet: an agent completing a task with unmet acceptance criteria or without a proof summary, `renew_claim` without a claim of yours, deleting a non-empty project without `moveTasksTo`; through the REST API also `If-Match` naming a version the task is no longer at ([api.md](api.md#idempotency-versions-and-dry-runs)) | `Acceptance criteria not met: a2; mark them met with update_task first`; `The task has changed since that version (it is now "1793011200000"); read it again` |
| `conflict` | Another agent holds the task's claim ([Claims](#claims)); pick another task or wait for the time named | `Task #42 is claimed by claude-code until 2026-10-24T14:30:00.000Z` |
| `agents_paused` | The owner paused every agent; reading works, changes wait until they resume (since 0.11.0) | `The owner has paused all agents (holiday): reading works, changes are refused until they resume agents` |
| `forbidden` | Only the owner may do this, or the owner's policy denies the tool to this key, or the owner denied the approval (since 0.11.0) | `Only the owner can accept proposals (in the app or with a cli key)`; `The owner's policy does not let this key call delete_task` |
| `approval_required` | The owner's policy asks first; `approvalId` names the request to wait for, then repeat the same call with it (since 0.11.0) | `The owner's policy asks before this key calls complete_task. Approval request … waits for the owner until …` |
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
  Results have no `resultType`. Dayhand keeps no session, so every request stands alone anyway.
- **2026-07-28**: no `initialize`; a request is served as 2026-07-28 when its `params._meta`
  carries `io.modelcontextprotocol/protocolVersion`. It must also carry
  `io.modelcontextprotocol/clientCapabilities` (else `-32602`, HTTP 400) and the headers
  `MCP-Protocol-Version` (equal to that version), `Mcp-Method` and, for `tools/call`,
  `prompts/get` and `resources/read`, `Mcp-Name` (plain or `=?base64?…?=`), all matching the
  body (else `-32020`, HTTP 400). `server/discover` returns `supportedVersions` (both eras),
  the capabilities and the instructions. Every result has `resultType: "complete"` and
  `_meta["io.modelcontextprotocol/serverInfo"]`; `server/discover`, `tools/list`,
  `prompts/list`, `resources/list` and `resources/templates/list` carry `ttlMs: 300000` and
  `cacheScope: "public"` (`tools/list` of an agent, or of a token with fewer scopes: `private`,
  since it leaves tools out), `resources/read` carries `ttlMs: 0` and `cacheScope: "private"`
  (`dayhand://guide`: public). `ping` no longer exists and unknown methods get HTTP 404.

Not offered in either era: `subscriptions/listen` (and `listChanged` notifications), logging,
completion, sampling, elicitation and the tasks extension. Dayhand never asks the client for
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
npx convex run apiKeys:create '{"userId":"<issuer>|owner","actor":"app","name":"claude-code","scope":"write"}'
```

Give an agent a `write` key, as above: a key without a scope is `full`, and a `full` key also manages the
account (devices, connections, the calendar feed, other keys). Pairing a phone is the owner's alone: an
`agent` key gets `403 forbidden` for a pairing code, whatever its scope.

The app does the same with `app.createApiKey({ name, kind })`; `app.listApiKeys` returns each
key's `kind`.

Since 0.8.0 a key also has a **scope** and may **expire**:

| Scope | On `/mcp` | REST `/api/v1` ([api.md](api.md)) | Account: keys, webhooks, devices, connections, calendar feed |
|---|---|---|---|
| `read` | only the reading tools (`tools/list` shows only them; a change gets `403 insufficient_scope`) | `GET` routes | no (`403`) |
| `write` | every tool | [routes marked read or write](api.md#routes) | no (`403`) |
| `full` | every tool | everything | yes |

Keys without a scope (every key made before 0.8.0) are `full` keys; nothing changes for them.
`expiresAt` (Unix milliseconds) ends a key: after it the key gets `401` like a revoked one.

```sh
npx convex run apiKeys:create '{"userId":"<issuer>|owner","actor":"app","name":"n8n","scope":"read","expiresAt":1798761600000}'
```

Creating and revoking API keys is not an MCP tool on purpose: a key that can mint keys could
outlive its own revocation. Keys are managed by the app (`app.createApiKey`,
`app.revokeApiKey`), by the deployment admin (`npx convex run apiKeys:create`), or with a full
key through `POST /api/v1/keys` (`dayhand key create`). A key made that way can only have scope
`read` or `write`, expires no later than the key that made it, and works only while that key
works: revoking the parent stops it too ([api.md](api.md#api-keys)).

Phone pairing is not an MCP tool either. The CLI pairs phones through separate endpoints
(`/devices/*`, see [pairing.md](pairing.md)) that accept the same API key; only the owner's key (`cli`)
creates pairing codes.

## Versions

`serverInfo.version` is the backend version (`backend/package.json`) and the one clients use
to check compatibility. It follows semver: a minor version only adds tools, fields, error codes
and accepted values; a major version may change or remove them. A client written for 0.3
works with any 0.x from 0.3 on.

| Version | Changes |
|---|---|
| 0.13.2 | App-only restoration of a confirmed local repeat into its parent's project, including an archived project; no change to `add_task` or REST task creation. Deploy before Android 0.12.0. |
| 0.13.1 | [Project tools](#projects): `list_projects`, `add_project`, `update_project`, owner-only `delete_project`; [REST project routes](api.md#projects); `dayhand://projects`, active projects in `agent_brief`, project output schemas; OpenAPI documents `POST /import`'s `projectId` |
| 0.13.0 | [Project selectors](#projects), [export fields](#export-formats) and [Backlog.md targeting](backlog-md.md#using-it); [backend project support and client availability](architecture.md#projects) |
| 0.12.0 | Phase guides and Backlog.md ([agent-work.md](agent-work.md#9-phase-guides-and-the-agent-brief), [backlog-md.md](backlog-md.md)): resources `dayhand://workflow/intake`, `dayhand://workflow/execution` and `dayhand://workflow/finalization`; `agent_brief`; `import_backlog` and `export_backlog` (source kind `backlog-md`) |
| 0.11.0 | Agents and the owner ([agent-work.md](agent-work.md)): `request_approval`, `get_approval`, `list_approvals`, `decide_approval`; `get_agent_controls`, `pause_agents`, `set_tool_policy`, and `approvalId` on every change an agent makes; proposals (`add_task` takes `proposal`, `source`, `requestedBy`, `returnTo`; task fields `proposedAt`, `source`, `requestedBy`, `returnTo`, `mergedInto`; `list_all` takes `proposed`; `accept_proposal`, `merge_proposal`, `reject_proposal`); `plan_health` and the prompt `plan_health`; error codes `agents_paused`, `forbidden`, `approval_required` (with `approvalId`); webhook events `approval.decided` and `task.returned`; the owner's tools (O) are left out of an agent's `tools/list` |
| 0.10.0 | Agent work ([agent-work.md](agent-work.md)): `list_events` and the resource `dayhand://activity` (the activity log); task fields `acceptance`, `plan`, `proof`, `dependsOn`, `blockedReason`, `claimedBy`, `claimExpiresAt`; `complete_task` takes `proof`; `list_all` takes `ready`; `claim_task`, `renew_claim`, `release_task`; error code `conflict`, and `precondition_failed` outside `If-Match` too |
| 0.9.0 | The rename to Dayhand: `serverInfo.name` `dayhand`; resources `dayhand://today`, `dayhand://guide` and `dayhand://tasks/{ref}` (the `helm://` URIs are still read); new API keys start with `dayhand_` (`helm_` keys keep working); import format `dayhand-json` (`helm-json` still accepted); `WWW-Authenticate` realm `dayhand`; `x-dayhand-scope` in the OpenAPI document; problem types under `https://schemas.dayhand.invalid/`; deployment variables `DAYHAND_*` (`HELM_*` still read, [deploy.md](deploy.md#renamed-variables)) |
| 0.8.0 | API keys with a `scope` (`read`, `write`, `full`) and `expiresAt` (a read key sees and calls only reading tools); the error code `precondition_failed` (REST `If-Match` only); the REST API `/api/v1` with OpenAPI 3.1 ([api.md](api.md)), webhooks ([webhooks.md](webhooks.md)) and import. Devices, connections and the calendar feed need a full key |
| 0.7.0 | `export_plan` format `ics`; the read-only calendar feed `GET /cal/<token>.ics` and its endpoints `/calendar/feed*` ([calendar.md](calendar.md)) |
| 0.6.0 | OAuth 2.1 for the Claude apps and other MCP clients: access tokens next to API keys, `WWW-Authenticate` with `resource_metadata`, scopes `tasks:read` and `tasks:write` (`tools/list` filtered, `403 insufficient_scope`), limits per connection ([oauth.md](oauth.md)) |
| 0.5.0 | Repeat rules: `from`, `monthDay`, `weekdayOfMonth`, `until`, `count`, RRULE strings in `repeat` and `rrule` on repeating tasks; `checklist` and `reminders` on tasks; `complete_task` returns `next: null` when a series has ended |
| 0.4.0 | MCP 2026-07-28 next to the 2025 revisions; tool titles, all behaviour hints and output schemas; `list_all` search, filters and pages (`total`, `nextCursor`); `dryRun` on every change; resources `helm://today`, `helm://guide`, `helm://tasks/{ref}`; prompts `plan_day`, `weekly_review`, `triage_overdue`; limits per key and error `rate_limited`; structured content for a Markdown export; `Origin` check |
| 0.3.0 | Task numbers (`ref`, `taskId: "#42"`); error codes in `structuredContent.error`; key kinds and named actors in history (`actor: "cli"`, `actorName`, `by`) |
| 0.2.0 | Phone pairing endpoints (`/devices/*`, `/auth/*`) |
| 0.1.0 | MCP endpoint with 17 tools |

## Connecting a client

The Claude apps (claude.ai, Desktop, Android, iOS) add Dayhand as a custom connector with the URL
`<deployment HTTP actions URL>/mcp` and sign in with OAuth; the owner approves the connection
on the phone. The steps are in [oauth.md](oauth.md#connecting-the-claude-app-manual-procedure).

Any MCP client with Streamable HTTP and custom headers works with an API key, for example:

```sh
claude mcp add --transport http dayhand http://127.0.0.1:3211/mcp \
  --header "Authorization: Bearer $DAYHAND_API_KEY"
```
