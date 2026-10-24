# dayhand command reference

<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->

`dayhand` is the Dayhand command line client. Every command is one or more MCP tool calls on the
same `/mcp` endpoint the agent uses (see [mcp.md](mcp.md)); `dayhand call` reaches any tool directly.

`dh` is a shorter name for the same command. On Debian and Ubuntu, debhelper has a `dh` command of
its own; type `dayhand` there. `hlm`, the old name, still works until 1.0 and warns on every run.

Task references: `#42` or `42` (the task number), `now` (the now task) or the task id.
Without a command, `dayhand` shows Today.

## Commands

| Command | Calls | `--json` schema | Summary |
|---|---|---|---|
| `dayhand today` | `list_today` | [today](schemas/today.schema.json) | The Today screen: now task, overdue, today and done today (also plain `dayhand`) |
| `dayhand add <title...> [options]` | `add_task` | [task](schemas/task.schema.json) | Add a task (due today unless --due or --no-due) |
| `dayhand list [options]` | `list_all` | [task-list](schemas/task-list.schema.json) | Open tasks, oldest due first (with --done also done ones); filters narrow the list |
| `dayhand board [options]` | `board` | [board](schemas/board.schema.json) | Kanban board: todo, doing and done columns |
| `dayhand show <ref>` | `get_task` | [task-detail](schemas/task-detail.schema.json) | One task with its change history (who changed what, when) |
| `dayhand edit <ref> [options]` | `update_task` | [task](schemas/task.schema.json) | Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR |
| `dayhand note <ref> [text...] [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it |
| `dayhand checklist <ref> [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's checklist, or tick, untick, move, remove and add items |
| `dayhand move <ref> <date> [options]` | `reschedule_task` | [task](schemas/task.schema.json) | Move a task to another day, optionally with a time (none removes the date) |
| `dayhand done <refs...> [options]` | `complete_task` | [complete](schemas/complete.schema.json) | Mark tasks done, optionally with proof; a repeating task gets its next occurrence |
| `dayhand start <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set tasks to doing |
| `dayhand stop <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set tasks back to todo (from doing) |
| `dayhand reopen <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set done tasks back to todo |
| `dayhand now [ref] [options]` | `set_now`, `list_today` | [set-now](schemas/set-now.schema.json), [today](schemas/today.schema.json) | Show the now task, make a task the now task (--note: where you stopped), or --clear |
| `dayhand archive <refs...>` | `archive_task` | [task](schemas/task.schema.json) | Archive tasks: off Today and the board, kept in exports |
| `dayhand rm <refs...>` | `delete_task` | [task](schemas/task.schema.json) | Move tasks to the trash (purged after 30 days) |
| `dayhand restore <refs...>` | `restore_task` | [task](schemas/task.schema.json) | Restore tasks from the trash (or the archive) |
| `dayhand trash` | `list_trash` | [task-list](schemas/task-list.schema.json) | Tasks in the trash, newest first |
| `dayhand log [options]` | `list_events` | [event-list](schemas/event-list.schema.json) | The activity log: task changes after a cursor or a time, oldest first (who changed what) |
| `dayhand claim <ref> [options]` | `claim_task` | [task](schemas/task.schema.json) | Claim a task for a while (default 120 minutes) so other agents leave it alone |
| `dayhand renew <ref> [options]` | `renew_claim` | [task](schemas/task.schema.json) | Extend your claim of a task by --minutes from now (default 120) |
| `dayhand release <ref> [options]` | `release_task` | [task](schemas/task.schema.json) | End your claim of a task, optionally leaving a checkpoint as its resume note |
| `dayhand criteria <ref> [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's acceptance criteria, or mark them met, unmet, remove and add them |
| `dayhand ask <action...> [options]` | `request_approval` | [approval](schemas/approval.schema.json) | Ask the owner to decide before you do something; they answer on the phone |
| `dayhand approval <id> [options]` | `get_approval` | [approval](schemas/approval.schema.json) | One approval request and, once decided, the owner's choice |
| `dayhand approvals [options]` | `list_approvals` | [approval-list](schemas/approval-list.schema.json) | Approval requests, newest first |
| `dayhand approvals decide <id> <option> [options]` | `decide_approval` | [approval](schemas/approval.schema.json) | Pick an option of a pending approval request |
| `dayhand agents` | `get_agent_controls` | [agent-controls](schemas/agent-controls.schema.json) | Whether agents are paused, and the tool policies of agent keys |
| `dayhand agents pause [options]` | `pause_agents` | [agent-controls](schemas/agent-controls.schema.json) | Pause every agent: they can read, their changes are refused until you resume them |
| `dayhand agents resume` | `pause_agents` | [agent-controls](schemas/agent-controls.schema.json) | Let agents change the plan again |
| `dayhand policy` | `get_agent_controls` | [agent-controls](schemas/agent-controls.schema.json) | Tool policies of agent keys: allow, ask (the owner approves each call) or deny |
| `dayhand policy set <key> <tool> <rule>` | `set_tool_policy` | [agent-controls](schemas/agent-controls.schema.json) | Set one agent key's rule for a tool that changes the plan, or "*" for every such tool |
| `dayhand proposals` | `list_all` | [task-list](schemas/task-list.schema.json) | The proposal inbox: tasks agents and integrations proposed, waiting for you |
| `dayhand proposals accept <ref>` | `accept_proposal` | [task](schemas/task.schema.json) | Accept a proposal: it joins the plan as it is |
| `dayhand proposals merge <ref> [options]` | `merge_proposal` | [merge](schemas/merge.schema.json) | Merge a proposal into a task already in the plan; the proposal goes to the trash |
| `dayhand proposals reject <ref> [options]` | `reject_proposal` | [task](schemas/task.schema.json) | Reject a proposal: it goes to the trash (restorable for 30 days) |
| `dayhand health` | `plan_health` | [plan-health](schemas/plan-health.schema.json) | What needs a look: overdue, blocked, stale claims, approvals, proposals, done without proof |
| `dayhand settings` | `get_settings` | [settings](schemas/settings.schema.json) | Show settings (time zone, morning summary time, default reminders) |
| `dayhand settings get` | `get_settings` | [settings](schemas/settings.schema.json) | Show settings |
| `dayhand settings set <pairs...>` | `update_settings` | [settings](schemas/settings.schema.json) | Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders) |
| `dayhand export [options]` | `export_plan` | [export](schemas/export.schema.json) | Export the whole plan as Markdown, JSON (with history) or iCalendar (ics) |
| `dayhand tools [name]` | `tools/list` | [tools](schemas/tools.schema.json), [tool](schemas/tool.schema.json) | MCP tools and their input schemas (introspection) |
| `dayhand call <tool> [json]` | `*` | the tool's | Call an MCP tool with JSON arguments, exactly as an MCP client would |
| `dayhand version` | `initialize` | [version](schemas/version.schema.json) | CLI and server versions, and whether they are compatible |
| `dayhand pair [options]` | `/devices/pairing-code` | [pairing](schemas/pairing.schema.json) | One-time code (10 minutes) that signs the phone app in as you |
| `dayhand device` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones (same as dayhand device list); revoke one with dayhand device revoke |
| `dayhand device list` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones |
| `dayhand device revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Sign a phone out: it gets no new app tokens |
| `dayhand devices` | `/devices` | [devices](schemas/devices.schema.json) | Same as dayhand device list |
| `dayhand connection` | `/connections` | [connections](schemas/connections.schema.json) | Agent connections approved on the phone (OAuth, e.g. the Claude app); revoke one with dayhand connection revoke |
| `dayhand connection list` | `/connections` | [connections](schemas/connections.schema.json) | Agent connections |
| `dayhand connection revoke <connectionId>` | `/connections/revoke` | [connection-revoke](schemas/connection-revoke.schema.json) | Disconnect an agent: its tokens stop working at once |
| `dayhand connections` | `/connections` | [connections](schemas/connections.schema.json) | Same as dayhand connection list |
| `dayhand revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Same as dayhand device revoke |
| `dayhand calendar` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as dayhand calendar url) |
| `dayhand calendar url` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Show the feed's addresses (null when it is off) |
| `dayhand calendar on` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Turn the feed on (keeps an existing address) and show it |
| `dayhand calendar rotate` | `/calendar/feed/rotate` | [calendar-feed](schemas/calendar-feed.schema.json) | A new secret address; the old one stops working at once |
| `dayhand calendar off` | `/calendar/feed/revoke` | [calendar-revoke](schemas/calendar-revoke.schema.json) | Turn the feed off; its address stops working |
| `dayhand calendar export [options]` | `export_plan` | [export](schemas/export.schema.json) | The plan as a one-time .ics file to import (does not need the feed) |
| `dayhand key` | `/api/v1/keys` | [api-key-list](schemas/api-key-list.schema.json) | API keys for integrations: list, create with a scope and an expiry, revoke (same as dayhand key list) |
| `dayhand key list` | `/api/v1/keys` | [api-key-list](schemas/api-key-list.schema.json) | Every API key with its kind, scope and expiry (never the key itself) |
| `dayhand key create <name> [options]` | `/api/v1/keys` | [api-key-created](schemas/api-key-created.schema.json) | Create a key (printed once) that reads or writes, for an integration |
| `dayhand key revoke <keyId>` | `/api/v1/keys` | [api-key-revoke](schemas/api-key-revoke.schema.json) | Revoke a key; the keys it created stop working too |
| `dayhand webhook` | `/api/v1/webhooks` | [webhook-list](schemas/webhook-list.schema.json) | Webhooks: HTTPS addresses that get a signed message for every task change (same as dayhand webhook list) |
| `dayhand webhook list` | `/api/v1/webhooks` | [webhook-list](schemas/webhook-list.schema.json) | Every webhook, whether it is on, and why it was turned off |
| `dayhand webhook add <url> [options]` | `/api/v1/webhooks` | [webhook-created](schemas/webhook-created.schema.json) | Add a webhook; prints its signing secret once |
| `dayhand webhook rm <webhookId>` | `/api/v1/webhooks` | [webhook-delete](schemas/webhook-delete.schema.json) | Remove a webhook and its delivery log |
| `dayhand webhook test <webhookId>` | `/api/v1/webhooks` | [webhook-test](schemas/webhook-test.schema.json) | Send a webhook.test message now (also to a webhook that is off) |
| `dayhand webhook enable <webhookId>` | `/api/v1/webhooks` | [webhook-one](schemas/webhook-one.schema.json) | Turn a webhook back on after it was turned off for failing |
| `dayhand webhook deliveries <webhookId> [options]` | `/api/v1/webhooks` | [webhook-delivery-list](schemas/webhook-delivery-list.schema.json) | The delivery log: newest first, each attempt's HTTP status or error |
| `dayhand import <file> [options]` | `/api/v1/import` | [import-result](schemas/import-result.schema.json) | Import tasks from Dayhand's JSON export, an iCalendar file or a Todoist CSV export |
| `dayhand backlog import <dir>` | `import_backlog` | [backlog-import](schemas/backlog-import.schema.json) | Import a Backlog.md folder: each task file becomes a task; files imported before are skipped |
| `dayhand backlog export [dir] [options]` | `export_backlog` | [backlog-written](schemas/backlog-written.schema.json), [backlog-export](schemas/backlog-export.schema.json) | Write the plan as Backlog.md task files into a folder (without one, --json prints the files) |
| `dayhand login [options]` | `get_settings` | [login](schemas/login.schema.json) | Store an API key for the deployment in the OS keychain (or a private file) |
| `dayhand logout` | - | [logout](schemas/logout.schema.json) | Remove the stored API key for the deployment (keychain and file) |
| `dayhand whoami` | `initialize`, `get_settings` | [whoami](schemas/whoami.schema.json) | Which deployment, profile, key source and config file dayhand uses, checked against the server |
| `dayhand server deploy [options]` | `get_settings` | [server](schemas/server.schema.json), [server-plan](schemas/server-plan.schema.json) | Set up or update your server on your own Convex account, sign dayhand in and make a pairing code |
| `dayhand server start [options]` | `get_settings` | [server](schemas/server.schema.json), [server-plan](schemas/server-plan.schema.json) | Run your server on this computer (Convex local backend, no account) until Ctrl+C, sign dayhand in |
| `dayhand prime` | `agent_brief`, `list_today` | [agent-brief](schemas/agent-brief.schema.json), [today](schemas/today.schema.json) | Context for an AI agent: Today, its claims, approvals, ready work, next steps and how to use dayhand (for a SessionStart hook) |
| `dayhand when <phrase...> [options]` | `get_settings` | [when](schemas/when.schema.json) | Show the day (and time) a date phrase means in your time zone, without changing anything |
| `dayhand completion <shell>` | - | [completion](schemas/completion.schema.json) | Print the shell completion script for bash, zsh, fish or powershell (dayhand help completion) |
| `dayhand ui [options]` | `list_today`, `board`, `list_all`, `list_trash`, `get_task`, `get_settings`, `add_task`, `update_task`, `set_status`, `set_now`, `complete_task`, `reschedule_task`, `delete_task`, `restore_task` | - | Dayhand full screen in the terminal: Today, board, week and trash, with keys like vim and lazygit (dayhand help ui) |

## Global options

| Option | Meaning |
|---|---|
| `--json` | Print the tool's structuredContent as JSON; errors as JSON on stderr |
| `--plain` | Tab-separated text without headers (for scripts) |
| `--fields <names>` | Comma-separated task (or settings) fields for JSON and columns |
| `--client-id <id>` | Operation id for safe retries (default: generated, shown on errors) |
| `--approval <id>` | Run a change the owner's policy held back, with the approval request they allowed (exit 7 names it) |
| `-y, --yes` | Confirm changing many tasks at once |
| `--no-input` | Never prompt (also DAYHAND_NO_INPUT=1); prompts need a terminal anyway |
| `--dry-run` | Show the changes a command would make (dates resolved), checked by the backend, and save nothing |
| `--url <url>` | Deployment HTTP actions URL (default: DAYHAND_URL, then config.toml) |
| `--profile <name>` | Profile from config.toml (default: DAYHAND_PROFILE, then default_profile) |
| `--color <when>` | Colors in the human format (auto, always, never) |
| `--no-color` | Same as --color never (NO_COLOR=1 works too) |

## JSON output

- `--json` (or `DAYHAND_FORMAT=json`) prints the tool's `structuredContent` exactly as an MCP
  client receives it; schemas are in [schemas/](schemas/). Indented on a terminal, one line in a pipe.
- Fields may be added in a minor version; they are never removed or retyped within a major version.
- A list tool returns `{"result": [...]}`. A command given several tasks returns `{"results": [...]}`,
  one tool result per task. `--fields a,b` keeps only those fields of every task (or of the settings).
- `dayhand now` without a task prints `list_today`; `dayhand note <ref>` without text prints `get_task`.
- A Markdown export's JSON is `{"format":"markdown","content":"…"}`.
- Errors go to stderr as one line: `{"error":{"code","message","exitCode","retryable","clientId",…}}`
  ([schema](schemas/error.schema.json)); stdout stays empty. Warnings are `{"warning":{…}}` lines.
- `--plain` prints tab-separated rows without headers: `ref status dueDate dueTime title labels`
  (or the `--fields`); views with sections (Today, board) start each row with the section name.
- `dayhand list` filters (`--status`, `--overdue`, `--due-before`, `--due-after`, `--search`, `--limit`, `--cursor`)
  run on the backend and keep list_all's shape: `{"result": [...], "total", "nextCursor"}`. With `--limit`, pass
  `nextCursor` as `--cursor` for the next page. A backend older than 0.4.0 has no `total` and `nextCursor`;
  dayhand then filters its full list itself.
- `--dry-run` on a command that changes something prints `{"dryRun":true,"calls":[{"tool","arguments","result"}]}`
  ([schema](schemas/dry-run.schema.json)) with dates resolved. The backend checks each change and returns
  what it would give (`result`) without saving anything; reads still happen. A backend older than 0.4.0
  and the device endpoints get nothing: their calls are only listed.

## Human output

Tables are aligned by display width; due days read as `today`, `tomorrow`, `yesterday` or
`Fri 23 Oct` in your time zone. A terminal gets colors (`--color auto|always|never`, `--no-color`,
`[ui] color`, `NO_COLOR`) and long titles cut to its width; a pipe gets the same text without
colors or cutting. `dayhand board` shows its columns side by side on terminals 90 columns or wider.
On a terminal, `dayhand note <ref>` and `dayhand edit <ref>` without options open `$VISUAL`/`$EDITOR`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including a change that was already applied (no-op) |
| 1 | Other error (internal) |
| 2 | Usage: unknown command or flag, bad value or date, --yes missing, broken config.toml |
| 3 | Authentication: no key (dayhand login or DAYHAND_API_KEY), or a wrong or revoked one |
| 4 | Not found: no such task (#n), device or now task |
| 5 | Server unavailable (network, timeout, HTTP 5xx): the change may have been applied; retry with the same --client-id. Also too many calls with the key (rate_limited): nothing was applied; run it again after the wait the message names |
| 6 | Refused by the task's state, nothing applied: another agent holds the task's claim (conflict), or its acceptance criteria are not met or the proof has no summary (precondition_failed) |
| 7 | Refused by the owner, nothing applied: agents are paused (agents_paused), only the owner may do this or a tool policy denies it (forbidden), or the policy asks first (approval_required: wait for dayhand approval <approvalId>, then rerun with --approval <approvalId>) |
| 130 | Interrupted (Ctrl-C) |

Backend error codes map to exit codes: `invalid_argument` → 2, `unauthenticated` → 3,
`not_found` → 4, `rate_limited` → 5, `conflict` and `precondition_failed` → 6, `agents_paused`, `forbidden` and
`approval_required` → 7, `internal` and unknown codes → 1.

## Retries

Every change carries a `clientId`: `--client-id <id>`, or a generated one that is printed with
any error. After exit code 5, run the same command line with that `--client-id`: the backend does
not apply an operation twice. A command given several tasks uses `<id>:1`, `<id>:2`, … per task.

## Prompts

Changing 3 or more tasks at once needs `--yes`. On a terminal dayhand asks instead; without a
terminal (or with `--no-input` / `DAYHAND_NO_INPUT=1`) it never waits for input and exits with 2.

## Environment

| Variable | Meaning |
|---|---|
| `DAYHAND_URL` | Deployment HTTP actions URL, e.g. https://<deployment>.convex.site (wins over config.toml) |
| `DAYHAND_API_KEY` | API key; wins over the key stored by dayhand login (give agents and CI their own, kind agent) |
| `DAYHAND_PROFILE` | Profile from config.toml (--profile wins) |
| `DAYHAND_FORMAT` | json, plain or human: default output format (flags win) |
| `DAYHAND_NO_INPUT` | 1 to never prompt |
| `DAYHAND_CONFIG_DIR` | Folder of config.toml and credentials.json (default: the system's config folder) |
| `DAYHAND_CACHE_DIR` | Folder of the completion cache (default: the system's cache folder) |
| `DAYHAND_CREDENTIAL_STORE` | keychain or file: where dayhand login keeps keys (default: keychain, else file) |
| `NO_COLOR, FORCE_COLOR` | Turn colors off or on when neither --color nor config.toml decides |
| `VISUAL, EDITOR` | Editor for dayhand note <ref> and dayhand edit <ref> on a terminal (default: vi, notepad on Windows) |
| `HLM_*, HELM_URL, HELM_API_KEY, HELM_BACKEND_DIR, HELM_SERVER_CONFIG_DIR` | Old names (the hlm and helm commands), still read when the DAYHAND_* name is unset, with a warning |

## Topic: dates

`dayhand help dates`

```text
Dates (--due, dayhand move, dayhand list --due-before/--due-after, dayhand when)

Dates are English phrases resolved in your time zone from the server settings
(dayhand settings), not the computer's. The same phrase at the same moment always
gives the same day. Try one with: dayhand when "<phrase>", or add --dry-run to a command.

  Days        today (tod), tomorrow (tmr), yesterday, day after tomorrow
  Weekdays    fri, friday, on mon: the first such day after today
              this fri: this week's (today included); next fri: next week's (weeks start on Monday)
  Periods     next week (its Monday), next month (the 1st), next year, weekend, next weekend
              eow / end of week (Sunday), eoww / end of work week (Friday),
              eom / end of month, eoy / end of year
  Relative    in 3 days, in a week, in 2 months, in 1 year, +3d, +2w, +1mo, +1y
              in 2 hours, in 30 min, +3h: a day and a time
  Calendar    23 oct, 23rd of october, oct 23, oct 23 2027, the 15th, 2026-10-23
              (without a year: the next such day, today included)
  Times       14:00, 9:30, 2pm, 2:30 pm, at 9, noon, midnight
              alone: today, or tomorrow once that time has passed
  Together    tomorrow at 9am, fri 14:30, 9am tomorrow, at 3pm on friday, in 3 days at 8:15

A time that does not exist because the clocks go forward (01:30 on the last
Sunday of March in London) moves forward by the gap (to 02:30) with a warning.
YYYY-MM-DD, today and tomorrow are sent to the server as typed; every other
phrase is sent as YYYY-MM-DD (and HH:MM). Anything else is refused (exit 2),
never guessed.

Examples: today, tomorrow, fri, next mon, this weekend, in 3 days, +2w, in 2 hours, eow, eom, 23 oct, oct 23 2027, 2026-10-23, 14:00, 2pm, noon, tomorrow at 9am, fri 14:30
```

## Topic: config

`dayhand help config`

```text
Configuration (config.toml)

The file lives in:
  Linux     $XDG_CONFIG_HOME/dayhand/config.toml (~/.config/dayhand/config.toml)
  macOS     ~/Library/Application Support/dayhand/config.toml
  Windows   %APPDATA%\dayhand\config.toml
or in $DAYHAND_CONFIG_DIR. dayhand whoami prints the one in use. dayhand login creates it.

  url = "https://<deployment>.convex.site"     # used when no profile is chosen
  default_profile = "personal"

  [profiles.personal]
  url = "https://<deployment>.convex.site"

  [profiles.work]
  url = "https://<other>.convex.site"

  [aliases]
  home = "list -l home --status todo,doing"    # dayhand home --json
  week = "list --due-before eow"

  [ui]
  color = "auto"                               # auto, always or never

Precedence. URL: --url, the profile named by --profile, DAYHAND_URL, the profile from
DAYHAND_PROFILE or default_profile, then the top-level url. Key: DAYHAND_API_KEY, then the
key dayhand login stored for that URL. Colors: --color/--no-color, [ui] color,
NO_COLOR/FORCE_COLOR, then whether the output is a terminal.

The API key never goes into this file: dayhand refuses keys named api_key, key,
token, secret or password. An unknown key or a wrong value is an error that names
the file and the key (exit 2). Aliases cannot hide a built-in command.
```

## Topic: login

`dayhand help login`

```text
Signing in (dayhand login, dayhand logout, dayhand whoami)

  dayhand login --url https://<deployment>.convex.site   # paste the key at the hidden prompt
  dayhand login --with-key < key.txt                     # or pipe it (scripts)
  dayhand whoami                                         # URL, profile, where the key came from
  dayhand logout

dayhand server deploy and dayhand server start make a key of kind cli and sign
in by themselves. For another computer, make one where dayhand is signed in
(dayhand key create laptop --kind cli --scope write) or with
npx convex run apiKeys:create. dayhand login checks it against the server, then stores
it for that URL in the OS keychain: macOS Keychain, Windows Credential Manager or
the Secret Service on Linux (GNOME Keyring, KWallet, KeePassXC). Without one (a
server, Omarchy without a keyring daemon) it says so and keeps the key in
credentials.json next to config.toml, readable only by you (mode 0600).
DAYHAND_CREDENTIAL_STORE=file or --store file chooses the file on purpose.

DAYHAND_API_KEY, when set, wins over the stored key: give agents and CI their own key
(kind agent) that way. The keychain keeps the key out of dotfiles, backups and shell
history; it does not hide it from programs running as you.
```

## Topic: completion

`dayhand help completion`

```text
Shell completion (dayhand completion <shell>)

  bash         echo 'source <(dayhand completion bash)' >> ~/.bashrc
  zsh          dayhand completion zsh > "${fpath[1]}/_dayhand"     (or source <(dayhand completion zsh) after compinit)
  fish         dayhand completion fish | tee ~/.config/fish/completions/{dayhand,dh}.fish >/dev/null
  PowerShell   dayhand completion powershell | Out-String | Invoke-Expression   (add it to $PROFILE)

Completes commands, aliases from config.toml, options and their values, task
numbers with their titles, labels, profiles and date words. Task numbers and
labels come from one list_all call, cached for 60 seconds in the cache folder
(~/.cache/dayhand, ~/Library/Caches/dayhand or %LOCALAPPDATA%\dayhand\Cache). Completion
never prompts and prints nothing when it cannot reach the server.
```

## Topic: ui

`dayhand help ui`

```text
The terminal app (dayhand ui)

dayhand ui opens Dayhand full screen in the terminal: Today (overdue, the now task with
its resume note, today, done today), the board, the week (Monday to Sunday as
bars, the selected day in full below) and the trash. Enter opens a task with its
history, which names who made each change: app, cli or agent: <name>. It uses
the key from dayhand login and the same MCP tools as the other commands, refreshes
what is on screen every 12 seconds (--interval) within the key's limits, and
keeps the last data on screen with a red status line when the server cannot be
reached. Colours are the terminal's 16 ANSI colours, so its theme applies.
The mouse selects and scrolls (--no-mouse leaves it to the terminal).

Quick add (a) reads a date phrase at the end or the start of the line, and
#labels anywhere: "Call the accountant fri 2pm #home". The line below shows how
it was read before Enter adds it; "no date" adds no day, quotes keep it literal.

Move:
  j k  ↓ ↑            Next / previous task
  h l  ← →            Board column, week day
  g G  Home End       First / last task
  C-d C-u  PgDn PgUp  Half a page down / up
  Enter               Open a task (an empty day: add)
  Esc                 Back; clears the filter

Views:
  Tab S-Tab           Next / previous view
  1 2 3 4             Today, Board, Week, Trash
  /                   Filter: title, #label, note, #42
  R                   Refresh now (also every 12 s)
  ?                   This help
  q  C-c              Quit (q in details: back)

Tasks:
  a                   Add: Pay rent fri 2pm #home
  Space x             Done / not done (repeats go on)
  s                   Start (doing) / stop (todo)
  n                   Now task, with a resume note
  N                   Clear the now task
  e                   Edit title, due, labels, resume note
  E                   Title and note in $EDITOR
  m                   Move: tomorrow, fri 9am, none
  d                   To the trash (asks); u undoes
  r                   Restore (in the trash)

Board and week:
  H L                 Board: column left / right
  H L                 Week: a day earlier / later
  [ ]                 Week: previous / next week
  t                   Week: this week

Typing:
  Enter Esc           Save / cancel
  Tab S-Tab           Next / previous field (edit)
  ← → C-a C-e         Move the cursor; start / end
  C-u C-k C-w         Delete to start / to end / a word

The layout and keys owe a lot to Backlog.md (github.com/MrLesk/Backlog.md, MIT)
and lazygit; no code is taken from either.
```

## Command details

### dayhand today

The Today screen: now task, overdue, today and done today (also plain `dayhand`)

```
dayhand today
```

```sh
dayhand
dayhand today --json
dayhand today --plain --fields ref,title
```

### dayhand add

Add a task (due today unless --due or --no-due)

```
dayhand add <title...> [options]
```

- `title`: Task title

| Option | Meaning |
|---|---|
| `--due <when>` | Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (dayhand help dates) |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
| `--month-day <day>` | Monthly repeat on day 1-31 (a shorter month: its last day) or last |
| `--month-weekday <day>` | Monthly repeat on a weekday: "2 tue", "last fri" |
| `--from-completion` | Count the next date from the day the task is done, not its due date |
| `--until <date>` | Last date the repeat may fall on (dayhand help dates) |
| `--count <n>` | How many times it repeats, this one included |
| `--rrule <rule>` | The rule as RFC 5545 RRULE instead, e.g. "FREQ=MONTHLY;BYDAY=-1FR" |
| `--no-due` | No due day: the task shows only in list and board |
| `-l, --label <label>` | Label (repeatable) |
| `--note <text>` | Note |
| `--status <status>` | Initial status (todo, doing) |
| `--resume-note <text>` | Where you stopped / next step |
| `--link <url>` | Link, optionally followed by a title: "https://… Title" (repeatable) |
| `--item <text>` | Checklist item (repeatable, in order) |
| `--remind <when>` | This task's reminder instead of the defaults: 0, 15m, 2h, 1d (before the due time), 09:00 or "18:00 -1d" (repeatable) |
| `--no-reminders` | No reminders for this task |
| `--accept <text>` | Acceptance criterion: what done means (repeatable, in order) |
| `--plan <text>` | How the work will be done |
| `--depends-on <ref>` | A task that must be done first (repeatable) |
| `--blocked <reason>` | Why the task cannot go on; a blocked task is not ready |
| `--propose` | A proposal: it waits in the owner's inbox, out of Today, until accepted |
| `--source <source>` | Where it comes from, "<kind>:<ref>" optionally followed by a URL; one source makes one task |
| `--requested-by <who>` | Who asked for it |
| `--return-to <webhookId>` | A webhook that hears, with the proof, when the task closes (dayhand webhook list) |

```sh
dayhand add Call the accountant --due "fri 2pm" -l home
dayhand add Pay rent --due "1 nov" --dry-run
dayhand add "Review the plan" --time 09:00 --every week --on mon,thu
dayhand add Payroll --due 2026-10-30 --month-weekday "last fri" --remind "09:00 -1d"
dayhand add Water plants --every day --interval 3 --from-completion
dayhand add Pack --due fri --item passport --item charger
dayhand add Buy a present --no-due --json
dayhand add "Ship the export" --no-due --accept "CSV opens in a spreadsheet" --plan "write, then test" --depends-on 41
dayhand add "Checkout times out" --propose --source "sentry:CHECKOUT-42 https://sentry.example.com/issues/42"
```

### dayhand list

Open tasks, oldest due first (with --done also done ones); filters narrow the list Aliases: `ls`.

```
dayhand list [options]
```

| Option | Meaning |
|---|---|
| `-l, --label <label>` | Only tasks with this label (repeatable: all must match) |
| `--done` | Include done tasks |
| `--archived` | Include archived tasks |
| `--status <statuses>` | Only these statuses, comma-separated: todo, doing, done (done implies --done) |
| `--overdue` | Only overdue tasks |
| `--ready` | Only tasks ready to work on: not done, not blocked, every dependency done (backend 0.10.0) |
| `--due-before <when>` | Only tasks due before this day, e.g. eow, next mon, 2026-11-01 |
| `--due-after <when>` | Only tasks due after this day, e.g. today |
| `--search <text>` | Only tasks whose title, note, resume note or labels contain the text (any case) |
| `--limit <n>` | At most this many tasks; the JSON's nextCursor continues the list |
| `--cursor <cursor>` | Continue a list cut by --limit: the nextCursor of the previous page |

```sh
dayhand list -l home --status todo,doing
dayhand list --overdue
dayhand list --due-before eow --search accountant --limit 20
dayhand list --limit 50 --cursor <nextCursor> --json
dayhand list --done --json --fields ref,title,status
dayhand list --ready --json
```

### dayhand board

Kanban board: todo, doing and done columns

```
dayhand board [options]
```

| Option | Meaning |
|---|---|
| `--done-limit <n>` | Maximum tasks in the done column (default 50) |

```sh
dayhand board
dayhand board --done-limit 5 --json
```

### dayhand show

One task with its change history (who changed what, when)

```
dayhand show <ref>
```

- `ref`: Task: #42 or 42 (its number), now, or its id

```sh
dayhand show 42
dayhand show now --json
```

### dayhand edit

Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR

```
dayhand edit <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--title <text>` | New title |
| `--note <text>` | Replace the note |
| `--clear-note` | Remove the note |
| `--due <when>` | Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (dayhand help dates) |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
| `--month-day <day>` | Monthly repeat on day 1-31 (a shorter month: its last day) or last |
| `--month-weekday <day>` | Monthly repeat on a weekday: "2 tue", "last fri" |
| `--from-completion` | Count the next date from the day the task is done, not its due date |
| `--until <date>` | Last date the repeat may fall on (dayhand help dates) |
| `--count <n>` | How many times it repeats, this one included |
| `--rrule <rule>` | The rule as RFC 5545 RRULE instead, e.g. "FREQ=MONTHLY;BYDAY=-1FR" |
| `--clear-due` | Remove the due day (and time) |
| `--clear-time` | Remove the due time |
| `--clear-repeat` | Stop repeating |
| `--resume-note <text>` | Where you stopped / next step |
| `--clear-resume-note` | Remove the resume note |
| `-l, --label <label>` | Replace all labels (repeatable) |
| `--add-label <label>` | Add a label (repeatable) |
| `--rm-label <label>` | Remove a label (repeatable) |
| `--clear-labels` | Remove all labels |
| `--link <url>` | Replace all links: "https://… Title" (repeatable) |
| `--clear-links` | Remove all links |
| `--item <text>` | Replace the checklist (repeatable; dayhand checklist edits single items) |
| `--clear-checklist` | Remove the checklist |
| `--remind <when>` | This task's reminder instead of the defaults: 0, 15m, 2h, 1d (before the due time), 09:00 or "18:00 -1d" (repeatable) |
| `--no-reminders` | No reminders for this task |
| `--default-reminders` | Back to the default reminders from settings |
| `--accept <text>` | Replace the acceptance criteria (repeatable; dayhand criteria edits single ones) |
| `--clear-acceptance` | Remove the acceptance criteria |
| `--plan <text>` | How the work will be done |
| `--clear-plan` | Remove the plan |
| `--depends-on <ref>` | Replace the dependencies: a task that must be done first (repeatable) |
| `--clear-depends` | Remove all dependencies |
| `--blocked <reason>` | Why the task cannot go on; a blocked task is not ready |
| `--unblock` | Remove the blocked reason |

```sh
dayhand edit 42 --title "Call the bank" --due "tomorrow 10:00"
dayhand edit 42 --add-label work --rm-label home
dayhand edit 42 --every month --month-day last --until 2027-06-30
dayhand edit 42 --rrule "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
dayhand edit 42 --remind 15m --remind 1d
dayhand edit 42 --clear-repeat
dayhand edit 42 --blocked "waiting for the client's brief"
dayhand edit 42 --depends-on 40 --depends-on 41
dayhand edit 42
```

### dayhand note

Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it

```
dayhand note <ref> [text...] [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id
- `text`: Text to append as a new line

| Option | Meaning |
|---|---|
| `--clear` | Remove the note |

```sh
dayhand note 42
dayhand note 42 "Account number is in the email"
dayhand note 42 --clear
```

### dayhand checklist

Print a task's checklist, or tick, untick, move, remove and add items

Items are numbered from 1 as printed. Changes apply in this order: --check, --uncheck, --move, --rm, then --add.

```
dayhand checklist <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--add <text>` | Add an item at the end (repeatable) |
| `--check <n>` | Tick items: 2, 1,3 or all (repeatable) |
| `--uncheck <n>` | Untick items (repeatable) |
| `--move <from:to>` | Move an item, e.g. 3:1 (repeatable) |
| `--rm <n>` | Remove items (repeatable) |
| `--clear` | Remove the whole checklist |

```sh
dayhand checklist 42
dayhand checklist 42 --add "Book the hotel" --add "Pack"
dayhand checklist 42 --check 1,2
dayhand checklist 42 --move 3:1 --rm 4
```

### dayhand move

Move a task to another day, optionally with a time (none removes the date)

```
dayhand move <ref> <date> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id
- `date`: When: tomorrow, fri 14:00, next mon, 2026-10-23 … or none (dayhand help dates)

| Option | Meaning |
|---|---|
| `--time <HH:MM>` | New due time |
| `--clear-time` | Remove the due time |

```sh
dayhand move 42 tomorrow --time 08:00
dayhand move 42 "next mon 9am"
dayhand move 42 none
```

### dayhand done

Mark tasks done, optionally with proof; a repeating task gets its next occurrence

An agent completing a task with acceptance criteria needs every criterion met (dayhand criteria) and --summary; otherwise it fails with precondition_failed (exit 6).

```
dayhand done <refs...> [options]
```

- `refs`: Tasks: #42 or 42, now, or ids

| Option | Meaning |
|---|---|
| `--summary <text>` | Proof: what was done (an agent needs it for a task with acceptance criteria) |
| `--check <check>` | Proof: a check and its result, "<name>=pass" or "<name>=fail", optionally followed by a URL (repeatable) |
| `--proof-link <url>` | Proof: where to see the result, "https://… Title" (repeatable) |

```sh
dayhand done 42
dayhand done 42 43 now
dayhand done 1 2 3 --yes --client-id 7f3c
dayhand done 42 --summary "Export shipped" --check "unit tests=pass https://ci.example/run/7" --proof-link "https://example.com/pr/7 PR"
```

### dayhand start

Set tasks to doing

```
dayhand start <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand start 42
```

### dayhand stop

Set tasks back to todo (from doing)

```
dayhand stop <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand stop 42
```

### dayhand reopen

Set done tasks back to todo

```
dayhand reopen <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand reopen 42
```

### dayhand now

Show the now task, make a task the now task (--note: where you stopped), or --clear

```
dayhand now [ref] [options]
```

- `ref`: Task to make the now task

| Option | Meaning |
|---|---|
| `--note <text>` | Resume note shown on Today |
| `--clear` | Clear the now task |

```sh
dayhand now
dayhand now 42 --note "have the account number"
dayhand now --clear
```

### dayhand archive

Archive tasks: off Today and the board, kept in exports

```
dayhand archive <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand archive 42
```

### dayhand rm

Move tasks to the trash (purged after 30 days) Aliases: `delete`.

```
dayhand rm <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand rm 42
dayhand rm 4 5 6 --yes
```

### dayhand restore

Restore tasks from the trash (or the archive)

```
dayhand restore <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
dayhand restore 42
```

### dayhand trash

Tasks in the trash, newest first

```
dayhand trash
```

```sh
dayhand trash
dayhand trash --json
```

### dayhand log

The activity log: task changes after a cursor or a time, oldest first (who changed what)

Without --since: the newest changes. Keep nextCursor and pass it as --since next time to see only what changed meanwhile; hasMore says there are more already.

```
dayhand log [options]
```

| Option | Meaning |
|---|---|
| `--since <from>` | nextCursor of an earlier log (c…), a time ago (30m, 2h, 3d), a date phrase (yesterday, mon 09:00) or an ISO time |
| `--by <actor>` | Only changes by app, cli, agent (any agent) or "agent: <name>" |
| `--task <ref>` | Only changes of this task |
| `--limit <n>` | At most this many changes, 1 to 500 (default 100) |

```sh
dayhand log
dayhand log --since 2h --by cli
dayhand log --since c1793011200000123 --json
dayhand log --task 42 --by "agent: claude-code"
```

### dayhand claim

Claim a task for a while (default 120 minutes) so other agents leave it alone

While the claim lasts another agent's changes and claims of the task fail with conflict (exit 6). Claiming it again extends your claim.

```
dayhand claim <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--minutes <n>` | Length of the claim in minutes from now, 1 to 1440 (default 120) |

```sh
dayhand claim 42
dayhand claim 42 --minutes 30 --json
```

### dayhand renew

Extend your claim of a task by --minutes from now (default 120)

```
dayhand renew <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--minutes <n>` | Length of the claim in minutes from now, 1 to 1440 (default 120) |

```sh
dayhand renew 42
dayhand renew 42 --minutes 60
```

### dayhand release

End your claim of a task, optionally leaving a checkpoint as its resume note

```
dayhand release <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--note <text>` | Checkpoint: where you stopped and the next step (saved as the resume note) |

```sh
dayhand release 42
dayhand release 42 --note "tables migrated; indexes next"
```

### dayhand criteria

Print a task's acceptance criteria, or mark them met, unmet, remove and add them

Criteria are numbered from 1 as printed. Changes apply in this order: --met, --unmet, --rm, then --add. An agent can complete a task only when every criterion is met.

```
dayhand criteria <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--add <text>` | Add a criterion at the end (repeatable) |
| `--met <n>` | Mark criteria met: 2, 1,3 or all (repeatable) |
| `--unmet <n>` | Mark criteria not met (repeatable) |
| `--rm <n>` | Remove criteria (repeatable) |
| `--clear` | Remove all criteria |

```sh
dayhand criteria 42
dayhand criteria 42 --add "Tests pass" --add "Docs updated"
dayhand criteria 42 --met 1,2
```

### dayhand ask

Ask the owner to decide before you do something; they answer on the phone

Give 2 to 4 --option, each "label: consequence". Read the answer with dayhand approval <id> (--wait to wait for it). Dayhand records the decision; acting on it is up to you. Needs backend 0.11.0 or later (dayhand version).

```
dayhand ask <action...> [options]
```

- `action`: What you want to do, as one short sentence

| Option | Meaning |
|---|---|
| `--option <text>` | A choice, "label: what happens then" (repeatable, 2 to 4) |
| `--detail <text>` | Why, and what the owner needs to know |
| `--task <ref>` | The task it is about |
| `--reversible` | What you want to do can be undone (default: it cannot) |
| `--expires <span>` | How long the owner has: minutes, 30m, 2h, 1d (default 1d, at most 7d) |

```sh
dayhand ask Deploy 2.4 to production --option "Deploy now: live in 10 minutes" --option "Wait: nothing changes until Monday" --expires 2h
dayhand ask Delete old backups --task 42 --option Yes --option No --json
```

### dayhand approval

One approval request and, once decided, the owner's choice

--wait <seconds> checks every 5 s until the request is decided or expired, or the time is up. Needs backend 0.11.0 or later (dayhand version).

```
dayhand approval <id> [options]
```

- `id`: Id of the approval request

| Option | Meaning |
|---|---|
| `--wait <seconds>` | Wait up to this many seconds for a decision |

```sh
dayhand approval <id>
dayhand approval <id> --wait 600 --json
```

### dayhand approvals

Approval requests, newest first

Needs backend 0.11.0 or later (dayhand version).

```
dayhand approvals [options]
```

| Option | Meaning |
|---|---|
| `--status <status>` | Only pending, decided or expired requests (pending, decided, expired) |
| `--task <ref>` | Only requests about this task |
| `--limit <n>` | At most this many, 1 to 200 (default 50) |

```sh
dayhand approvals --status pending
dayhand approvals --task 42 --json
```

### dayhand approvals decide

Pick an option of a pending approval request

Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand approvals decide <id> <option> [options]
```

- `id`: Id of the approval request
- `option`: Id of the chosen option (o1, allow, …)

| Option | Meaning |
|---|---|
| `--note <text>` | A word for the agent with the decision |

```sh
dayhand approvals decide <id> o2 --note "after the weekend"
dayhand approvals decide <id> allow
```

### dayhand agents

Whether agents are paused, and the tool policies of agent keys

Needs backend 0.11.0 or later (dayhand version).

```
dayhand agents
```

```sh
dayhand agents
dayhand agents pause --reason holiday
dayhand agents resume
```

### dayhand agents pause

Pause every agent: they can read, their changes are refused until you resume them

Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand agents pause [options]
```

| Option | Meaning |
|---|---|
| `--reason <text>` | Why; agents see it in the error |

```sh
dayhand agents pause
dayhand agents pause --reason "going on holiday"
```

### dayhand agents resume

Let agents change the plan again

Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand agents resume
```

```sh
dayhand agents resume
```

### dayhand policy

Tool policies of agent keys: allow, ask (the owner approves each call) or deny

Needs backend 0.11.0 or later (dayhand version).

```
dayhand policy
```

```sh
dayhand policy
dayhand policy set <keyId> delete_task deny
dayhand policy set <keyId> "*" ask
```

### dayhand policy set

Set one agent key's rule for a tool that changes the plan, or "*" for every such tool

The key's id comes from dayhand key list. allow removes the rule (unless "*" says otherwise). Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand policy set <key> <tool> <rule>
```

- `key`: Id of an agent API key
- `tool`: A tool that changes the plan (dayhand tools), or "*"
- `rule`: allow, ask or deny

```sh
dayhand policy set <keyId> complete_task ask
```

### dayhand proposals

The proposal inbox: tasks agents and integrations proposed, waiting for you

Accept, merge or reject them with the subcommands; proposals stay out of Today, list and the board until accepted. Needs backend 0.11.0 or later (dayhand version).

```
dayhand proposals
```

```sh
dayhand proposals
dayhand proposals accept 42
dayhand proposals merge 43 --into 12
dayhand proposals reject 44 --reason "not now"
```

### dayhand proposals accept

Accept a proposal: it joins the plan as it is

Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand proposals accept <ref>
```

- `ref`: The proposal: #42 or 42

```sh
dayhand proposals accept 42
```

### dayhand proposals merge

Merge a proposal into a task already in the plan; the proposal goes to the trash

The task gets the proposal's note, links, labels, source and return webhooks. Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand proposals merge <ref> [options]
```

- `ref`: The proposal: #42 or 42

| Option | Meaning |
|---|---|
| `--into <ref>` | The task to merge it into (required) |

```sh
dayhand proposals merge 43 --into 12
```

### dayhand proposals reject

Reject a proposal: it goes to the trash (restorable for 30 days)

Only the owner can do this: a cli key (an agent key gets exit 7, forbidden).

```
dayhand proposals reject <ref> [options]
```

- `ref`: The proposal: #42 or 42

| Option | Meaning |
|---|---|
| `--reason <text>` | Why; the return webhook gets it |

```sh
dayhand proposals reject 44 --reason "not this quarter"
```

### dayhand health

What needs a look: overdue, blocked, stale claims, approvals, proposals, done without proof

Each section counts every task and lists the first 20. Needs backend 0.11.0 or later (dayhand version).

```
dayhand health
```

```sh
dayhand health
dayhand health --json
```

### dayhand settings

Show settings (time zone, morning summary time, default reminders)

```
dayhand settings
```

```sh
dayhand settings
dayhand settings --json
```

### dayhand settings get

Show settings

```
dayhand settings get
```

```sh
dayhand settings get --fields timezone
```

### dayhand settings set

Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders)

```
dayhand settings set <pairs...>
```

- `pairs`: key=value pairs

```sh
dayhand settings set timezone=Europe/London summary-time=05:00
dayhand settings set reminders=0,15
```

### dayhand export

Export the whole plan as Markdown, JSON (with history) or iCalendar (ics)

```
dayhand export [options]
```

| Option | Meaning |
|---|---|
| `--format <format>` | md, json or ics (default: md, or json with --json) (md, markdown, json, ics) |
| `-o, --output <file>` | Write to a file instead of stdout |

```sh
dayhand export > plan.md
dayhand export --format json -o dayhand.json
dayhand export --format ics -o dayhand.ics
dayhand export --json
```

### dayhand tools

MCP tools and their input schemas (introspection)

```
dayhand tools [name]
```

- `name`: One tool, to print its schema

```sh
dayhand tools
dayhand tools update_task --json
```

### dayhand call

Call an MCP tool with JSON arguments, exactly as an MCP client would

Prints the tool's structuredContent (or, for a Markdown export, its text). Errors and exit codes are the same as for the other commands.

```
dayhand call <tool> [json]
```

- `tool`: Tool name (see dayhand tools)
- `json`: Arguments as a JSON object, or - to read them from stdin (default {})

```sh
dayhand call get_task '{"taskId":"#42"}'
echo '{"format":"json"}' | dayhand call export_plan -
```

### dayhand version

CLI and server versions, and whether they are compatible

```
dayhand version
```

```sh
dayhand version --json
dayhand --version
```

### dayhand pair

One-time code (10 minutes) that signs the phone app in as you

```
dayhand pair [options]
```

| Option | Meaning |
|---|---|
| `--no-qr` | Do not draw the QR code |

```sh
dayhand pair
dayhand pair --json
```

### dayhand device

Paired phones (same as dayhand device list); revoke one with dayhand device revoke

```
dayhand device
```

```sh
dayhand device
dayhand device revoke <deviceId>
```

### dayhand device list

Paired phones Aliases: `ls`.

```
dayhand device list
```

```sh
dayhand device list
```

### dayhand device revoke

Sign a phone out: it gets no new app tokens

```
dayhand device revoke <deviceId>
```

- `deviceId`: Device id from dayhand device list

```sh
dayhand device revoke <deviceId>
```

### dayhand devices

Same as dayhand device list

```
dayhand devices
```

```sh
dayhand devices
```

### dayhand connection

Agent connections approved on the phone (OAuth, e.g. the Claude app); revoke one with dayhand connection revoke

An app such as Claude connects through OAuth: its sign-in page shows a code, and you approve it in the Dayhand app (Settings → Agent connections). API keys are not connections; see dayhand whoami. Needs backend 0.6.0 or later (dayhand version).

```
dayhand connection
```

```sh
dayhand connection
dayhand connection revoke <connectionId>
```

### dayhand connection list

Agent connections Aliases: `ls`.

```
dayhand connection list
```

```sh
dayhand connection list --json
```

### dayhand connection revoke

Disconnect an agent: its tokens stop working at once

```
dayhand connection revoke <connectionId>
```

- `connectionId`: Connection id from dayhand connection list

```sh
dayhand connection revoke <connectionId>
```

### dayhand connections

Same as dayhand connection list

```
dayhand connections
```

```sh
dayhand connections
```

### dayhand revoke

Same as dayhand device revoke

```
dayhand revoke <deviceId>
```

- `deviceId`: Device id from dayhand device list

```sh
dayhand revoke <deviceId>
```

### dayhand calendar

Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as dayhand calendar url)

Dated tasks become calendar events (with a time) or all-day events, repeating ones with their rule, reminders as alerts. The address works without a key, so treat it like a password. Needs backend 0.7.0 or later (dayhand version).

```
dayhand calendar
```

```sh
dayhand calendar
dayhand calendar on
dayhand calendar rotate --yes
dayhand calendar export -o dayhand.ics
```

### dayhand calendar url

Show the feed's addresses (null when it is off)

```
dayhand calendar url
```

```sh
dayhand calendar url --json
```

### dayhand calendar on

Turn the feed on (keeps an existing address) and show it

```
dayhand calendar on
```

```sh
dayhand calendar on
```

### dayhand calendar rotate

A new secret address; the old one stops working at once

```
dayhand calendar rotate
```

```sh
dayhand calendar rotate --yes
```

### dayhand calendar off

Turn the feed off; its address stops working

```
dayhand calendar off
```

```sh
dayhand calendar off --yes
```

### dayhand calendar export

The plan as a one-time .ics file to import (does not need the feed)

```
dayhand calendar export [options]
```

| Option | Meaning |
|---|---|
| `-o, --output <file>` | Write to a file instead of stdout (e.g. dayhand.ics) |

```sh
dayhand calendar export -o dayhand.ics
dayhand calendar export > dayhand.ics
```

### dayhand key

API keys for integrations: list, create with a scope and an expiry, revoke (same as dayhand key list)

A key made here reads (scope read) or also changes tasks and settings (scope write), never more; it expires no later than the key that makes it and stops working when that key is revoked. Needs backend 0.8.0 or later and a key with scope full (dayhand version, dayhand key list).

```
dayhand key
```

```sh
dayhand key list
dayhand key create n8n --scope read --expires 90d
dayhand key revoke <keyId> --yes
```

### dayhand key list

Every API key with its kind, scope and expiry (never the key itself)

```
dayhand key list
```

```sh
dayhand key list --json
```

### dayhand key create

Create a key (printed once) that reads or writes, for an integration

```
dayhand key create <name> [options]
```

- `name`: What the key is for, shown in history (e.g. n8n)

| Option | Meaning |
|---|---|
| `--scope <scope>` | read (default) or write (read, write) |
| `--kind <kind>` | agent (default) or cli: the actor of its changes (agent, cli) |
| `--expires <when>` | 90d (default), 12w, 1y, a date YYYY-MM-DD or never |

```sh
dayhand key create n8n
dayhand key create shortcuts --scope write --expires 1y
dayhand key create backup --expires never --json
```

### dayhand key revoke

Revoke a key; the keys it created stop working too

```
dayhand key revoke <keyId>
```

- `keyId`: Key id from dayhand key list

```sh
dayhand key revoke <keyId> --yes
```

### dayhand webhook

Webhooks: HTTPS addresses that get a signed message for every task change (same as dayhand webhook list)

Messages follow Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature); see docs/webhooks.md. Needs backend 0.8.0 or later and a key with scope full (dayhand version, dayhand key list).

```
dayhand webhook
```

```sh
dayhand webhook list
dayhand webhook add https://n8n.example.com/webhook/dayhand --event task.completed
dayhand webhook deliveries <webhookId>
```

### dayhand webhook list

Every webhook, whether it is on, and why it was turned off

```
dayhand webhook list
```

```sh
dayhand webhook list --json
```

### dayhand webhook add

Add a webhook; prints its signing secret once

```
dayhand webhook add <url> [options]
```

- `url`: HTTPS address on a public host

| Option | Meaning |
|---|---|
| `-e, --event <type>` | Event to send (repeatable; default all): task.created, task.updated, task.completed, task.deleted, task.restored, now.changed (task.created, task.updated, task.completed, task.deleted, task.restored, now.changed) |
| `-d, --description <text>` | What it is for |

```sh
dayhand webhook add https://hooks.example.com/dayhand
dayhand webhook add https://n8n.example.com/webhook/x -e task.completed -e task.created -d n8n
```

### dayhand webhook rm

Remove a webhook and its delivery log

```
dayhand webhook rm <webhookId>
```

- `webhookId`: Webhook id from dayhand webhook list

```sh
dayhand webhook rm <webhookId> --yes
```

### dayhand webhook test

Send a webhook.test message now (also to a webhook that is off)

```
dayhand webhook test <webhookId>
```

- `webhookId`: Webhook id from dayhand webhook list

```sh
dayhand webhook test <webhookId>
dayhand webhook deliveries <webhookId>
```

### dayhand webhook enable

Turn a webhook back on after it was turned off for failing

```
dayhand webhook enable <webhookId>
```

- `webhookId`: Webhook id from dayhand webhook list

```sh
dayhand webhook enable <webhookId>
```

### dayhand webhook deliveries

The delivery log: newest first, each attempt's HTTP status or error

```
dayhand webhook deliveries <webhookId> [options]
```

- `webhookId`: Webhook id from dayhand webhook list

| Option | Meaning |
|---|---|
| `-n, --limit <n>` | How many (1 to 200, default 50) |

```sh
dayhand webhook deliveries <webhookId>
dayhand webhook deliveries <webhookId> -n 5 --json
```

### dayhand import

Import tasks from Dayhand's JSON export, an iCalendar file or a Todoist CSV export

Each task is checked like dayhand add; one that fails is listed and the rest are imported. Importing the same file again imports nothing twice. --dry-run asks the server what would happen without storing anything. Needs backend 0.8.0 or later and a key with scope full (dayhand version, dayhand key list).

```
dayhand import <file> [options]
```

- `file`: The file, or - for stdin

| Option | Meaning |
|---|---|
| `--format <format>` | auto (default), dayhand-json, ics or todoist-csv (auto, dayhand-json, helm-json, ics, todoist-csv) |

```sh
dayhand export --format json -o dayhand.json && dayhand import dayhand.json --dry-run
dayhand import todoist.csv
dayhand import calendar.ics --format ics --json
```

### dayhand backlog import

Import a Backlog.md folder: each task file becomes a task; files imported before are skipped

Reads the Markdown files below <dir> (and the config.yml with the project's statuses) and sends one call; the backend creates prerequisites first. At most 200 files and 200 KiB of file JSON per invocation; a larger folder is refused before sending anything: import it by subdirectories. A selected directory with its own config is the root; otherwise root discovery walks up reserved folder names only, stopping at the first non-reserved directory and using only its config. Statuses map to the nearest of todo, doing and done; unrecognized embedded or negated status words stay todo with a warning. Drafts become proposals; docs, decisions and milestones are skipped. Each task's source is {kind: backlog-md, ref: <id>}, so importing the folder again brings only new files. Files without an id are skipped. Under an ask policy, one approval allows exactly this one call, as for other tools; repeat the unchanged folder with --approval after the owner allows it. --dry-run asks the server what would happen without storing anything. Needs backend 0.12.0 or later.

```
dayhand backlog import <dir>
```

- `dir`: The backlog folder (backlog/, or one of its folders such as backlog/tasks)

```sh
dayhand backlog import backlog --dry-run
dayhand backlog import backlog --json
dayhand backlog import backlog/completed
```

### dayhand backlog export

Write the plan as Backlog.md task files into a folder (without one, --json prints the files)

One file per task in tasks/ (proposals in drafts/; with --archived, archived tasks in archive/tasks/ and archived proposals in archive/drafts/), and a config.yml with the statuses To Do, In Progress and Done. Tasks imported from Backlog.md keep their ids; the others get <PREFIX>-<number>. The destination must be missing or empty unless --force explicitly confirms writing into an existing folder and replacing exported files, including config.yml. Symlink destinations, task directories and files are refused. Due dates, repeat rules and reminders have no place in the format and are left out (the notes say how many). Notes also identify tasks or config.yml whose exported text exceeds Dayhand import limits, including the 100,000-character file limit; text is not truncated. Needs backend 0.12.0 or later.

```
dayhand backlog export [dir] [options]
```

- `dir`: The folder to write into (made if missing), e.g. backlog

| Option | Meaning |
|---|---|
| `--prefix <prefix>` | ID prefix of tasks that did not come from Backlog.md (default task: TASK-12) |
| `--archived` | Also write archived tasks to archive/tasks/ and archived proposals to archive/drafts/ |
| `--force` | Confirm writing into a non-empty folder and replacing exported files, config.yml too |

```sh
dayhand backlog export backlog
dayhand backlog export backlog --prefix shop --archived
dayhand backlog export --json
```

### dayhand login

Store an API key for the deployment in the OS keychain (or a private file)

dayhand server deploy and dayhand server start sign in by themselves. For another computer, create a key with kind cli where dayhand is signed in (`dayhand key create laptop --kind cli --scope write`) or with `npx convex run apiKeys:create`. The key is checked against the server first; DAYHAND_API_KEY, when set, still wins over the stored key.

```
dayhand login [options]
```

| Option | Meaning |
|---|---|
| `--with-key` | Read the key from stdin instead of a hidden prompt |
| `--store <store>` | Where to keep the key (default: keychain, else file) (keychain, file) |

```sh
dayhand login --url https://<deployment>.convex.site
dayhand login --with-key < ~/dayhand-key.txt
dayhand --profile work login
```

### dayhand logout

Remove the stored API key for the deployment (keychain and file)

```
dayhand logout
```

```sh
dayhand logout
dayhand --profile work logout --json
```

### dayhand whoami

Which deployment, profile, key source and config file dayhand uses, checked against the server

```
dayhand whoami
```

```sh
dayhand whoami
dayhand whoami --json
```

### dayhand server deploy

Set up or update your server on your own Convex account, sign dayhand in and make a pairing code

Logs in to Convex in the browser, creates a project with a production deployment (or uses --deployment), sets the app-signing key and DAYHAND_* variables, deploys, checks /api/v1/openapi.json, /auth/token and /mcp, and makes a CLI key and a pairing code. Run it again to update: keys, the CLI key and the data are kept; a different signing key is replaced only after a question, the issuer never. --dry-run shows the steps without network.

```
dayhand server deploy [options]
```

| Option | Meaning |
|---|---|
| `--team <slug>` | Convex team (default: your only team; asked when you have several) |
| `--project <name>` | Name of the new Convex project (default: dayhand) |
| `--deployment <name>` | Use this existing production deployment instead of a new project |
| `--issuer <url>` | DAYHAND_JWT_ISSUER for a new server (default: the server's address) |
| `--backend <folder>` | The Dayhand repository's backend/ folder (default: the repository you run from, else the backend packaged with dayhand) |

```sh
dayhand server deploy
dayhand server deploy --team my-team --project dayhand
dayhand server deploy --dry-run
```

### dayhand server start

Run your server on this computer (Convex local backend, no account) until Ctrl+C, sign dayhand in

macOS and Linux. Data and keys stay in DAYHAND_SERVER_CONFIG_DIR/local, so the same command starts the server again. A phone with a release build needs HTTPS: put the ports behind tailscale serve and pass --public-url (docs/deploy.md). With --json the result is printed when the server is ready.

```
dayhand server start [options]
```

| Option | Meaning |
|---|---|
| `--port <n>` | Convex API port (default: 3210) |
| `--site-port <n>` | HTTP actions port (default: 3211) |
| `--public-url <url>` | The HTTPS address phones use, e.g. https://<machine>.<tailnet>.ts.net |
| `--public-api-url <url>` | The Convex API's HTTPS address (default: --public-url at port 8443) |
| `--backend <folder>` | The Dayhand repository's backend/ folder (default: the repository you run from, else the backend packaged with dayhand) |

```sh
dayhand server start
dayhand server start --public-url https://laptop.tail1234.ts.net
dayhand server start --json --yes
```

### dayhand prime

Context for an AI agent: Today, its claims, approvals, ready work, next steps and how to use dayhand (for a SessionStart hook)

Prints plain text without colors in every format except --json, which prints agent_brief: list_today's fields plus claims, approvals, ready tasks and nextSteps (a backend before 0.12.0 gives list_today alone). In a Claude Code hook: {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"dayhand prime"}]}]}}.

```
dayhand prime
```

```sh
dayhand prime
dayhand prime --json
```

### dayhand when

Show the day (and time) a date phrase means in your time zone, without changing anything

```
dayhand when <phrase...> [options]
```

- `phrase`: A date phrase, e.g. fri 14:00 (quotes optional)

| Option | Meaning |
|---|---|
| `--timezone <zone>` | IANA time zone to resolve in (default: yours from the server settings) |
| `--now <moment>` | Resolve as if it were this moment (ISO 8601) instead of now |

```sh
dayhand when "fri 14:00"
dayhand when next mon --json
dayhand when "in 2 hours" --timezone America/New_York
```

### dayhand completion

Print the shell completion script for bash, zsh, fish or powershell (dayhand help completion)

```
dayhand completion <shell>
```

- `shell`: bash, zsh, fish, powershell

```sh
source <(dayhand completion bash)
dayhand completion zsh > "${fpath[1]}/_dayhand"
dayhand completion powershell | Out-String | Invoke-Expression
```

### dayhand ui

Dayhand full screen in the terminal: Today, board, week and trash, with keys like vim and lazygit (dayhand help ui)

Needs a terminal. Refreshes every 12 s by default, within the key's limits of 120 reads and 60 changes a minute. q quits, ? lists the keys; dayhand help ui prints them. The screens speak the terminal's language (LC_ALL, LC_MESSAGES or LANG, overridden by DAYHAND_LANG or --lang) when it is one of en, pl, de, es, fr, pt-BR, ja, zh-Hans, else English; date phrases stay English.

```
dayhand ui [options]
```

| Option | Meaning |
|---|---|
| `--view <view>` | The view to open with (today, board, week, trash) |
| `--interval <seconds>` | Seconds between refreshes, 10 to 300 (default 12) |
| `--no-mouse` | Leave the mouse to the terminal (for selecting text) |
| `--lang <language>` | The screens' language: en, pl, de, es, fr, pt-BR, ja, zh-Hans (default: DAYHAND_LANG, then the locale) |

```sh
dayhand ui
dayhand ui --view week
dayhand ui --interval 30 --no-mouse
dayhand ui --lang pl
```
