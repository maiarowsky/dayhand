# FAQ and troubleshooting

## Questions

### Is there a hosted Dayhand, or an account to create?

No. You run the server yourself, on your computer or on your own Convex account, or use the apps with
no server at all. Dayhand is a personal open source project with no hosted service.

### What does it cost?

Nothing: Dayhand is free and open source under the Apache License 2.0. A server on your computer costs nothing, and so does Convex's Free plan,
whose limits are far above one person's plan ([what it costs](deploy.md#what-it-costs)).

### Can several people share one plan?

Not as separate people. A Dayhand server has one owner, and the phone, the computers and every agent
work on that owner's plan. Agents and integrations get keys of their own, so their changes are told
apart. Another person runs a server of their own.

### Which agents can use it?

Any MCP client that can send an `Authorization` header (Claude Code is one command), the Claude apps as a
custom connector with OAuth, and any agent that runs shell commands through `dayhand`. See
[Agents and you](agents.md).

### Can an agent do something I did not allow?

Inside Dayhand, no: a policy per agent key allows, asks for or denies each tool, risky steps wait for
your answer when the agent asks, and one switch pauses every agent. Dayhand cannot stop what an agent does
outside Dayhand, such as running commands on your computer.

### Does it work offline?

Yes. The Android, macOS and Linux apps keep the plan on the device, and reminders are worked out there.
Changes wait in an outbox and go to the server in order when it can be reached. `dayhand` and `dayhand ui`
need the server.

### Can I see my tasks in Google Calendar or Apple Calendar?

Yes, through a read-only feed that calendar apps subscribe to by address: Settings → Data → Calendar on
the phone, or `dayhand calendar on` ([calendar feed](calendar.md)). Changes are made in Dayhand.

### Can I bring my tasks from another app, and take them out again?

`dayhand import` reads Dayhand's own JSON export, iCalendar files (tasks and events) and Todoist's CSV
export ([import](api.md#import)). `dayhand export` writes the whole plan as Markdown, JSON (with the
history) or iCalendar, and the phone saves a backup file. Backlog.md import and export are planned.

### Is there an app for iPhone or Windows?

Not yet. The iPhone and iPad app is in development, with nothing to install yet. On Windows, `dayhand` works with a server on your own Convex
account (`dayhand server deploy`); there is no desktop app.

### Which languages does Dayhand speak?

The Android, macOS and Linux apps and `dayhand ui` speak English, Polish, German, Spanish, French,
Brazilian Portuguese, Japanese and Simplified Chinese. Date phrases (`fri 2pm`) are English everywhere,
and so are the other `dayhand` commands, `--json` and the MCP tools.

### Why do some names still say helm?

Dayhand was called Helm until backend 0.9.0 and CLI 0.10.0. The old `hlm` command and `HELM_*` names
still work with a warning, and a few stored names stay as they were ([renamed from Helm](rename.md)).
The repository moved to `maiarowsky/dayhand`; links to `maiarowsky/helm` redirect.

## Troubleshooting

### `dayhand: command not found`

`npm link` puts the command in npm's global folder. Check that `npm prefix -g` followed by `/bin` is on
your PATH, or run `node cli/dist/bin/dayhand.js` from the checkout. Where `npm link` needs administrator
rights, use that path instead of `sudo`.

### `dayhand` says there is no key (exit 3)

`dayhand whoami` shows which server, profile and key source it uses. `dayhand server start` and
`dayhand server deploy` sign in by themselves; for a server that already runs, run
`dayhand login --url <the server's address>` with a key of kind `cli`. A key in `DAYHAND_API_KEY` wins over
the stored one, so an old value there can hide a good login. On Linux without a keyring (a server, a
minimal desktop), `dayhand login --store file` keeps the key in a file only you can read
([login](cli.md#topic-login)).

### `dayhand version` says the server is not compatible

The CLI needs a server with the same major version that is not older than the one it was built for. Update
the server: `git pull`, then `dayhand server deploy` or `dayhand server start` again ([updating](deploy.md#updating)).

### `dayhand server start` does not start

- It runs on macOS and Linux (x64 or arm64), not on Windows: use `dayhand server deploy` there.
- When ports 3210 or 3211 are taken, choose others with `--port` and `--site-port`.
- `dayhand server start --dry-run` lists every step without changing anything. Run it from inside the
  checkout, or pass `--backend <path to backend/>`.

### The phone cannot connect

- **The server is on your computer.** It listens on `127.0.0.1`, which the phone cannot reach, and release
  builds of the app need HTTPS. Use `tailscale serve` and `dayhand server start --public-url …`
  ([Phone and computer](deploy.md#phone-and-computer-tailscale)), or a server on your Convex account. To
  check the address from the phone, open `https://<machine>.<tailnet>.ts.net/api/v1/openapi.json` in its
  browser: it should show a JSON document.
- **The code is refused.** A code works once, for 10 minutes; make a new one with `dayhand pair`. After 10
  wrong codes in 10 minutes the server stops checking codes for the rest of that window; wait, or clear it
  from `backend/` with `npx convex run devices:resetPairLimit` and the deployment's `--env-file`.
- **"Replace the plan on this phone?"** The code is for another server than the one whose plan is on the
  phone. **Cancel** keeps everything; save a backup file first if you want to keep those tasks.
- **"The server signed this phone out."** The device was revoked. Make a new code with `dayhand pair`; the
  tasks and waiting changes are still on the phone.

### Reminders do not ring on Android

- Settings → Notifications says whether notifications and exact alarms are allowed, with a button for each.
  Without exact alarms, reminders can come a few minutes late.
- Overdue tasks never ring, and a reminder more than 15 minutes late (the phone was off or saving battery)
  is dropped.
- Minutes before the due time need a task with a time; use a time of day for tasks without one.
- After a force stop, Android drops the alarms until you open Dayhand again.

### The days are wrong

"Today", reminders and date phrases follow the time zone in the server's settings, `Europe/London` until you
change it: `dayhand settings` shows it and `dayhand settings set timezone=Europe/Warsaw` changes it. On the
phone, Settings → Server offers **Use this phone's time zone** when the two differ.

### A change was refused

| Message or exit code | Meaning | What to do |
|---|---|---|
| exit 5, `rate_limited` | the key made more than 120 reads or 60 changes this minute | wait as long as the message says, then run it again |
| exit 5, network or server error | the change may or may not have been applied | run the same command with the `--client-id` from the error; it is never applied twice |
| exit 6, `conflict` | another agent holds the task's claim | pick another task, or wait until the time named |
| exit 6, `precondition_failed` | an agent completed a task whose criteria are not all met, or without a summary | tick the criteria (`dayhand criteria`) and add `--summary` |
| exit 7, `agents_paused` | you paused every agent | `dayhand agents resume`, from a `cli` key or the phone |
| exit 7, `forbidden` | only the owner may do this, or a policy denies the tool to this key | use a `cli` key, or change the policy |
| exit 7, `approval_required` | a policy asks first | decide the request on the phone, then rerun with `--approval <id>` |

### The Claude app shows "Unknown client" when connecting

Remove the connector and add it again choosing **Register automatically** for the OAuth client. The steps
and what else to check: [Claude apps](oauth.md#connecting-the-claude-app-manual-procedure).

### Google Calendar does not show a change

Google refreshes subscribed calendars on its own schedule, often every several hours, and ignores the
feed's hint to look again every hour; it also ignores the reminders of a subscribed calendar. Apple
Calendar lets you choose how often it refreshes ([calendar feed](calendar.md)).

### A webhook stopped receiving messages

After 5 deliveries in a row that failed every attempt, a webhook is turned off. `dayhand webhook list`
says so and why, and `dayhand webhook deliveries <id>` shows each attempt. Fix the receiver, check it with
`dayhand webhook test <id>`, then `dayhand webhook enable <id>` ([webhooks](webhooks.md)).

### macOS asks whether Dayhand may use its Keychain item

Every build you make yourself is a new, unsigned app to macOS, so after each rebuild it may ask once. Allow
it; the item holds the Mac's sign-in to your server.

### Something else

Run the failing command with `--json` to see the error code, check `dayhand version` and `dayhand whoami`,
and look at the server's logs (`npx convex logs` in `backend/` with the deployment's `--env-file`). A bug
you can reproduce is welcome as an [issue](https://github.com/maiarowsky/dayhand/issues); a security problem
goes privately ([security](security.md#reporting-a-problem)).
