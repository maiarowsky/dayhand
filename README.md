# Dayhand

Dayhand is a personal task manager and day plan. Its main screen is **Today**: overdue
tasks on top, then today's tasks, then what is already done. A three-column board,
labels, repeating tasks (also RFC 5545 RRULE), checklists, per-task reminders, links and a
30-day trash complete it. A week and day calendar shows the plan on the phone, and a read-only
iCalendar feed shows it in Google or Apple Calendar ([docs/calendar.md](docs/calendar.md)).

The app and an AI agent are two clients of the same operations: the agent connects over
[MCP](https://modelcontextprotocol.io) with a personal, revocable API key and can do
everything the user can. The Claude apps connect as a custom connector instead: they sign in
with OAuth, and the owner approves each connection on the paired phone and can disconnect it
there ([docs/oauth.md](docs/oauth.md)). Other tools use the REST API `/api/v1` with an OpenAPI
3.1 description, keys limited to reading or writing and an expiry date
([docs/api.md](docs/api.md)), signed webhooks ([docs/webhooks.md](docs/webhooks.md)) and
import from Dayhand JSON, iCalendar or Todoist CSV. Every change is recorded with who made it
(`app`, `cli` or `agent: <name>`).

Several agents can work on one plan: an activity log returns only what changed since an agent's
own cursor, tasks carry acceptance criteria, a plan and proof of completion, dependencies and a
blocked reason (`list_all` `ready`), and an agent claims a task for a while so others leave it
alone, while the owner can always take it over ([docs/agent-work.md](docs/agent-work.md)).

Dayhand was called Helm until backend 0.9.0 and CLI 0.10.0; see
[Renamed from Helm](#renamed-from-helm) for what changed and what keeps working.

Status: the backend (Convex), the MCP endpoint, the `dayhand` CLI, phone pairing and the Android
app (Today with quick add, the board, task details and the trash, reminders and Settings, all
working offline, on the phone alone or with a server) are in place; iOS comes later.

```
backend/   Convex backend: data model, domain operations, MCP endpoint, REST API, webhooks
cli/       dayhand, the command line client for people and agents; see cli/README.md
android/   Android app (Kotlin, Compose): Today, board, task details, reminders, settings, offline outbox; see android/README.md
ios/       iOS app (Swift), later
macos/     Dayhand for macOS (Swift, SwiftUI): Today, quick add, menu bar, reminders, offline outbox; see macos/README.md
docs/      Architecture, MCP, REST API and webhooks, OAuth for the Claude apps, the calendar feed, phone pairing, deployment and release notes
man/       dayhand(1), generated from the CLI's command registry
packaging/ Homebrew formula template
```

## Install on Android

You need Android 8.0 or newer. No server is needed to start.

1. On the phone, open the [latest release](https://github.com/maiarowsky/helm/releases/latest)
   and download the `.apk` file under **Assets**.
2. Open the downloaded file. Android asks whether to allow apps from this source (your browser
   or file manager); allow it, go back and tap **Install**.
3. Open Dayhand. It starts on **Welcome to Dayhand**; under **On this phone only** tap **Start with an
   empty plan**, or **Try with sample data** to look around first (one tap removes it).

**On this phone only**, you have Today with quick add, the calendar, the board, task
details (repeat, checklist, labels, links, reminders), the trash, reminders and the morning
summary, the appearance and notification settings, and a backup file of your plan (**Settings →
Data → Backup**: save, share or restore it). What needs a server: sync with other devices and
the `dayhand` CLI, an AI agent over MCP or the Claude app, the calendar address for Google or Apple
Calendar and Export (Markdown, JSON, .ics). Without a server the tasks exist only on this phone:
Android backups are switched off for Dayhand, so uninstalling the app or losing the phone loses
whatever is not in a backup file. "Today" and reminder times follow the phone's time zone until
you connect a server, then the server's.

Dayhand runs no public server: the address on Connect is empty in the downloaded app. The author's
own server lets a phone in only with a pairing code from that account's owner. To sync, run your
own server ([Run your own server in 5 minutes](#run-your-own-server-in-5-minutes) or
[Deploy your own copy](#deploy-your-own-copy)), then in Dayhand open **Settings → Server →
Connect to my server** and type your server's address (`https://<deployment>.convex.site`) and
a pairing code from it (`dayhand server deploy` prints both; `dayhand pair` makes a new code). Tasks you
added on the phone are sent to it (sample tasks are not).

More about the app: [android/README.md](android/README.md).

## The `dayhand` command line

`dayhand` (short: `dh`) needs Node.js 22.12 or newer and runs on macOS, Linux and Windows. It is not on npm or
Homebrew yet (see [docs/release.md](docs/release.md)); install it from this repository:

```sh
cd cli
npm ci --ignore-scripts && npm run build
npm link                       # puts dayhand on the PATH (npm unlink -g dayhand removes it)
```

Once it is published: `npm install -g <package>` or `brew install <owner>/dayhand/dayhand`.

Quick start:

```sh
dayhand login --url https://<deployment>.convex.site   # paste an API key (kind cli) made in the app
dayhand add Call the accountant --due "fri 2pm" -l home
dayhand                                                 # Today: now, overdue, today, done
dayhand done 1
dayhand pair                                            # QR code: signs the phone app in as you
```

`dayhand login` keeps the key in the OS keychain, never in a shell profile. `dayhand help dates` lists
the date phrases, `source <(dayhand completion bash)` adds Tab completion (also zsh, fish,
PowerShell), and `man dayhand` or [docs/cli.md](docs/cli.md) has every command. `dh` is the same
command with a shorter name; on Debian and Ubuntu, debhelper installs a `dh` of its own
(`/usr/bin/dh`), so type `dayhand` there.

### Full screen in the terminal: `dayhand ui`

`dayhand ui` opens Today, the board, the week (Monday to Sunday as bars) and the trash full screen,
with keys like vim and lazygit (`j`/`k`, `h`/`l`, `?` for help), quick add with date phrases
(`a`, then `Call the accountant fri 2pm #home`) and the mouse. Task details show the history
with who made each change, so an agent's edits stand out. It refreshes every 12 seconds and
uses the terminal's 16 colours, so it follows the terminal theme; on Omarchy it becomes an
app of its own ([docs/omarchy.md](docs/omarchy.md)). Keys: `dayhand help ui`.

For AI agents: give each agent its own key (kind `agent`) in `DAYHAND_API_KEY`, use `--json`
(exact MCP results, [schemas](docs/schemas)), and add `dayhand prime` to a session-start hook.
[docs/skills/dayhand/SKILL.md](docs/skills/dayhand/SKILL.md) is a ready Agent Skill: copy the folder
to `~/.claude/skills/dayhand/` (or your agent's skills folder).

## Run your own server in 5 minutes

Dayhand has no shared server to sign up for: you run your own, on your own free Convex account,
with one command. It gives the phone app its sync, AI agents the MCP endpoint, and `dayhand` and
other tools the REST API. Needs Node.js 22.12+ and git (macOS, Linux or Windows):

```sh
git clone https://github.com/maiarowsky/helm.git
cd helm/cli && npm ci --ignore-scripts && npm run build && npm link && cd ..
dayhand server deploy      # logs in to Convex in the browser, deploys, signs dayhand in
```

It prints the server address and a pairing code for the phone app's Connect screen, and how to
add Dayhand to Claude. Run it again to update; keys and data are kept. `cd backend && npm run setup`
does the same without `dayhand`, and `dayhand server start` runs the server on this computer without an
account. What it does, where the keys are kept, what it costs (nothing on Convex's Free plan),
backups and a phone with a server on your computer (Tailscale): [docs/deploy.md](docs/deploy.md).

## Run the backend locally

Requirements: Node.js 20 or newer, macOS or Linux (arm64 or x64). No Convex account is needed:
the Convex local backend binary runs on your machine. It is downloaded once from Convex's GitHub
releases (pinned version, checksum verified) and is source-available under the
FSL-1.1-Apache-2.0 licence, not open source. `dayhand server start` sets up the same in one step
(with its data in its own folder, see [docs/deploy.md](docs/deploy.md)); by hand:

```sh
cd backend
npm ci --ignore-scripts
npm run backend:start          # downloads the pinned binary once, deploys, keeps running
```

In a second terminal, create a personal API key (printed once) and use the CLI:

```sh
(cd backend && npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli","kind":"cli"}')
cd cli
npm ci --ignore-scripts && npm run build
export DAYHAND_URL=http://127.0.0.1:3211
export DAYHAND_API_KEY=<the key>
node dist/bin/dayhand.js add "Review the plan" --time 09:00     # or `npm link` once, then: dayhand …
node dist/bin/dayhand.js                                        # Today
node dist/bin/dayhand.js pair    # one-time code that signs the phone app in as the same user
```

All commands: [docs/cli.md](docs/cli.md).

The user id `https://helm.local|me` is the app user of the local backend (issuer
`https://helm.local`), so the CLI, the agent and a paired phone share one task list. See
[docs/pairing.md](docs/pairing.md) for the pairing protocol.

Connect an MCP client to `http://127.0.0.1:3211/mcp` with the header
`Authorization: Bearer <the key>`. See [docs/mcp.md](docs/mcp.md) for the tools, resources,
prompts, limits and protocol versions. To add Dayhand to the Claude app, see
[docs/oauth.md](docs/oauth.md#connecting-the-claude-app-manual-procedure); the Claude apps
reach the server from Anthropic's network, so this needs a public HTTPS deployment.

Run the tests (they start their own throwaway backend):

```sh
cd backend
npm test
cd ../cli
npm test        # needs backend/node_modules; tests dayhand against a throwaway backend
```

## Deploy your own copy

The repository holds no secrets, and the Android app has no built-in server. Your own
server comes from `dayhand server deploy` (above), or by hand: deploy the `backend/` folder to your
own Convex project (`npx convex deploy`) or to a self-hosted Convex backend, and set
`DAYHAND_JWT_ISSUER`, `DAYHAND_JWKS` and `DAYHAND_JWT_PRIVATE_JWK` in its environment (see
[docs/deploy.md](docs/deploy.md)). Type your server's address on the Connect screen, or build
the app with `-Pdayhand.serverUrl=https://<deployment>.convex.site` to make it the default
([android/README.md](android/README.md)).

## Renamed from Helm

Helm became Dayhand in backend 0.9.0, CLI 0.10.0 and Android app 0.9.0. Nothing has to change
at once; the old names keep working with a deprecation warning:

| Before | Now | Old name |
|---|---|---|
| `hlm` command | `dayhand`, short `dh` | `hlm` still runs until CLI 1.0 and warns on every run |
| CLI variables `HLM_*`, `HELM_URL`, `HELM_API_KEY`, `HELM_BACKEND_DIR`, `HELM_SERVER_CONFIG_DIR` | `DAYHAND_*` | read while the `DAYHAND_*` name is unset, with a warning |
| CLI config folder `hlm` (e.g. `~/.config/hlm`) | `dayhand` | used while there is no `dayhand` folder, with a warning saying where to move it |
| keychain entry `hlm` | `dayhand` | read when there is no `dayhand` entry; `dayhand logout` removes both |
| server folder `helm-server` | `dayhand-server` | used while there is no `dayhand-server` folder |
| deployment variables `HELM_*` | `DAYHAND_*` | read while `DAYHAND_*` is unset ([docs/deploy.md](docs/deploy.md#renamed-variables)) |
| Android build: `-Phelm.serverUrl`, `HELM_RELEASE_*` | `-Pdayhand.serverUrl`, `DAYHAND_RELEASE_*` | read when the new one is unset (Gradle warns) |
| API keys `helm_…` | new keys start with `dayhand_` | old keys work until revoked |
| MCP resources `helm://…`, pairing links `helm://pair` | `dayhand://…` | still accepted |
| import format `helm-json` | `dayhand-json` | still accepted |
| `backend/cli/helm.mjs` (`npx helm`) | `dayhand` | removed |

These stay as they were, because they are stored in data or in tokens already given out: the
issuer `https://helm.local` of the local backend and the user ids made from it, the JWT audience
`helm`, the device and OAuth token prefixes (`helmdev_`, `helmat_`, `helmrt_`…), the calendar
UIDs `…@helm` (a new suffix would duplicate every event in Google and Apple Calendar), the
Android app's storage names and Kotlin package `dev.helm.planner`, and the GitHub repository
`maiarowsky/helm`.

### Known risk: another DayHand

There is an unrelated to-do app called DayHand for iPhone, iPad and
Mac ([amouraux/DayHand](https://github.com/amouraux/DayHand), in public TestFlight beta in
October 2026). App Store names are unique, so if it gets there first, this project's Apple apps
would be listed as "Dayhand Planner". The CLI, npm, Homebrew and Android are not affected.

## Help

Questions and problems with your own server: open an issue at
[github.com/maiarowsky/helm/issues](https://github.com/maiarowsky/helm/issues). Dayhand is a
personal project, so there is no support promise or response time. Security problems go
privately, never in an issue ([SECURITY.md](SECURITY.md)).

## License

[Apache License 2.0](LICENSE). Contributions are accepted under the
[Developer Certificate of Origin](CONTRIBUTING.md).
