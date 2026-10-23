---
name: hlm
description: Read and change the user's Helm task list with the hlm CLI (Today, add, find, reschedule, complete, resume notes). Use when the user mentions Helm, their tasks or plan for the day, or asks to track work as tasks.
---

<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->

# hlm

`hlm` is the command line client of Helm, the user's personal task manager. Each command is a
call of a Helm MCP tool, so the user sees your changes in the app at once, recorded as yours.

## Setup

- Check with `hlm whoami --json`. Exit 3 means no key: ask the user for one; never search for keys.
- Give each agent its own key of kind `agent` in `HLM_API_KEY` (and `HLM_URL`); history then names
  the agent. `hlm prime` prints Today and these rules for a session-start hook.

## Rules

- Pass --json and read stdout; on failure stdout is empty and stderr has one line {"error":{"code","message","exitCode","retryable","clientId"}}.
- Refer to tasks by number: #42 or 42 (stable, never reused), or now for the now task.
- Exit codes: 0 ok (also a no-op), 2 usage or bad date (fix the command), 3 key missing or revoked (ask the user), 4 not found, 5 server unavailable or rate_limited (too many calls: wait as the message says, then rerun).
- After exit 5 the change may have been applied: rerun the same command line with --client-id <the clientId from the error>; it is never applied twice.
- hlm never prompts without a terminal; changing 3 or more tasks at once needs --yes.
- Dates are English phrases in the user's time zone: today, tomorrow, fri 14:00, in 3 days, 2026-10-23. Check one with hlm when "<phrase>" or add --dry-run.
- Before stopping work on a task, record where you are: hlm now <ref> --note "<next step>".
- Anything the commands do not cover: hlm tools (schemas), then hlm call <tool> '<json>'.

## Common commands

| Command | What it does |
|---|---|
| `hlm today --json` | Today: now task with its resume note, overdue, today, done today |
| `hlm list --json --status todo,doing --search <text>` | Find tasks on the server (also --overdue, --due-before eow, -l <label>, --limit, --cursor) |
| `hlm show <ref> --json` | One task with its history |
| `hlm add "<title>" --due "fri 14:00" -l <label> --json` | Add a task (due today unless --due or --no-due) |
| `hlm now <ref> --note "<next step>" --json` | Make a task the now task and leave a resume note |
| `hlm note <ref> "<text>" --json` | Append to a task's note |
| `hlm move <ref> <when> --json` | Reschedule (none removes the date) |
| `hlm done <ref>... --json` | Complete; a repeating task returns its next occurrence |

## Patterns

```sh
# Find a task, then act on its number
ref=$(hlm list --json --search "accountant" --fields ref | jq -r '.result[0].ref')
hlm now "$ref" --note "waiting for the invoice" --json

# Check a date before using it, or preview the whole change
hlm when "next fri 9am" --json
hlm add "Send the report" --due "next fri 9am" --dry-run --json

# Retry after exit 5 without creating a duplicate
hlm add "Book the dentist" --client-id dentist-2026-10-22 --json

# Anything else the tools can do
hlm tools update_task --json
hlm call update_task '{"taskId":"#42","note":null}'
```

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

## JSON

`--json` prints the tool's `structuredContent`: a task object, `{"task","next"}` from `done`,
`{"result":[...]}` from list commands, `{"results":[...]}` when a command is given several tasks.
Dates are `YYYY-MM-DD` and `HH:MM` in the user's time zone, timestamps Unix milliseconds. Fields may
be added, never removed or retyped within a major version. `--fields ref,title,dueDate` narrows tasks.

## All commands

| Command | Summary |
|---|---|
| `hlm today` | The Today screen: now task, overdue, today and done today (also plain `hlm`) |
| `hlm add <title...>` | Add a task (due today unless --due or --no-due) |
| `hlm list` | Open tasks, oldest due first (with --done also done ones); filters narrow the list |
| `hlm board` | Kanban board: todo, doing and done columns |
| `hlm show <ref>` | One task with its change history (who changed what, when) |
| `hlm edit <ref>` | Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR |
| `hlm note <ref> [text...]` | Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it |
| `hlm move <ref> <date>` | Move a task to another day, optionally with a time (none removes the date) |
| `hlm done <refs...>` | Mark tasks done; a repeating task gets its next occurrence |
| `hlm start <refs...>` | Set tasks to doing |
| `hlm stop <refs...>` | Set tasks back to todo (from doing) |
| `hlm reopen <refs...>` | Set done tasks back to todo |
| `hlm now [ref]` | Show the now task, make a task the now task (--note: where you stopped), or --clear |
| `hlm archive <refs...>` | Archive tasks: off Today and the board, kept in exports |
| `hlm rm <refs...>` | Move tasks to the trash (purged after 30 days) |
| `hlm restore <refs...>` | Restore tasks from the trash (or the archive) |
| `hlm trash` | Tasks in the trash, newest first |
| `hlm settings` | Show settings (time zone, morning summary time, default reminders) |
| `hlm settings get` | Show settings |
| `hlm settings set <pairs...>` | Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders) |
| `hlm export` | Export the whole plan as Markdown or JSON (with history) |
| `hlm tools [name]` | MCP tools and their input schemas (introspection) |
| `hlm call <tool> [json]` | Call an MCP tool with JSON arguments, exactly as an MCP client would |
| `hlm version` | CLI and server versions, and whether they are compatible |
| `hlm device` | Paired phones (same as hlm device list); revoke one with hlm device revoke |
| `hlm device list` | Paired phones |
| `hlm devices` | Same as hlm device list |
| `hlm whoami` | Which deployment, profile, key source and config file hlm uses, checked against the server |
| `hlm prime` | Context for an AI agent: Today and how to use hlm (for a SessionStart hook) |
| `hlm when <phrase...>` | Show the day (and time) a date phrase means in your time zone, without changing anything |

Details: `hlm <command> --help`, `hlm help dates`, or docs/cli.md in the Helm repository.
