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
| `hlm list [options]` | `list_all` | [task-list](schemas/task-list.schema.json) | Open tasks, oldest due first (with --done also done ones) |
| `hlm board [options]` | `board` | [board](schemas/board.schema.json) | Kanban board: todo, doing and done columns |
| `hlm show <ref>` | `get_task` | [task-detail](schemas/task-detail.schema.json) | One task with its change history (who changed what, when) |
| `hlm edit <ref> [options]` | `update_task` | [task](schemas/task.schema.json) | Change a task's fields; --clear-* removes one |
| `hlm note <ref> [text...] [options]` | `get_task`, `update_task` | [task-detail](schemas/task-detail.schema.json), [task](schemas/task.schema.json) | Print a task's note, or append text to it |
| `hlm move <ref> <date> [options]` | `reschedule_task` | [task](schemas/task.schema.json) | Move a task to another day (none removes the date) |
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
| `hlm export [options]` | `export_plan` | [export](schemas/export.schema.json) | Export the whole plan as Markdown or JSON (with history) |
| `hlm tools [name]` | `tools/list` | [tools](schemas/tools.schema.json), [tool](schemas/tool.schema.json) | MCP tools and their input schemas (introspection) |
| `hlm call <tool> [json]` | `*` | the tool's | Call an MCP tool with JSON arguments, exactly as an MCP client would |
| `hlm version` | `initialize` | [version](schemas/version.schema.json) | CLI and server versions, and whether they are compatible |
| `hlm pair [options]` | `/devices/pairing-code` | [pairing](schemas/pairing.schema.json) | One-time code (10 minutes) that signs the phone app in as you |
| `hlm device` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones (same as hlm device list); revoke one with hlm device revoke |
| `hlm device list` | `/devices` | [devices](schemas/devices.schema.json) | Paired phones |
| `hlm device revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Sign a phone out: it gets no new app tokens |
| `hlm devices` | `/devices` | [devices](schemas/devices.schema.json) | Same as hlm device list |
| `hlm revoke <deviceId>` | `/devices/revoke` | [device-revoke](schemas/device-revoke.schema.json) | Same as hlm device revoke |

## Global options

| Option | Meaning |
|---|---|
| `--json` | Print the tool's structuredContent as JSON; errors as JSON on stderr |
| `--plain` | Tab-separated text without headers (for scripts) |
| `--fields <names>` | Comma-separated task (or settings) fields for JSON and columns |
| `--client-id <id>` | Operation id for safe retries (default: generated, shown on errors) |
| `-y, --yes` | Confirm changing many tasks at once |
| `--no-input` | Never prompt (also HLM_NO_INPUT=1); prompts need a terminal anyway |
| `--url <url>` | Deployment HTTP actions URL (default: HLM_URL) |

## JSON output

- `--json` (or `HLM_FORMAT=json`) prints the tool's `structuredContent` exactly as an MCP
  client receives it; schemas are in [schemas/](schemas/). Indented on a terminal, one line in a pipe.
- Fields may be added in a minor version; they are never removed or retyped within a major version.
- A list tool returns `{"result": [...]}`. A command given several tasks returns `{"results": [...]}`,
  one tool result per task. `--fields a,b` keeps only those fields of every task (or of the settings).
- `hlm now` without a task prints `list_today`; `hlm note <ref>` without text prints `get_task`.
- A Markdown export has no structured content; its JSON is `{"format":"markdown","content":"…"}`.
- Errors go to stderr as one line: `{"error":{"code","message","exitCode","retryable","clientId",…}}`
  ([schema](schemas/error.schema.json)); stdout stays empty. Warnings are `{"warning":{…}}` lines.
- `--plain` prints tab-separated rows without headers: `ref status dueDate dueTime title labels`
  (or the `--fields`); views with sections (Today, board) start each row with the section name.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including a change that was already applied (no-op) |
| 1 | Other error (internal) |
| 2 | Usage: unknown command or flag, bad value or date, --yes missing |
| 3 | Authentication: HLM_API_KEY missing, wrong or revoked |
| 4 | Not found: no such task (#n), device or now task |
| 5 | Server unavailable (network, timeout, HTTP 5xx or 429): the change may have been applied; retry with the same --client-id |
| 130 | Interrupted (Ctrl-C) |

Backend error codes map to exit codes: `invalid_argument` → 2, `unauthenticated` → 3,
`not_found` → 4, `internal` and unknown codes → 1.

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
| `HLM_URL` | Deployment HTTP actions URL, e.g. https://<deployment>.convex.site |
| `HLM_API_KEY` | Personal API key (create one with kind cli for yourself, agent for an agent) |
| `HLM_FORMAT` | json, plain or human: default output format (flags win) |
| `HLM_NO_INPUT` | 1 to never prompt |
| `HELM_URL, HELM_API_KEY` | Old names, still read when the HLM_* name is unset (deprecated, with a warning) |

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
| `--due <date>` | Due day: YYYY-MM-DD, today or tomorrow |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
| `--no-due` | No due day: the task shows only in list and board |
| `-l, --label <label>` | Label (repeatable) |
| `--note <text>` | Note |
| `--status <status>` | Initial status (todo, doing) |
| `--resume-note <text>` | Where you stopped / next step |
| `--link <url>` | Link, optionally followed by a title: "https://… Title" (repeatable) |

```sh
hlm add Call the accountant --due tomorrow --time 14:00 -l home
hlm add "Review the plan" --time 09:00 --every week --on mon,thu
hlm add Buy a present --no-due --json
```

### hlm list

Open tasks, oldest due first (with --done also done ones) Aliases: `ls`.

```
hlm list [options]
```

| Option | Meaning |
|---|---|
| `-l, --label <label>` | Only tasks with this label (repeatable: all must match) |
| `--done` | Include done tasks |
| `--archived` | Include archived tasks |

```sh
hlm list -l home
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

Change a task's fields; --clear-* removes one

```
hlm edit <ref> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id

| Option | Meaning |
|---|---|
| `--title <text>` | New title |
| `--note <text>` | Replace the note |
| `--clear-note` | Remove the note |
| `--due <date>` | Due day: YYYY-MM-DD, today or tomorrow |
| `--time <HH:MM>` | Due time, 24h, in your time zone |
| `--every <unit>` | Repeat every day, week, month or year (day, week, month, year) |
| `--interval <n>` | Repeat interval (2 = every other) |
| `--on <days>` | Weekly repeat days, e.g. mon,thu |
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

```sh
hlm edit 42 --title "Call the bank" --due tomorrow --time 10:00
hlm edit 42 --add-label work --rm-label home
hlm edit 42 --clear-repeat
```

### hlm note

Print a task's note, or append text to it

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

### hlm move

Move a task to another day (none removes the date)

```
hlm move <ref> <date> [options]
```

- `ref`: Task: #42 or 42 (its number), now, or its id
- `date`: YYYY-MM-DD, today, tomorrow or none

| Option | Meaning |
|---|---|
| `--time <HH:MM>` | New due time |
| `--clear-time` | Remove the due time |

```sh
hlm move 42 tomorrow --time 08:00
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

Export the whole plan as Markdown or JSON (with history)

```
hlm export [options]
```

| Option | Meaning |
|---|---|
| `--format <format>` | md or json (default: md, or json with --json) (md, markdown, json) |
| `-o, --output <file>` | Write to a file instead of stdout |

```sh
hlm export > plan.md
hlm export --format json -o helm.json
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

### hlm revoke

Same as hlm device revoke

```
hlm revoke <deviceId>
```

- `deviceId`: Device id from hlm device list

```sh
hlm revoke <deviceId>
```
