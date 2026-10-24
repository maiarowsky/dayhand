---
name: dayhand
description: Read and change the user's Dayhand task list with the dayhand CLI (Today, add, find, reschedule, complete, resume notes). Use when the user mentions Dayhand, their tasks or plan for the day, or asks to track work as tasks.
---

<!-- Generated from cli/src/registry by `npm run docs` in cli/. Do not edit by hand. -->

# dayhand

`dayhand` is the command line client of Dayhand, the user's personal task manager. Each command is a
call of a Dayhand MCP tool, so the user sees your changes in the app at once, recorded as yours.

## Setup

- Check with `dayhand whoami --json`. Exit 3 means no key: ask the user for one; never search for keys.
- Give each agent its own key of kind `agent` in `DAYHAND_API_KEY` (and `DAYHAND_URL`); history then names
  the agent. `dayhand prime` prints Today and these rules for a session-start hook.

## Rules

- Pass --json and read stdout; on failure stdout is empty and stderr has one line {"error":{"code","message","exitCode","retryable","clientId"}}.
- Refer to tasks by number: #42 or 42 (stable, never reused), or now for the now task.
- Exit codes: 0 ok (also a no-op), 2 usage or bad date (fix the command), 3 key missing or revoked (ask the user), 4 not found, 5 server unavailable or rate_limited (too many calls: wait as the message says, then rerun).
- After exit 5 the change may have been applied: rerun the same command line with --client-id <the clientId from the error>; it is never applied twice.
- dayhand never prompts without a terminal; changing 3 or more tasks at once needs --yes.
- Dates are English phrases in the user's time zone: today, tomorrow, fri 14:00, in 3 days, 2026-10-23. Check one with dayhand when "<phrase>" or add --dry-run.
- Before stopping work on a task, record where you are: dayhand now <ref> --note "<next step>".
- Anything the commands do not cover: dayhand tools (schemas), then dayhand call <tool> '<json>'.

## Common commands

| Command | What it does |
|---|---|
| `dayhand today --json` | Today: now task with its resume note, overdue, today, done today |
| `dayhand list --json --status todo,doing --search <text>` | Find tasks on the server (also --overdue, --due-before eow, -l <label>, --limit, --cursor) |
| `dayhand show <ref> --json` | One task with its history |
| `dayhand add "<title>" --due "fri 14:00" -l <label> --json` | Add a task (due today unless --due or --no-due) |
| `dayhand now <ref> --note "<next step>" --json` | Make a task the now task and leave a resume note |
| `dayhand note <ref> "<text>" --json` | Append to a task's note |
| `dayhand move <ref> <when> --json` | Reschedule (none removes the date) |
| `dayhand done <ref>... --json` | Complete; a repeating task returns its next occurrence |

## Patterns

```sh
# Find a task, then act on its number
ref=$(dayhand list --json --search "accountant" --fields ref | jq -r '.result[0].ref')
dayhand now "$ref" --note "waiting for the invoice" --json

# Check a date before using it, or preview the whole change
dayhand when "next fri 9am" --json
dayhand add "Send the report" --due "next fri 9am" --dry-run --json

# Retry after exit 5 without creating a duplicate
dayhand add "Book the dentist" --client-id dentist-2026-10-22 --json

# Anything else the tools can do
dayhand tools update_task --json
dayhand call update_task '{"taskId":"#42","note":null}'
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including a change that was already applied (no-op) |
| 1 | Other error (internal) |
| 2 | Usage: unknown command or flag, bad value or date, --yes missing, broken config.toml |
| 3 | Authentication: no key (dayhand login or DAYHAND_API_KEY), or a wrong or revoked one |
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
| `dayhand today` | The Today screen: now task, overdue, today and done today (also plain `dayhand`) |
| `dayhand add <title...>` | Add a task (due today unless --due or --no-due) |
| `dayhand list` | Open tasks, oldest due first (with --done also done ones); filters narrow the list |
| `dayhand board` | Kanban board: todo, doing and done columns |
| `dayhand show <ref>` | One task with its change history (who changed what, when) |
| `dayhand edit <ref>` | Change a task's fields; --clear-* removes one; on a terminal without options, edit title and note in $EDITOR |
| `dayhand note <ref> [text...]` | Print a task's note (on a terminal: edit it in $VISUAL/$EDITOR), or append text to it |
| `dayhand checklist <ref>` | Print a task's checklist, or tick, untick, move, remove and add items |
| `dayhand move <ref> <date>` | Move a task to another day, optionally with a time (none removes the date) |
| `dayhand done <refs...>` | Mark tasks done; a repeating task gets its next occurrence |
| `dayhand start <refs...>` | Set tasks to doing |
| `dayhand stop <refs...>` | Set tasks back to todo (from doing) |
| `dayhand reopen <refs...>` | Set done tasks back to todo |
| `dayhand now [ref]` | Show the now task, make a task the now task (--note: where you stopped), or --clear |
| `dayhand archive <refs...>` | Archive tasks: off Today and the board, kept in exports |
| `dayhand rm <refs...>` | Move tasks to the trash (purged after 30 days) |
| `dayhand restore <refs...>` | Restore tasks from the trash (or the archive) |
| `dayhand trash` | Tasks in the trash, newest first |
| `dayhand settings` | Show settings (time zone, morning summary time, default reminders) |
| `dayhand settings get` | Show settings |
| `dayhand settings set <pairs...>` | Change settings: timezone, summaryTime (summary-time), defaultReminderMinutes (reminders) |
| `dayhand export` | Export the whole plan as Markdown, JSON (with history) or iCalendar (ics) |
| `dayhand tools [name]` | MCP tools and their input schemas (introspection) |
| `dayhand call <tool> [json]` | Call an MCP tool with JSON arguments, exactly as an MCP client would |
| `dayhand version` | CLI and server versions, and whether they are compatible |
| `dayhand device` | Paired phones (same as dayhand device list); revoke one with dayhand device revoke |
| `dayhand device list` | Paired phones |
| `dayhand devices` | Same as dayhand device list |
| `dayhand connection` | Agent connections approved on the phone (OAuth, e.g. the Claude app); revoke one with dayhand connection revoke |
| `dayhand connection list` | Agent connections |
| `dayhand connection revoke <connectionId>` | Disconnect an agent: its tokens stop working at once |
| `dayhand connections` | Same as dayhand connection list |
| `dayhand calendar` | Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as dayhand calendar url) |
| `dayhand calendar url` | Show the feed's addresses (null when it is off) |
| `dayhand calendar on` | Turn the feed on (keeps an existing address) and show it |
| `dayhand calendar rotate` | A new secret address; the old one stops working at once |
| `dayhand calendar off` | Turn the feed off; its address stops working |
| `dayhand calendar export` | The plan as a one-time .ics file to import (does not need the feed) |
| `dayhand key` | API keys for integrations: list, create with a scope and an expiry, revoke (same as dayhand key list) |
| `dayhand key list` | Every API key with its kind, scope and expiry (never the key itself) |
| `dayhand key create <name>` | Create a key (printed once) that reads or writes, for an integration |
| `dayhand key revoke <keyId>` | Revoke a key; the keys it created stop working too |
| `dayhand webhook` | Webhooks: HTTPS addresses that get a signed message for every task change (same as dayhand webhook list) |
| `dayhand webhook list` | Every webhook, whether it is on, and why it was turned off |
| `dayhand webhook add <url>` | Add a webhook; prints its signing secret once |
| `dayhand webhook rm <webhookId>` | Remove a webhook and its delivery log |
| `dayhand webhook test <webhookId>` | Send a webhook.test message now (also to a webhook that is off) |
| `dayhand webhook enable <webhookId>` | Turn a webhook back on after it was turned off for failing |
| `dayhand webhook deliveries <webhookId>` | The delivery log: newest first, each attempt's HTTP status or error |
| `dayhand import <file>` | Import tasks from Dayhand's JSON export, an iCalendar file or a Todoist CSV export |
| `dayhand whoami` | Which deployment, profile, key source and config file dayhand uses, checked against the server |
| `dayhand server deploy` | Set up or update your server on your own Convex account, sign dayhand in and make a pairing code |
| `dayhand server start` | Run your server on this computer (Convex local backend, no account) until Ctrl+C, sign dayhand in |
| `dayhand prime` | Context for an AI agent: Today and how to use dayhand (for a SessionStart hook) |
| `dayhand when <phrase...>` | Show the day (and time) a date phrase means in your time zone, without changing anything |

Details: `dayhand <command> --help`, `dayhand help dates`, or docs/cli.md in the Dayhand repository.
