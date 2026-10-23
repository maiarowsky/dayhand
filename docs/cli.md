# hlm command reference

<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->

`hlm` is the Helm command line client. Every command is one or more MCP tool calls on the
same `/mcp` endpoint the agent uses (see [mcp.md](mcp.md)); `hlm call` reaches any tool directly.

Task references: `#42` or `42` (the task number), `now` (the now task) or the task id.
Without a command, `hlm` shows Today.

## Commands

| Command | Calls | `--json` schema | Summary |
|---|---|---|---|
| `hlm today` | `list_today` | [today](schemas/today.schema.json) | The Today screen: now task, overdue, today and done today (also plain `hlm`) |
| `hlm add <title...> [options]` | `add_task` | [task](schemas/task.schema.json) | Add a task (due today unless --due or --no-due) |
| `hlm list [options]` | `list_all` | [task-list](schemas/task-list.schema.json) | Open tasks, oldest due first (with --done also done ones); filters narrow the list |
| `hlm board [options]` | `board` | [board](schemas/board.schema.json) | Kanban board: todo, doing and done columns |
| `hlm show <ref>` | `get_task` | [task-detail](schemas/task-detail.schema.json) | One task with its change history (who changed what, when) |
| `hlm edit <ref> [options]` | `update_task` | [task](schemas/task.schema.json) | Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR |
| `hlm note <ref> [text...] [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it |
| `hlm checklist <ref> [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's checklist, or tick, untick, move, remove and add items |
| `hlm move <ref> <date> [options]` | `reschedule_task` | [task](schemas/task.schema.json) | Move a task to another day, optionally with a time (none removes the date) |
| `hlm done <refs...>` | `complete_task` | [complete](schemas/complete.schema.json) | Mark tasks done; a repeating task gets its next occurrence |
| `hlm start <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set tasks to doing |
| `hlm stop <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set tasks back to todo (from doing) |
| `hlm reopen <refs...>` | `set_status` | [task](schemas/task.schema.json) | Set done tasks back to todo |
| `hlm now [ref] [options]` | `set_now`, `list_today` | [set-now](schemas/set-now.schema.json), [today](schemas/today.schema.json) | Show the now task, make a task the now task (--note: where you stopped), or --clear |
| `hlm archive <refs...>` | `archive_task` | [task](schemas/task.schema.json) | Archive tasks: off Today and the board, kept in exports |
| `hlm rm <refs...>` | `delete_task` | [task](schemas/task.schema.json) | Move tasks to the trash (purged after 30 days) |
| `hlm restore <refs...>` | `restore_task` | [task](schemas/task.schema.json) | Restore tasks from the trash (or the archive) |
| `hlm trash` | `list_trash` | [task-list](schemas/task-list.schema.json) | Tasks in the trash, newest first |
| `hlm settings` | `get_settings` | [settings](schemas/settings.schema.json) | Show settings (time zone, morning summary time, default reminders) |
| `hlm settings get` | `get_settings` | [settings](schemas/settings.schema.json) | Show settings |
| `hlm settings set <pairs...>` | `update_settings` | [settings](schemas/settings.schema.json) | Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders) |
| `hlm export [options]` | `export_plan` | [export](schemas/export.schema.json) | Export the whole plan as Markdown, JSON (with history) or iCalendar (ics) |
| `hlm tools [name]` | `tools/list` | [tools](schemas/tools.schema.json), [tool](schemas/tool.schema.json) | MCP tools and their input schemas (introspection) |
| `hlm call <tool> [json]` | `*` | the tool's | Call an MCP tool with JSON arguments, exactly as an MCP client would |
| `hlm version` | `initialize` | [version](schemas/version.schema.json) | CLI and server versions, and whether they are compatible |
| `hlm pair [options]` | `/devices/pairing-code` | [pairing](schemas/pairing.schema.json) | One-time code (10 minutes) that signs the phone app in as you |
| `hlm device` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones (same as hlm device list); revoke one with hlm device revoke |
| `hlm device list` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones |
| `hlm device revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Sign a phone out: it gets no new app tokens |
| `hlm devices` | `/devices` | [devices](schemas/devices.schema.json) | Same as hlm device list |
| `hlm connection` | `/connections` | [connections](schemas/connections.schema.json) | Agent connections approved on the phone (OAuth, e.g. the Claude app); revoke one with hlm connection revoke |
| `hlm connection list` | `/connections` | [connections](schemas/connections.schema.json) | Agent connections |
| `hlm connection revoke <connectionId>` | `/connections/revoke` | [connection-revoke](schemas/connection-revoke.schema.json) | Disconnect an agent: its tokens stop working at once |
| `hlm connections` | `/connections` | [connections](schemas/connections.schema.json) | Same as hlm connection list |
| `hlm revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Same as hlm device revoke |
| `hlm calendar` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as hlm calendar url) |
| `hlm calendar url` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Show the feed's addresses (null when it is off) |
| `hlm calendar on` | `/calendar/feed` | [calendar-feed](schemas/calendar-feed.schema.json) | Turn the feed on (keeps an existing address) and show it |
| `hlm calendar rotate` | `/calendar/feed/rotate` | [calendar-feed](schemas/calendar-feed.schema.json) | A new secret address; the old one stops working at once |
| `hlm calendar off` | `/calendar/feed/revoke` | [calendar-revoke](schemas/calendar-revoke.schema.json) | Turn the feed off; its address stops working |
| `hlm calendar export [options]` | `export_plan` | [export](schemas/export.schema.json) | The plan as a one-time .ics file to import (does not need the feed) |
| `hlm key` | `/api/v1/keys` | [api-key-list](schemas/api-key-list.schema.json) | API keys for integrations: list, create with a scope and an expiry, revoke (same as hlm key list) |
| `hlm key list` | `/api/v1/keys` | [api-key-list](schemas/api-key-list.schema.json) | Every API key with its kind, scope and expiry (never the key itself) |
| `hlm key create <name> [options]` | `/api/v1/keys` | [api-key-created](schemas/api-key-created.schema.json) | Create a key (printed once) that reads or writes, for an integration |
| `hlm key revoke <keyId>` | `/api/v1/keys` | [api-key-revoke](schemas/api-key-revoke.schema.json) | Revoke a key; the keys it created stop working too |
| `hlm webhook` | `/api/v1/webhooks` | [webhook-list](schemas/webhook-list.schema.json) | Webhooks: HTTPS addresses that get a signed message for every task change (same as hlm webhook list) |
| `hlm webhook list` | `/api/v1/webhooks` | [webhook-list](schemas/webhook-list.schema.json) | Every webhook, whether it is on, and why it was turned off |
| `hlm webhook add <url> [options]` | `/api/v1/webhooks` | [webhook-created](schemas/webhook-created.schema.json) | Add a webhook; prints its signing secret once |
| `hlm webhook rm <webhookId>` | `/api/v1/webhooks` | [webhook-delete](schemas/webhook-delete.schema.json) | Remove a webhook and its delivery log |
| `hlm webhook test <webhookId>` | `/api/v1/webhooks` | [webhook-test](schemas/webhook-test.schema.json) | Send a webhook.test message now (also to a webhook that is off) |
| `hlm webhook enable <webhookId>` | `/api/v1/webhooks` | [webhook-one](schemas/webhook-one.schema.json) | Turn a webhook back on after it was turned off for failing |
| `hlm webhook deliveries <webhookId> [options]` | `/api/v1/webhooks` | [webhook-delivery-list](schemas/webhook-delivery-list.schema.json) | The delivery log: newest first, each attempt's HTTP status or error |
| `hlm import <file> [options]` | `/api/v1/import` | [import-result](schemas/import-result.schema.json) | Import tasks from Helm's JSON export, an iCalendar file or a Todoist CSV export |
| `hlm login [options]` | `get_settings` | [login](schemas/login.schema.json) | Store an API key for the deployment in the OS keychain (or a private file) |
| `hlm logout` | - | [logout](schemas/logout.schema.json) | Remove the stored API key for the deployment (keychain and file) |
| `hlm whoami` | `initialize`, `get_settings` | [whoami](schemas/whoami.schema.json) | Which deployment, profile, key source and config file hlm uses, checked against the server |
| `hlm prime` | `list_today` | [today](schemas/today.schema.json) | Context for an AI agent: Today and how to use hlm (for a SessionStart hook) |
| `hlm when <phrase...> [options]` | `get_settings` | [when](schemas/when.schema.json) | Show the day (and time) a date phrase means in your time zone, without changing anything |
| `hlm completion <shell>` | - | [completion](schemas/completion.schema.json) | Print the shell completion script for bash, zsh, fish or powershell (hlm help completion) |

## Global options

| Option | Meaning |
|---|---|
| `--json` | Print the tool's structuredContent as JSON; errors as JSON on stderr |
| `--plain` | Tab-separated text without headers (for scripts) |
| `--fields <names>` | Comma-separated task (or settings) fields for JSON and columns |
| `--client-id <id>` | Operation id for safe retries (default: generated, shown on errors) |
| `-y, --yes` | Confirm changing many tasks at once |
| `--no-input` | Never prompt (also HLM_NO_INPUT=1); prompts need a terminal anyway |
| `--dry-run` | Show the changes a command would make (dates resolved), checked by the backend, and save nothing |
| `--url <url>` | Deployment HTTP actions URL (default: HLM_URL, then config.toml) |
| `--profile <name>` | Profile from config.toml (default: HLM_PROFILE, then default_profile) |
| `--color <when>` | Colors in the human format (auto, always, never) |
| `--no-color` | Same as --color never (NO_COLOR=1 works too) |

## JSON output

- `--json` (or `HLM_FORMAT=json`) prints the tool's `structuredContent` exactly as an MCP
  client receives it; schemas are in [schemas/](schemas/). Indented on a terminal, one line in a pipe.
- Fields may be added in a minor version; they are never removed or retyped within a major version.
- A list tool returns `{"result": [...]}`. A command given several tasks returns `{"results": [...]}`,
  one tool result per task. `--fields a,b` keeps only those fields of every task (or of the settings).
- `hlm now` without a task prints `list_today`; `hlm note <ref>` without text prints `get_task`.
- A Markdown export's JSON is `{"format":"markdown","content":"…"}`.
- Errors go to stderr as one line: `{"error":{"code","message","exitCode","retryable","clientId",…}}`
  ([schema](schemas/error.schema.json)); stdout stays empty. Warnings are `{"warning":{…}}` lines.
- `--plain` prints tab-separated rows without headers: `ref status dueDate dueTime title labels`
  (or the `--fields`); views with sections (Today, board) start each row with the section name.
- `hlm list` filters (`--status`, `--overdue`, `--due-before`, `--due-after`, `--search`, `--limit`, `--cursor`)
  run on the backend and keep list_all's shape: `{"result": [...], "total", "nextCursor"}`. With `--limit`, pass
  `nextCursor` as `--cursor` for the next page. A backend older than 0.4.0 has no `total` and `nextCursor`;
  hlm then filters its full list itself.
- `--dry-run` on a command that changes something prints `{"dryRun":true,"calls":[{"tool","arguments","result"}]}`
  ([schema](schemas/dry-run.schema.json)) with dates resolved. The backend checks each change and returns
  what it would give (`result`) without saving anything; reads still happen. A backend older than 0.4.0
  and the device endpoints get nothing: their calls are only listed.

## Human output

Tables are aligned by display width; due days read as `today`, `tomorrow`, `yesterday` or
`Fri 23 Oct` in your time zone. A terminal gets colors (`--color auto|always|never`, `--no-color`,
`[ui] color`, `NO_COLOR`) and long titles cut to its width; a pipe gets the same text without
colors or cutting. `hlm board` shows its columns side by side on terminals 90 columns or wider.
On a terminal, `hlm note <ref>` and `hlm edit <ref>` without options open `$VISUAL`/`$EDITOR`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including a change that was already applied (no-op) |
| 1 | Other error (internal) |
| 2 | Usage: unknown command or flag, bad value or date, --yes missing, broken config.toml |
| 3 | Authentication: no key (hlm login or HLM_API_KEY), or a wrong or revoked one |
| 4 | Not found: no such task (#n), device or now task |
| 5 | Server unavailable (network, timeout, HTTP 5xx): the change may have been applied; retry with the same --client-id. Also too many calls with the key (rate_limited): nothing was applied; run it again after the wait the message names |
| 130 | Interrupted (Ctrl-C) |

Backend error codes map to exit codes: `invalid_argument` → 2, `unauthenticated` → 3,
`not_found` → 4, `rate_limited` → 5, `internal` and unknown codes → 1.

## Retries

Every change carries a `clientId`: `--client-id <id>`, or a generated one that is printed with
any error. After exit code 5, run the same command line with that `--client-id`: the backend does
not apply an operation twice. A command given several tasks uses `<id>:1`, `<id>:2`, … per task.

## Prompts

Changing 3 or more tasks at once needs `--yes`. On a terminal hlm asks instead; without a
terminal (or with `--no-input` / `HLM_NO_INPUT=1`) it never waits for input and exits with 2.

## Environment

| Variable | Meaning |
|---|---|
| `HLM_URL` | Deployment HTTP actions URL, e.g. https://<deployment>.convex.site (wins over config.toml) |
| `HLM_API_KEY` | API key; wins over the key stored by hlm login (give agents and CI their own, kind agent) |
| `HLM_PROFILE` | Profile from config.toml (--profile wins) |
| `HLM_FORMAT` | json, plain or human: default output format (flags win) |
| `HLM_NO_INPUT` | 1 to never prompt |
| `HLM_CONFIG_DIR` | Folder of config.toml and credentials.json (default: the system's config folder) |
| `HLM_CACHE_DIR` | Folder of the completion cache (default: the system's cache folder) |
| `HLM_CREDENTIAL_STORE` | keychain or file: where hlm login keeps keys (default: keychain, else file) |
| `NO_COLOR, FORCE_COLOR` | Turn colors off or on when neither --color nor config.toml decides |
| `VISUAL, EDITOR` | Editor for hlm note <ref> and hlm edit <ref> on a terminal (default: vi, notepad on Windows) |
| `HELM_URL, HELM_API_KEY` | Old names, still read when the HLM_* name is unset (deprecated, with a warning) |

## Topic: dates

`hlm help dates`

```text
Dates (--due, hlm move, hlm list --due-before/--due-after, hlm when)

Dates are English phrases resolved in your time zone from the server settings
(hlm settings), not the computer's. The same phrase at the same moment always
gives the same day. Try one with: hlm when "<phrase>", or add --dry-run to a command.

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

`hlm help config`

```text
Configuration (config.toml)

The file lives in:
  Linux     $XDG_CONFIG_HOME/hlm/config.toml (~/.config/hlm/config.toml)
  macOS     ~/Library/Application Support/hlm/config.toml
  Windows   %APPDATA%\hlm\config.toml
or in $HLM_CONFIG_DIR. hlm whoami prints the one in use. hlm login creates it.

  url = "https://<deployment>.convex.site"     # used when no profile is chosen
  default_profile = "personal"

  [profiles.personal]
  url = "https://<deployment>.convex.site"

  [profiles.work]
  url = "https://<other>.convex.site"

  [aliases]
  home = "list -l home --status todo,doing"    # hlm home --json
  week = "list --due-before eow"

  [ui]
  color = "auto"                               # auto, always or never

Precedence. URL: --url, the profile named by --profile, HLM_URL, the profile from
HLM_PROFILE or default_profile, then the top-level url. Key: HLM_API_KEY, then the
key hlm login stored for that URL. Colors: --color/--no-color, [ui] color,
NO_COLOR/FORCE_COLOR, then whether the output is a terminal.

The API key never goes into this file: hlm refuses keys named api_key, key,
token, secret or password. An unknown key or a wrong value is an error that names
the file and the key (exit 2). Aliases cannot hide a built-in command.
```

## Topic: login

`hlm help login`

```text
Signing in (hlm login, hlm logout, hlm whoami)

  hlm login --url https://<deployment>.convex.site   # paste the key at the hidden prompt
  hlm login --with-key < key.txt                     # or pipe it (scripts)
  hlm whoami                                         # URL, profile, where the key came from
  hlm logout

Create the key in the app (Settings → API keys, kind cli) or with
npx convex run apiKeys:create. hlm login checks it against the server, then stores
it for that URL in the OS keychain: macOS Keychain, Windows Credential Manager or
the Secret Service on Linux (GNOME Keyring, KWallet, KeePassXC). Without one (a
server, Omarchy without a keyring daemon) it says so and keeps the key in
credentials.json next to config.toml, readable only by you (mode 0600).
HLM_CREDENTIAL_STORE=file or --store file chooses the file on purpose.

HLM_API_KEY, when set, wins over the stored key: give agents and CI their own key
(kind agent) that way. The keychain keeps the key out of dotfiles, backups and shell
history; it does not hide it from programs running as you.
```

## Topic: completion

`hlm help completion`

```text
Shell completion (hlm completion <shell>)

  bash         echo 'source <(hlm completion bash)' >> ~/.bashrc
  zsh          hlm completion zsh > "${fpath[1]}/_hlm"     (or source <(hlm completion zsh) after compinit)
  fish         hlm completion fish > ~/.config/fish/completions/hlm.fish
  PowerShell   hlm completion powershell | Out-String | Invoke-Expression   (add it to $PROFILE)

Completes commands, aliases from config.toml, options and their values, task
numbers with their titles, labels, profiles and date words. Task numbers and
labels come from one list_all call, cached for 60 seconds in the cache folder
(~/.cache/hlm, ~/Library/Caches/hlm or %LOCALAPPDATA%\hlm\Cache). Completion
never prompts and prints nothing when it cannot reach the server.
```

## Command details

### hlm today

The Today screen: now task, overdue, today and done today (also plain `hlm`)

```
hlm today
```

```sh
hlm
hlm today --json
hlm today --plain --fields ref,title
```

### hlm add

Add a task (due today unless --due or --no-due)

```
hlm add <title...> [options]
```

- `title`: Task title

| Option | Meaning |
|---|---|
| `--due <when>` | Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (hlm help dates) |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
| `--month-day <day>` | Monthly repeat on day 1-31 (a shorter month: its last day) or last |
| `--month-weekday <day>` | Monthly repeat on a weekday: "2 tue", "last fri" |
| `--from-completion` | Count the next date from the day the task is done, not its due date |
| `--until <date>` | Last date the repeat may fall on (hlm help dates) |
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

```sh
hlm add Call the accountant --due "fri 2pm" -l home
hlm add Pay rent --due "1 nov" --dry-run
hlm add "Review the plan" --time 09:00 --every week --on mon,thu
hlm add Payroll --due 2026-10-30 --month-weekday "last fri" --remind "09:00 -1d"
hlm add Water plants --every day --interval 3 --from-completion
hlm add Pack --due fri --item passport --item charger
hlm add Buy a present --no-due --json
```

### hlm list

Open tasks, oldest due first (with --done also done ones); filters narrow the list Aliases: `ls`.

```
hlm list [options]
```

| Option | Meaning |
|---|---|
| `-l, --label <label>` | Only tasks with this label (repeatable: all must match) |
| `--done` | Include done tasks |
| `--archived` | Include archived tasks |
| `--status <statuses>` | Only these statuses, comma-separated: todo, doing, done (done implies --done) |
| `--overdue` | Only overdue tasks |
| `--due-before <when>` | Only tasks due before this day, e.g. eow, next mon, 2026-11-01 |
| `--due-after <when>` | Only tasks due after this day, e.g. today |
| `--search <text>` | Only tasks whose title, note, resume note or labels contain the text (any case) |
| `--limit <n>` | At most this many tasks; the JSON's nextCursor continues the list |
| `--cursor <cursor>` | Continue a list cut by --limit: the nextCursor of the previous page |

```sh
hlm list -l home --status todo,doing
hlm list --overdue
hlm list --due-before eow --search accountant --limit 20
hlm list --limit 50 --cursor <nextCursor> --json
hlm list --done --json --fields ref,title,status
```

### hlm board

Kanban board: todo, doing and done columns

```
hlm board [options]
```

| Option | Meaning |
|---|---|
| `--done-limit <n>` | Maximum tasks in the done column (default 50) |

```sh
hlm board
hlm board --done-limit 5 --json
```

### hlm show

One task with its change history (who changed what, when)

```
hlm show <ref>
```

- `ref`: Task: #42 or 42 (its number), now, or its id

```sh
hlm show 42
hlm show now --json
```

### hlm edit

Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR

```
hlm edit <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--title <text>` | New title |
| `--note <text>` | Replace the note |
| `--clear-note` | Remove the note |
| `--due <when>` | Due day, optionally with a time: tomorrow, fri 14:00, in 3 days, 2026-10-23 (hlm help dates) |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
| `--month-day <day>` | Monthly repeat on day 1-31 (a shorter month: its last day) or last |
| `--month-weekday <day>` | Monthly repeat on a weekday: "2 tue", "last fri" |
| `--from-completion` | Count the next date from the day the task is done, not its due date |
| `--until <date>` | Last date the repeat may fall on (hlm help dates) |
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
| `--item <text>` | Replace the checklist (repeatable; hlm checklist edits single items) |
| `--clear-checklist` | Remove the checklist |
| `--remind <when>` | This task's reminder instead of the defaults: 0, 15m, 2h, 1d (before the due time), 09:00 or "18:00 -1d" (repeatable) |
| `--no-reminders` | No reminders for this task |
| `--default-reminders` | Back to the default reminders from settings |

```sh
hlm edit 42 --title "Call the bank" --due "tomorrow 10:00"
hlm edit 42 --add-label work --rm-label home
hlm edit 42 --every month --month-day last --until 2027-06-30
hlm edit 42 --rrule "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
hlm edit 42 --remind 15m --remind 1d
hlm edit 42 --clear-repeat
hlm edit 42
```

### hlm note

Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it

```
hlm note <ref> [text...] [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id
- `text`: Text to append as a new line

| Option | Meaning |
|---|---|
| `--clear` | Remove the note |

```sh
hlm note 42
hlm note 42 "Account number is in the email"
hlm note 42 --clear
```

### hlm checklist

Print a task's checklist, or tick, untick, move, remove and add items

Items are numbered from 1 as printed. Changes apply in this order: --check, --uncheck, --move, --rm, then --add.

```
hlm checklist <ref> [options]
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
hlm checklist 42
hlm checklist 42 --add "Book the hotel" --add "Pack"
hlm checklist 42 --check 1,2
hlm checklist 42 --move 3:1 --rm 4
```

### hlm move

Move a task to another day, optionally with a time (none removes the date)

```
hlm move <ref> <date> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id
- `date`: When: tomorrow, fri 14:00, next mon, 2026-10-23 … or none (hlm help dates)

| Option | Meaning |
|---|---|
| `--time <HH:MM>` | New due time |
| `--clear-time` | Remove the due time |

```sh
hlm move 42 tomorrow --time 08:00
hlm move 42 "next mon 9am"
hlm move 42 none
```

### hlm done

Mark tasks done; a repeating task gets its next occurrence

```
hlm done <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm done 42
hlm done 42 43 now
hlm done 1 2 3 --yes --client-id 7f3c
```

### hlm start

Set tasks to doing

```
hlm start <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm start 42
```

### hlm stop

Set tasks back to todo (from doing)

```
hlm stop <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm stop 42
```

### hlm reopen

Set done tasks back to todo

```
hlm reopen <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm reopen 42
```

### hlm now

Show the now task, make a task the now task (--note: where you stopped), or --clear

```
hlm now [ref] [options]
```

- `ref`: Task to make the now task

| Option | Meaning |
|---|---|
| `--note <text>` | Resume note shown on Today |
| `--clear` | Clear the now task |

```sh
hlm now
hlm now 42 --note "have the account number"
hlm now --clear
```

### hlm archive

Archive tasks: off Today and the board, kept in exports

```
hlm archive <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm archive 42
```

### hlm rm

Move tasks to the trash (purged after 30 days) Aliases: `delete`.

```
hlm rm <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm rm 42
hlm rm 4 5 6 --yes
```

### hlm restore

Restore tasks from the trash (or the archive)

```
hlm restore <refs...>
```

- `refs`: Tasks: #42 or 42, now, or ids

```sh
hlm restore 42
```

### hlm trash

Tasks in the trash, newest first

```
hlm trash
```

```sh
hlm trash
hlm trash --json
```

### hlm settings

Show settings (time zone, morning summary time, default reminders)

```
hlm settings
```

```sh
hlm settings
hlm settings --json
```

### hlm settings get

Show settings

```
hlm settings get
```

```sh
hlm settings get --fields timezone
```

### hlm settings set

Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders)

```
hlm settings set <pairs...>
```

- `pairs`: key=value pairs

```sh
hlm settings set timezone=Europe/London summary-time=05:00
hlm settings set reminders=0,15
```

### hlm export

Export the whole plan as Markdown, JSON (with history) or iCalendar (ics)

```
hlm export [options]
```

| Option | Meaning |
|---|---|
| `--format <format>` | md, json or ics (default: md, or json with --json) (md, markdown, json, ics) |
| `-o, --output <file>` | Write to a file instead of stdout |

```sh
hlm export > plan.md
hlm export --format json -o helm.json
hlm export --format ics -o helm.ics
hlm export --json
```

### hlm tools

MCP tools and their input schemas (introspection)

```
hlm tools [name]
```

- `name`: One tool, to print its schema

```sh
hlm tools
hlm tools update_task --json
```

### hlm call

Call an MCP tool with JSON arguments, exactly as an MCP client would

Prints the tool's structuredContent (or, for a Markdown export, its text). Errors and exit codes are the same as for the other commands.

```
hlm call <tool> [json]
```

- `tool`: Tool name (see hlm tools)
- `json`: Arguments as a JSON object, or - to read them from stdin (default {})

```sh
hlm call get_task '{"taskId":"#42"}'
echo '{"format":"json"}' | hlm call export_plan -
```

### hlm version

CLI and server versions, and whether they are compatible

```
hlm version
```

```sh
hlm version --json
hlm --version
```

### hlm pair

One-time code (10 minutes) that signs the phone app in as you

```
hlm pair [options]
```

| Option | Meaning |
|---|---|
| `--no-qr` | Do not draw the QR code |

```sh
hlm pair
hlm pair --json
```

### hlm device

Paired phones (same as hlm device list); revoke one with hlm device revoke

```
hlm device
```

```sh
hlm device
hlm device revoke <deviceId>
```

### hlm device list

Paired phones Aliases: `ls`.

```
hlm device list
```

```sh
hlm device list
```

### hlm device revoke

Sign a phone out: it gets no new app tokens

```
hlm device revoke <deviceId>
```

- `deviceId`: Device id from hlm device list

```sh
hlm device revoke <deviceId>
```

### hlm devices

Same as hlm device list

```
hlm devices
```

```sh
hlm devices
```

### hlm connection

Agent connections approved on the phone (OAuth, e.g. the Claude app); revoke one with hlm connection revoke

An app such as Claude connects through OAuth: its sign-in page shows a code, and you approve it in the Helm app (Settings → Agent connections). API keys are not connections; see hlm whoami. Needs backend 0.6.0 or later (hlm version).

```
hlm connection
```

```sh
hlm connection
hlm connection revoke <connectionId>
```

### hlm connection list

Agent connections Aliases: `ls`.

```
hlm connection list
```

```sh
hlm connection list --json
```

### hlm connection revoke

Disconnect an agent: its tokens stop working at once

```
hlm connection revoke <connectionId>
```

- `connectionId`: Connection id from hlm connection list

```sh
hlm connection revoke <connectionId>
```

### hlm connections

Same as hlm connection list

```
hlm connections
```

```sh
hlm connections
```

### hlm revoke

Same as hlm device revoke

```
hlm revoke <deviceId>
```

- `deviceId`: Device id from hlm device list

```sh
hlm revoke <deviceId>
```

### hlm calendar

Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as hlm calendar url)

Dated tasks become calendar events (with a time) or all-day events, repeating ones with their rule, reminders as alerts. The address works without a key, so treat it like a password. Needs backend 0.7.0 or later (hlm version).

```
hlm calendar
```

```sh
hlm calendar
hlm calendar on
hlm calendar rotate --yes
hlm calendar export -o helm.ics
```

### hlm calendar url

Show the feed's addresses (null when it is off)

```
hlm calendar url
```

```sh
hlm calendar url --json
```

### hlm calendar on

Turn the feed on (keeps an existing address) and show it

```
hlm calendar on
```

```sh
hlm calendar on
```

### hlm calendar rotate

A new secret address; the old one stops working at once

```
hlm calendar rotate
```

```sh
hlm calendar rotate --yes
```

### hlm calendar off

Turn the feed off; its address stops working

```
hlm calendar off
```

```sh
hlm calendar off --yes
```

### hlm calendar export

The plan as a one-time .ics file to import (does not need the feed)

```
hlm calendar export [options]
```

| Option | Meaning |
|---|---|
| `-o, --output <file>` | Write to a file instead of stdout (e.g. helm.ics) |

```sh
hlm calendar export -o helm.ics
hlm calendar export > helm.ics
```

### hlm key

API keys for integrations: list, create with a scope and an expiry, revoke (same as hlm key list)

A key made here reads (scope read) or also changes tasks and settings (scope write), never more; it expires no later than the key that makes it and stops working when that key is revoked. Needs backend 0.8.0 or later and a key with scope full (hlm version, hlm key list).

```
hlm key
```

```sh
hlm key list
hlm key create n8n --scope read --expires 90d
hlm key revoke <keyId> --yes
```

### hlm key list

Every API key with its kind, scope and expiry (never the key itself)

```
hlm key list
```

```sh
hlm key list --json
```

### hlm key create

Create a key (printed once) that reads or writes, for an integration

```
hlm key create <name> [options]
```

- `name`: What the key is for, shown in history (e.g. n8n)

| Option | Meaning |
|---|---|
| `--scope <scope>` | read (default) or write (read, write) |
| `--kind <kind>` | agent (default) or cli: the actor of its changes (agent, cli) |
| `--expires <when>` | 90d (default), 12w, 1y, a date YYYY-MM-DD or never |

```sh
hlm key create n8n
hlm key create shortcuts --scope write --expires 1y
hlm key create backup --expires never --json
```

### hlm key revoke

Revoke a key; the keys it created stop working too

```
hlm key revoke <keyId>
```

- `keyId`: Key id from hlm key list

```sh
hlm key revoke <keyId> --yes
```

### hlm webhook

Webhooks: HTTPS addresses that get a signed message for every task change (same as hlm webhook list)

Messages follow Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature); see docs/webhooks.md. Needs backend 0.8.0 or later and a key with scope full (hlm version, hlm key list).

```
hlm webhook
```

```sh
hlm webhook list
hlm webhook add https://n8n.example.com/webhook/helm --event task.completed
hlm webhook deliveries <webhookId>
```

### hlm webhook list

Every webhook, whether it is on, and why it was turned off

```
hlm webhook list
```

```sh
hlm webhook list --json
```

### hlm webhook add

Add a webhook; prints its signing secret once

```
hlm webhook add <url> [options]
```

- `url`: HTTPS address on a public host

| Option | Meaning |
|---|---|
| `-e, --event <type>` | Event to send (repeatable; default all): task.created, task.updated, task.completed, task.deleted, task.restored, now.changed (task.created, task.updated, task.completed, task.deleted, task.restored, now.changed) |
| `-d, --description <text>` | What it is for |

```sh
hlm webhook add https://hooks.example.com/helm
hlm webhook add https://n8n.example.com/webhook/x -e task.completed -e task.created -d n8n
```

### hlm webhook rm

Remove a webhook and its delivery log

```
hlm webhook rm <webhookId>
```

- `webhookId`: Webhook id from hlm webhook list

```sh
hlm webhook rm <webhookId> --yes
```

### hlm webhook test

Send a webhook.test message now (also to a webhook that is off)

```
hlm webhook test <webhookId>
```

- `webhookId`: Webhook id from hlm webhook list

```sh
hlm webhook test <webhookId>
hlm webhook deliveries <webhookId>
```

### hlm webhook enable

Turn a webhook back on after it was turned off for failing

```
hlm webhook enable <webhookId>
```

- `webhookId`: Webhook id from hlm webhook list

```sh
hlm webhook enable <webhookId>
```

### hlm webhook deliveries

The delivery log: newest first, each attempt's HTTP status or error

```
hlm webhook deliveries <webhookId> [options]
```

- `webhookId`: Webhook id from hlm webhook list

| Option | Meaning |
|---|---|
| `-n, --limit <n>` | How many (1 to 200, default 50) |

```sh
hlm webhook deliveries <webhookId>
hlm webhook deliveries <webhookId> -n 5 --json
```

### hlm import

Import tasks from Helm's JSON export, an iCalendar file or a Todoist CSV export

Each task is checked like hlm add; one that fails is listed and the rest are imported. Importing the same file again imports nothing twice. --dry-run asks the server what would happen without storing anything. Needs backend 0.8.0 or later and a key with scope full (hlm version, hlm key list).

```
hlm import <file> [options]
```

- `file`: The file, or - for stdin

| Option | Meaning |
|---|---|
| `--format <format>` | auto (default), helm-json, ics or todoist-csv (auto, helm-json, ics, todoist-csv) |

```sh
hlm export --format json -o helm.json && hlm import helm.json --dry-run
hlm import todoist.csv
hlm import calendar.ics --format ics --json
```

### hlm login

Store an API key for the deployment in the OS keychain (or a private file)

Create a key with kind cli in the app (Settings → API keys) or with `npx convex run apiKeys:create`. The key is checked against the server first; HLM_API_KEY, when set, still wins over the stored key.

```
hlm login [options]
```

| Option | Meaning |
|---|---|
| `--with-key` | Read the key from stdin instead of a hidden prompt |
| `--store <store>` | Where to keep the key (default: keychain, else file) (keychain, file) |

```sh
hlm login --url https://<deployment>.convex.site
hlm login --with-key < ~/helm-key.txt
hlm --profile work login
```

### hlm logout

Remove the stored API key for the deployment (keychain and file)

```
hlm logout
```

```sh
hlm logout
hlm --profile work logout --json
```

### hlm whoami

Which deployment, profile, key source and config file hlm uses, checked against the server

```
hlm whoami
```

```sh
hlm whoami
hlm whoami --json
```

### hlm prime

Context for an AI agent: Today and how to use hlm (for a SessionStart hook)

Prints plain text without colors in every format except --json, which prints list_today like hlm today --json. In a Claude Code hook: {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"hlm prime"}]}]}}.

```
hlm prime
```

```sh
hlm prime
hlm prime --json
```

### hlm when

Show the day (and time) a date phrase means in your time zone, without changing anything

```
hlm when <phrase...> [options]
```

- `phrase`: A date phrase, e.g. fri 14:00 (quotes optional)

| Option | Meaning |
|---|---|
| `--timezone <zone>` | IANA time zone to resolve in (default: yours from the server settings) |
| `--now <moment>` | Resolve as if it were this moment (ISO 8601) instead of now |

```sh
hlm when "fri 14:00"
hlm when next mon --json
hlm when "in 2 hours" --timezone America/New_York
```

### hlm completion

Print the shell completion script for bash, zsh, fish or powershell (hlm help completion)

```
hlm completion <shell>
```

- `shell`: bash, zsh, fish, powershell

```sh
source <(hlm completion bash)
hlm completion zsh > "${fpath[1]}/_hlm"
hlm completion powershell | Out-String | Invoke-Expression
```
