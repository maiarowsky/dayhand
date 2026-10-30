# Deploying Dayhand

Dayhand deploys the `backend/` folder to a Convex deployment (Convex Cloud or self-hosted). The
repository holds no secrets: everything below goes into the deployment's environment.

Today you run the server yourself, or not at all: the Android, macOS and Linux apps also keep a plan
on the device with no server. Without a server the plan lives only on that device, and Android's own
backup is off for Dayhand, so keep a backup file ([Android backups](android.md#backups)). A hosted
server, Dayhand Cloud, is planned for $5 a month; it is not open yet, and its waitlist is on
[dayhand.dev](https://dayhand.dev/#dayhand-cloud).

## Run your own server in 5 minutes

One command sets up a complete Dayhand server of your own on your own free Convex account: sync for
the phone app, the MCP endpoint for AI agents, the REST API and `dayhand`. Nobody else runs or
maintains anything for you, and nobody else can see your tasks.

You need Node.js 22.12 or newer, on macOS, Linux or Windows. The Convex account is made
(or signed in to) in your browser during the setup.

```sh
npm i -g dayhand
dayhand server deploy
```

`npm i -g dayhand` installs the command line (or `brew install maiarowsky/tap/dayhand`; every way:
[Install](install.md)). The package carries the server it deploys, the `backend/` folder of this
repository, so there is nothing to clone. Because the installed package
folder may be read-only (a Homebrew keg, a global npm prefix), `dayhand server` runs the setup from a
copy of that backend in your user data folder: `~/Library/Application Support/dayhand-data/backend/<version>`
on macOS, `${XDG_DATA_HOME:-$HOME/.local/share}/dayhand-data/backend/<version>` on Linux
(relative `XDG_DATA_HOME` values are ignored), `%LOCALAPPDATA%\dayhand-data\Data\backend\<version>`
on Windows.
The copy is made once per `dayhand` version: dependencies are installed there when missing, and
`dayhand server start` also downloads the Convex local backend there once. Later runs reuse it. A new
`dayhand` version makes a new copy (delete the folders of old versions when you like). Your keys and
server state stay in the server's private folder (`DAYHAND_SERVER_CONFIG_DIR`, below), not in the copy.

An explicit `--backend <folder>` (or `DAYHAND_BACKEND_DIR` when the flag is absent) selects a backend;
an invalid selection fails rather than falling back. Without an explicit path, the order is the
backend in the CLI's own source checkout, a backend in the current folder or its ancestors (including
their `backend/` subfolders), then the packaged backend. Checkouts run in place:

```sh
git clone https://github.com/maiarowsky/dayhand.git
cd dayhand
dayhand server deploy
```

Without `dayhand`, the same setup is `cd dayhand/backend && npm run setup` in a clone (it then prints the
`dayhand login` command to use later).

`dayhand server deploy` (which runs `backend/scripts/setup.mjs`):

1. installs the backend's dependencies from the lockfile when they are missing
   (`npm ci --ignore-scripts`);
2. logs you in to Convex with the browser (`npx convex login`; skipped when this computer is
   already signed in);
3. creates a project, `dayhand` by default, in your team and its production deployment (or uses
   the one you name with `--deployment`);
4. generates an ES256 key pair for the app's sign-in and sets `DAYHAND_JWT_ISSUER` (the
   server's address, `https://<deployment>.convex.site`), `DAYHAND_JWKS` and
   `DAYHAND_JWT_PRIVATE_JWK` in the deployment's environment, passing the values on stdin;
5. deploys `backend/` and checks that `/api/v1/openapi.json`, `/auth/token` and `/mcp` answer;
6. creates a CLI key (kind `cli`) and signs `dayhand` in with it (OS keychain, or a private file),
   and makes a pairing code for the phone, valid for 10 minutes.

If you already used another server, setup stores the new server's key but does not overwrite an
existing profile. Select the printed address explicitly for subsequent commands, for example in a
POSIX shell:

```sh
export DAYHAND_URL=https://<deployment>.convex.site
dayhand whoami
```

Replace `<deployment>` with the name setup prints. Set this again in a new terminal, or pass
`--url https://<deployment>.convex.site` to each command, including `pair` and key creation.

At the end it prints the server address, the pairing code with a QR code, and the next steps:

- **Phone**: open Dayhand, type the server address on the Connect screen and the code (or scan
  the QR code). Another phone later: `dayhand pair`.
- **dayhand**: already signed in; `dayhand add "First task"` and `dayhand` show it works.
- **Claude**: in the Claude app, Settings → Connectors → Add custom connector with
  `https://<deployment>.convex.site/mcp`; in Claude Code, `claude mcp add --transport http dayhand
  https://<deployment>.convex.site/mcp`, then `/mcp` to sign in. Either way you approve the
  connection on the paired phone ([oauth.md](oauth.md)).

Options: `--team <slug>` (asked when you belong to several teams), `--project <name>`,
`--deployment <name>` (an existing production deployment, e.g. made in the dashboard),
`--issuer <url>` (only for a new server). `--dry-run` lists every step and command without
changing anything or using the network. Without a terminal, add `--yes`: every question then
gets its safe answer (keep what is there).

### Where the keys are

Secrets never go into the repository or the output. They are kept in a private folder (mode 700,
files mode 600; on Windows the profile folder's permissions): `DAYHAND_SERVER_CONFIG_DIR`, or
`~/Library/Application Support/dayhand-server` (macOS), `$XDG_CONFIG_HOME/dayhand-server` or
`~/.config/dayhand-server` (Linux), `%APPDATA%\dayhand-server` (Windows). `cloud/` holds the Convex
server, `local/` the one on this computer:

| File | What it is |
|---|---|
| `server.json` | The deployment, its address, the issuer and the user id (`<issuer>\|owner`); no secrets |
| `signing-key.json` | A copy of the app-signing key. The deployment's environment holds the one in use; keep the copy in a password manager or delete it |
| `cli-key` | The CLI key `dayhand` was signed in with; revoke it with `dayhand key revoke` if it leaks |
| `convex.env` | Which deployment the Convex CLI acts on (`local/`: the local backend's admin key) |
| `local/instance-secret.json`, `local/data/` | The local backend's secret and database |

The Convex CLI keeps its own login in `~/.convex`. Anyone with admin access to the deployment
(your Convex account) can read its environment variables.

### Updating

Update the installed package using the same package manager you installed it with, then redeploy.
With npm:

```sh
npm i -g dayhand@latest
dayhand server deploy
```

With Homebrew:

```sh
brew update
brew upgrade dayhand
dayhand server deploy
```

For a local server, stop it with Ctrl+C before updating and run `dayhand server start` instead of
`dayhand server deploy`, with the same options as before (including `--public-url` if used). The new
CLI version stages its own backend copy; it reuses the server's private folder, keys and data.
Run package-installed commands outside any checkout or staged backend directory so that an older
backend cannot win.

**Checkout alternative:** from the repository root, update the checkout and rebuild its linked CLI:

```sh
git pull
(cd cli && npm ci --ignore-scripts && npm run build)
dayhand server deploy
```

Without `dayhand`, run `cd backend && npm run setup` after `git pull` instead (`npm run setup -- --local`
for a local server).

A second run deploys the new code and keeps everything else: the deployment, the keys, the CLI
key (while it still works) and the data. It never replaces `DAYHAND_JWT_ISSUER` (it is part of every
user id, so a new one would hide your tasks) and asks before replacing a signing key the
deployment already has. Read the "Upgrading to" section of the new version below first: some
versions need a step after the deploy.

### What it costs

Nothing, on Convex's Free plan. Its limits per team, as published on [convex.dev/pricing](https://www.convex.dev/pricing) and
[docs.convex.dev/production/state/limits](https://docs.convex.dev/production/state/limits)
(checked 2026-10-23; check them again, they change):

| Resource | Free plan |
|---|---|
| Function calls (app sync, MCP and API requests, scheduled jobs) | 1,000,000 a month |
| Database storage | 0.5 GB |
| Database I/O | 1 GB a month |
| File storage (Dayhand stores no files; backups count) | 1 GB |
| Data egress | 1 GB a month |
| Action compute | 20 GB-hours a month |
| Deployments | 40 per team |
| Developers | 1 to 6 |

On Free the limits are hard caps: once one is reached, new writes may fail; nothing is billed.
The paid Starter plan instead charges for usage above the same amounts. One person's tasks are
small next to these numbers; the Convex dashboard shows what you use.

### Backups

For an npm or Homebrew installation, use the writable backend copy made by `dayhand server deploy`
or `dayhand server start`, not the installed package directory. `<backend-copy>` is the path printed
as `Using the Dayhand backend in …` during setup, for the version shown by `dayhand --version`.
The platform-specific locations are listed in [server setup](#run-your-own-server-in-5-minutes).

Export the data (tasks, history, keys' hashes, devices) to an absolute zip-file path outside the
backend copy and the server's private folder:

```sh
cd "<backend-copy>"
npx convex export --env-file "<folder>/cloud/convex.env" --path "<backup-file>.zip"
```

Replace `<backend-copy>` with the full path (expand `~` to your home directory when quoting it),
`<folder>` with the server's private folder from [Where the keys are](#where-the-keys-are), and
`<backup-file>` with the absolute destination path without `.zip`.

**Checkout alternative:** from the repository root, `cd backend`, then run the same export and
import commands there instead. Keep the zip outside the repository too.

To restore into the same deployment, from the same backend directory:

```sh
npx convex import --env-file "<folder>/cloud/convex.env" --replace-all "<backup-file>.zip"
```

This drops changes made since the export. For a local server, keep `dayhand server start` running
and use `<folder>/local/convex.env` instead of `<folder>/cloud/convex.env` for both export and import.

Into a new deployment, keep the same `DAYHAND_JWT_ISSUER` (from `server.json`),
or the restored tasks belong to a user nobody signs in as: with a new `DAYHAND_SERVER_CONFIG_DIR`,
run `dayhand server deploy --deployment <new> --issuer <old issuer>`, import the zip with that
folder's `convex.env`, run `dayhand server deploy` once more (the import replaced the keys table, so
it makes a new CLI key) and pair the phone again. The environment variables are not in the
export; the signing key can be new.

### On this computer, without an account

```sh
dayhand server start          # or: cd backend && npm run setup -- --local
```

The same setup with the Convex local backend binary on this computer (macOS or Linux, x64 or
arm64; not Windows), downloaded once from Convex's GitHub releases, version pinned and
checksum verified. The binary is source-available under the FSL-1.1-Apache-2.0 licence (each
release becomes Apache 2.0 two years later), not open source. The server runs until Ctrl+C;
the same command starts it again with its data and keys (`local/` in the private folder). It
listens on 127.0.0.1 only (ports 3210 and 3211, `--port` and `--site-port` to change them),
so the phone cannot reach it as it is. The Claude apps need the public HTTPS server above;
Claude Code on the same computer can use `http://127.0.0.1:3211/mcp` with an agent key
([mcp.md](mcp.md#connecting-a-client)).

### Phone and computer (Tailscale)

A release build of the Android app talks to its server over HTTPS only. To use a phone with the
server on your computer, put both in a [Tailscale](https://tailscale.com) network (tailnet):
`tailscale serve` gives the computer an HTTPS address with a certificate inside the tailnet.

1. Install Tailscale on the computer and the phone and sign both in to the same tailnet. In the
   admin console turn on MagicDNS and HTTPS certificates. The computer's name is then
   `<machine>.<tailnet>.ts.net`.
2. On the computer, publish the HTTP actions (pairing, MCP) on port 443 and the Convex API
   (the app's sync) on port 8443, inside the tailnet only:

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:3211
   tailscale serve --bg --https=8443 http://127.0.0.1:3210
   ```

3. If the server is already running, stop it with Ctrl+C first. Start it again with that address,
   keeping the same data and keys, so it gives the phone the HTTPS addresses instead of 127.0.0.1:

   ```sh
   dayhand server start --public-url https://<machine>.<tailnet>.ts.net
   ```

   (`--public-api-url` when the Convex API is not on port 8443.) Then pair the phone with the
   printed address and code. In a second terminal, select that address for later CLI commands
   (POSIX shell), since an existing profile can still point at 127.0.0.1:

   ```sh
   export DAYHAND_URL=https://<machine>.<tailnet>.ts.net
   dayhand whoami
   ```

`tailscale serve status` shows what is published; `tailscale serve reset` stops it. The phone
syncs only while the computer is on and in the tailnet. This setup has not been tested by the
project yet; if the app does not sync, check that the phone opens
`https://<machine>.<tailnet>.ts.net/api/v1/openapi.json`.

## Environment variables

| Variable | Value | Read by |
|---|---|---|
| `DAYHAND_JWT_ISSUER` | Issuer of app tokens, e.g. `https://dayhand.example` | `auth.config.ts`, token signing |
| `DAYHAND_JWKS` | Public key(s) as a JWKS data URI (`data:application/json;base64,…`) | `auth.config.ts` (Convex verifies app JWTs) |
| `DAYHAND_JWT_PRIVATE_JWK` | Private ES256 key as a JWK with `kid`; its public half must be in `DAYHAND_JWKS` under the same `kid` | `POST /auth/token` only; never returned |
| `DAYHAND_MCP_ALLOWED_ORIGINS` | Optional. Comma-separated browser origins allowed to call `/mcp`, e.g. `https://inspector.example`. Unset: any request with an `Origin` header gets `403` | `POST /mcp` |
| `DAYHAND_PUBLIC_URL` | Optional. The URL users add in Claude, without `/mcp`, when it is not the Convex site URL (a custom domain). Unset: `CONVEX_SITE_URL` | OAuth issuer and resource ([oauth.md](oauth.md#configuration)) |
| `DAYHAND_OAUTH_CIMD_ORIGINS` | Optional. Comma-separated origins whose OAuth client metadata documents are fetched. Unset: `https://claude.ai`; production should leave it unset | `GET /oauth/authorize` |
| `DAYHAND_WEBHOOK_ALLOWED_ORIGINS` | Optional. Comma-separated origins exempt from the webhook address rules (HTTPS, public hosts), e.g. a receiver on a self-hosted deployment's own network. Unset: none; production should leave it unset | Webhooks ([webhooks.md](webhooks.md#security)) |
| `DAYHAND_WEBHOOK_RETRY_DELAYS` | Optional. Comma-separated seconds before each webhook retry. Unset: `5,300,1800,7200,18000,36000,36000` | Webhook delivery |

App users are `<DAYHAND_JWT_ISSUER>|<subject>` (single-user deployments use `owner` as subject).
Personal API keys for the CLI and agent should belong to that same user, so the phone, the CLI
and the agent see one task list.

### Renamed variables

Before 0.9.0 these variables were called `HELM_*` (`HELM_JWT_ISSUER`, `HELM_JWKS`,
`HELM_JWT_PRIVATE_JWK` and so on). The backend still reads `HELM_<name>` while
`DAYHAND_<name>` is unset, and logs once per variable that it is deprecated (`npx convex logs`).
`dayhand server deploy` and `npm run setup` leave the old names in place and say which ones the
deployment still uses. Moving to the new names is optional; to do it, copy each value under its
new name, deploy, check, then remove the old one:

```sh
cd backend
npx convex env list                     # which HELM_* names the deployment has
for name in JWT_ISSUER JWKS JWT_PRIVATE_JWK; do
  npx convex env get HELM_$name | npx convex env set DAYHAND_$name
done
npx convex deploy                       # Convex reads auth.config.ts at deploy time
```

Do the same for the optional variables the list shows. The issuer must stay exactly the same
value (it is part of every user id). Check that the phone still syncs and `dayhand whoami`
works, then remove the old names (`npx convex env remove HELM_JWT_ISSUER` and so on) and deploy
once more. Before rolling back to 0.8.x, put the `HELM_*` names back: 0.8.x reads only those.

## First deployment by hand

What `npm run setup` does, step by step, for a deployment you manage yourself:

```sh
cd backend
node scripts/signing-key.mjs new ~/dayhand-signing-key.json       # mode 600, keep it out of the repo
npx convex env set DAYHAND_JWT_ISSUER https://dayhand.example
npx convex env set DAYHAND_JWKS "$(node scripts/signing-key.mjs jwks ~/dayhand-signing-key.json)"
node scripts/signing-key.mjs private ~/dayhand-signing-key.json | npx convex env set DAYHAND_JWT_PRIVATE_JWK
npx convex deploy
npx convex run apiKeys:create '{"userId":"https://dayhand.example|owner","actor":"app","name":"cli","kind":"cli"}'
```

`signing-key.mjs private` refuses to print to a terminal; piping into `npx convex env set NAME`
(no value argument) keeps the key out of shell history and process lists.

## Upgrading to 0.14.1

0.14.1 lets the app send the local day of an offline completion ([`app:complete` with
`completedOn`](api.md#projects)), so a repeating task's next occurrence counts from that day. It changes no
stored schema and needs no migration or new configuration. Deploy it before Dayhand for macOS 0.4.0; an older
server refuses the argument and the Mac sends the completion again without it, counted from the sync day.

## Upgrading to 0.14.0

0.14.0 removes labels: a task has only its project ([Projects](projects.md)). Tasks, history entries and
the JSON export no longer carry `labels`, `list_all` and the search no longer look at them, the calendar
feed has no `CATEGORIES`, and `add_project` returns only `{ project }`. Clients from before 0.14.0 are not
refused when they write: `labels` in `add_task`, `update_task` and the app's `app:add` and `app:update`,
and `fromLabel` and `removeLabel` in `add_project`, are accepted and ignored, over MCP, REST and the app
alike. A `labels` filter is refused instead, so an old script never acts on every task: `list_all`
(`GET /tasks?labels=`) and `app:listAll` answer `invalid_argument` "labels were removed in 0.14.0".
Webhook payloads lose the field too.

The labels stored before stay in the database, unseen, until `migrations:dropLabels` removes them; the
schema keeps `labels` optional until then. It needs no new configuration.

Order of the clients: Android, the Mac and Linux apps neither need the field nor fail without it, in either
order. The `dayhand` CLI before the release that drops labels prints tables with them and fails on tasks
without them (its `--json` output works, except with `--label`, which the server refuses): update the
CLI before or with the server. The new CLI works with
older servers.

1. Take a snapshot to roll back to: `npx convex export --path dayhand-before-0.14.0.zip`. It is the only
   backup of the labels in the history.
2. Deploy: `dayhand server deploy` (or `npx convex deploy`). Check: `dayhand version` shows server 0.14.0.
3. Back up the labels to a new file outside the repository, from the backend folder (with the same
   `--env-file` as `npx convex export`, if you use one):
   ```sh
   node scripts/labels-backup.mjs export "<backup-folder>/dayhand-labels-before-0.14.0.json"
   ```
   It prints how many labels of how many tasks it wrote, and never overwrites a file.
4. Remove them: `npx convex run migrations:dropLabels`. It works in batches and schedules itself, tasks
   first, then the history; a history entry that recorded only a label change is deleted, and a project's
   entry loses `fromLabel` and `removeLabel`. A task's
   `updatedAt` stays, so nothing syncs again. The first call answers `done: false` whatever the size.
5. Wait until `npx convex run migrations:status` shows `tasksWithLabels: 0` and `taskEventsWithLabels: 0`.
   Running `dropLabels` again is harmless.

Once you will not roll back, a later release deletes the `labels` line from `convex/schema.ts`;
Convex accepts that deploy only when no task has the field (step 5).

Rollback: restore the snapshot from step 1, `npx convex import --replace-all dayhand-before-0.14.0.zip`
(this drops every change made since), then deploy 0.13.x. The labels file from step 3 stays as the record
of the labels.

## Upgrading to 0.13.2

0.13.2 lets the app restore a locally calculated repeat into its parent's project, including an
archived one ([`app:add` with `repeatedFrom`](api.md#projects)). It changes no stored schema and
needs no migration or new configuration. Deploy it before installing Android 0.12.0. Rolling back
to 0.13.1 makes Android 0.12.0 keep such occurrences in its outbox until 0.13.2 is back.

## Upgrading to 0.13.1

0.13.1 exposes the 0.13.0 project operations through [MCP](mcp.md#projects) and
[REST](api.md#projects), adds `dayhand://projects` and projects in `agent_brief`, and publishes
the result schemas. It changes no stored schema and needs no migration or new configuration.
Agents may add and update projects by default; the owner's pause and tool policies still apply.
Deleting projects requires a `cli` key. Rolling back to 0.13.0 only removes these interfaces;
rolling back to 0.12.x still requires the project-to-label migration below, which 0.13.x has.

## Upgrading to 0.13.0

0.13.0 adds [backend project support](architecture.md#projects). There is no new status, error
code, secret or webhook event, and no forward migration: existing tasks and labels stay as they
are (0.14.0 later removes labels). For task selectors see [MCP](mcp.md#projects); transfer rules are in
[JSON import](api.md#import) and [Backlog.md](backlog-md.md#using-it).

1. Take a snapshot to roll back to: `npx convex export --path dayhand-before-0.13.0.zip`.
2. Deploy: `dayhand server deploy` (or `npx convex deploy`).
3. Check: `dayhand version` shows server 0.13.0.

Older clients keep working: they ignore the field they do not know, and their changes send only
what changed, so they never take a task out of its project.

Rollback: 0.12.x's schema does not know `projectId`, so Convex refuses to deploy it while any task
has one ("Object contains extra field `projectId`"). Turn the projects back into labels first, with
0.13.x deployed (0.14.0 no longer has `migrations:projectsToLabels`; roll it back as above first).
Every writer must be stopped: the apps, agents, REST and MCP clients. Keep them stopped from
before starting `migrations:projectsToLabels` until 0.12.x is fully deployed, inclusive.

1. `npx convex run migrations:projectsToLabels`: every task in a project gets a label with the
   project's name and loses its `projectId`, then the projects are deleted. A task that already
   has 20 labels keeps them and loses only the project; the deployment's logs name each one
   (`npx convex logs`). Nothing enters the history. It works in batches and schedules itself.
2. Wait until `npx convex run migrations:status` shows `tasksWithProject: 0` and `projects: 0`.
   The starting call's `done` describes only its own batch, not the scheduled run: with more than
   200 tasks, even a repeated scan that changes nothing starts with `done: false`.
3. After it finishes, run `npx convex run migrations:projectsToLabels '{"projects":true}'` to
   repeat only the project-deletion phase. Never use this argument before step 2: it skips the
   task scan. Require `done: true`, `cleared: 0` and `projectsDeleted: 0`, then check
   `migrations:status` again for `tasksWithProject: 0` and `projects: 0`. If either check fails,
   repeat from step 1, keeping every writer stopped.
4. Only then deploy 0.12.x. Keep every writer stopped until this deployment has finished.

To go back to exactly the state before the upgrade instead, restore the snapshot from step 1,
`npx convex import --replace-all dayhand-before-0.13.0.zip` (this also drops every change made
since), then deploy 0.12.x.

## Upgrading to 0.12.0

0.12.0 adds the phase guides `dayhand://workflow/intake`, `/execution` and `/finalization`, the
`agent_brief` tool and Backlog.md import and export (`import_backlog`, `export_backlog`;
[backlog-md.md](backlog-md.md)), with their REST routes `/brief`, `/import/backlog` and
`/export/backlog`. There is no new table, field, status, error code or secret, and no migration:
imported tasks use the `source` field and the `taskSources` table of 0.11.0.

1. Deploy: `dayhand server deploy` (or `npx convex deploy`).
2. Check: `dayhand version` shows server 0.12.0 and `dayhand prime` prints an "Agent brief"
   section.

Rollback: deploy 0.11.x again; nothing needs restoring. Tasks imported from Backlog.md stay
ordinary tasks with a source.

## Upgrading to 0.11.0

0.11.0 lets the owner stay in charge of agents ([agent-work.md](agent-work.md)): approval requests
decided on the phone, a switch that pauses every agent, a tool policy per agent key, a proposal
inbox, and the plan health report. Everything is new tools, routes, optional task fields
(`proposedAt`, `source`, `requestedBy`, `returnTo`, `mergedInto`), error codes (`agents_paused`,
`forbidden`, `approval_required`), webhook events (`approval.decided`, `task.returned`) and four
tables (`approvals`, `agentControls`, `toolPolicies`, `taskSources`). There is no migration, no new
status and no new secret; nothing changes until the owner uses a control or an agent proposes a
task. Older clients keep working: they do not see proposals (which stay out of every list they
read), and an old agent that gets `agents_paused` treats it like any unknown error.

1. Take a snapshot to roll back to: `npx convex export --path dayhand-before-0.11.0.zip`.
2. Deploy: `dayhand server deploy` (or `npx convex deploy`).
3. Check: `dayhand version` shows server 0.11.0, `dayhand agents` prints `Agents run`, and
   `dayhand health` prints the report.

Two things behave differently: `tools/list` of an agent (an `agent` key or an agent connection)
leaves out the owner's tools (deciding approvals, pausing agents, policies, accepting proposals),
and is marked `cacheScope: "private"` on 2026-07-28. A webhook added without `events` gets the
same task events as before; `approval.decided` has to be asked for.

Rollback: 0.10.x's schema does not know the new tables and fields, so Convex refuses to deploy it
while any of them hold data. Restore the snapshot from step 1 first,
`npx convex import --replace-all dayhand-before-0.11.0.zip` (this also drops every change made
since), then deploy 0.10.x. Agents paused at that moment run again after the rollback.

## Upgrading to 0.10.0

0.10.0 adds agent work ([agent-work.md](agent-work.md)): the activity log (`list_events`,
`dayhand://activity`, `GET /api/v1/events`), acceptance criteria, a plan and proof on tasks,
dependencies with a blocked reason and `list_all` `ready`, and time-boxed claims with the new error
code `conflict`. Everything is new, optional fields, tools, routes and one table
(`eventCounters`); no field changes its meaning, there is no new status and no new secret. Older
clients keep working; they just do not see the new fields.

One migration numbers the history from before 0.10.0 into the activity log. Until it has run,
`list_events` shows only changes made after the deploy; nothing else depends on it.

1. Take a snapshot to roll back to: `npx convex export --path dayhand-before-0.10.0.zip`.
2. Deploy: `dayhand server deploy` (or `npx convex deploy`).
3. Number the old history: `npx convex run migrations:backfillEventSeqs`. It works in batches and
   schedules itself; `npx convex run migrations:status` shows `taskEventsWithoutSeq: 0` when it is
   done. Running it again changes nothing.
4. Check: `dayhand version` shows server 0.10.0 and `dayhand log --since 0 --limit 5` lists the
   oldest changes.

Agents get the new behaviour only when they use it: an agent completing a task that has acceptance
criteria needs them met and a proof summary, and another agent's claim refuses its changes with
`conflict`. The app and `cli` keys are never refused. The Android app 0.9.1 shows a claim, the
criteria and the proof in a task's details; older apps ignore the new fields.

Rollback: 0.9.x's schema does not know the new fields, so Convex refuses to deploy it while any
task has them or any history row has `seq` (which the migration gives every old row). Restore the
snapshot from step 1 first, `npx convex import --replace-all dayhand-before-0.10.0.zip` (this also
drops every change made since), then deploy 0.9.x. To keep those changes, roll forward with a fix
instead.

## Upgrading to 0.9.0

0.9.0 renames Helm to Dayhand. There is no schema change, no migration and no new secret: tasks,
API keys, paired phones, agent connections and calendar addresses keep working, and every old
name below is still accepted:

- the variables are `DAYHAND_*`; the `HELM_*` ones are read while the new ones are unset
  ([Renamed variables](#renamed-variables));
- MCP `serverInfo.name` is `dayhand` and the resources are `dayhand://today`, `dayhand://guide`
  and `dayhand://tasks/{ref}` (`helm://` URIs are still read);
- new API keys start with `dayhand_` (`helm_` keys keep working: keys are found by their hash);
- `dayhand pair` prints `dayhand://pair` links. The Android app from 0.9.0 and the macOS app open
  both forms; an older Android app opens only `helm://pair`, so type the code there;
- the import format is `dayhand-json` (`helm-json` still accepted), the calendar export file
  `dayhand.ics`, and the feed's events say `Dayhand #<number>` (their UIDs stay `…@helm`, so
  calendars do not show them twice);
- `WWW-Authenticate` says `realm="dayhand"`, the OpenAPI document `x-dayhand-scope`, and problem
  types are under `https://schemas.dayhand.invalid/`; a client that compares these strings
  exactly needs the new ones;
- the old `helm` command of `backend/` (`npx helm`) is gone; use `dayhand` from `cli/`.

1. Take a snapshot to roll back to: `npx convex export --path dayhand-before-0.9.0.zip`.
2. Deploy: `dayhand server deploy` (or `npx convex deploy`).
3. Check: `dayhand version` shows server 0.9.0, the phone syncs, and `npx convex logs` shows one
   deprecation line for each `HELM_*` variable still in use.

Rollback: deploy 0.8.x again. Nothing in the data changed, and `dayhand_` keys work there too;
only the `HELM_*` variables must be in place (see [Renamed variables](#renamed-variables)).

The sections below were written before the rename: `hlm` is now `dayhand`, the `helm` command
of `backend/` is gone, and their `HELM_*` and `HLM_*` variables are now `DAYHAND_*`.

## Upgrading to 0.8.0

0.8.0 adds the REST API for integrations ([api.md](api.md)), webhooks
([webhooks.md](webhooks.md)), import, and API keys with a scope and an expiry date:

- new optional fields in `apiKeys`: `scope`, `expiresAt`, `parentKeyId`;
- new tables `webhooks` and `webhookDeliveries`, and a daily cron
  (`webhooks.purgeDeliveries`, 04:15 UTC) that drops delivery log entries older than 30 days;
- new routes under `/api/v1/` (`/api/v1/openapi.json` is public);
- the optional variables `HELM_WEBHOOK_ALLOWED_ORIGINS` and `HELM_WEBHOOK_RETRY_DELAYS`
  (leave both unset in production).

Every new field is optional and every key without a scope is a full key, so there is **no
migration** and no new secret: existing keys, the app, agents and `hlm` 0.7 keep working.
Nothing sends webhooks until a user adds one. One behaviour tightens: `/devices*`,
`/connections*` and `/calendar/feed*` now need a full key; since every existing key is full,
this only affects the new `read` and `write` keys.

1. Take a snapshot to roll back to: `npx convex export --path helm-before-0.8.0.zip` (it holds
   the user's tasks; keep it out of the repository).
2. Deploy: `npx convex deploy`.
3. Check, with the key `hlm` uses (`hlm whoami` shows the URL):

   ```sh
   curl -s https://<name>.convex.site/api/v1/openapi.json | head -c 200        # public, "openapi": "3.1.0"
   curl -s -o /dev/null -w '%{http_code}\n' https://<name>.convex.site/api/v1/today \
     -H "Authorization: Bearer $HLM_API_KEY"                                    # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://<name>.convex.site/api/v1/today   # 401
   ```

   `npx convex logs` shows any error. The MCP endpoint reports `serverInfo.version` `0.8.0`.
4. Optional: give each integration its own key with the smallest scope and an expiry, from a
   full key (`hlm key create n8n --scope read --expires 90d`, hlm 0.8.0) or as the admin
   (`npx convex run apiKeys:create '{"userId":"<issuer>|owner","actor":"app","name":"n8n","scope":"read","expiresAt":<ms>}'`).

Rollback: first remove what 0.7.0 does not know, then deploy 0.7.0 again.

1. Remove the webhooks (`hlm webhook rm <id> --yes` for each, which also deletes their
   delivery logs) and revoke the keys that have a scope or an expiry date, or were created with a
   key (`hlm key list`, `hlm key revoke <id>`).
2. Deploy 0.7.0. Its schema has no `webhooks`, `webhookDeliveries`, `scope`, `expiresAt` or
   `parentKeyId`, so Convex refuses the push while any row has them. Empty a table the same
   way as `callLimits` for 0.4.0 below (`npx convex import --table webhookDeliveries --replace
   --yes empty.jsonl`, likewise `webhooks`). A revoked key still carries its `scope`: delete
   those rows by hand (`npx convex data apiKeys` shows them) or restore the snapshot from
   step 1 of the upgrade (`npx convex import --replace-all helm-before-0.8.0.zip`, which drops
   changes made since).
3. Tasks created by an import and history entries with the actions `import`, `webhook.*` and
   `apiKey.*` are ordinary rows that 0.7.0 reads as they are; nothing else needs to change.
   Integrations that use `/api/v1` then get `404` until 0.8.0 is back.

## Upgrading to 0.7.0

0.7.0 adds the read-only calendar feed ([calendar.md](calendar.md)): the table `calendarFeeds`,
the routes `GET /cal/<token>.ics` and `/calendar/feed*`, and the format `ics` of `export_plan`.
Nothing existing changes, so there is no migration and no new environment variable:
`npx convex deploy` is enough. The feed URL is built from `CONVEX_SITE_URL`, which Convex sets
itself. The feed is off for every user until they turn it on (Android 0.8.0 Settings →
Calendar, or `hlm calendar on` with hlm 0.7.0); older apps and `hlm` keep working without it.

Rollback: turn the feeds off (`hlm calendar off --yes`), then deploy 0.6.0 again. Its schema
has no `calendarFeeds`; if Convex refuses the push because the table holds rows, empty it the
same way as `callLimits` for 0.4.0 below. Subscribed calendars then get `404` and keep their
last copy.

## Upgrading to 0.6.0

0.6.0 adds OAuth for the Claude apps ([oauth.md](oauth.md)): the tables `oauthClients`,
`oauthRequests`, `oauthGrants` and `oauthTokens`, the optional field `connectionId` in
`taskEvents` and `callLimits` (where `keyId` becomes optional), and a daily cron
(`oauth.purgeExpired`, 04:00 UTC). Existing rows stay valid, so there is no migration and no
new secret: `npx convex deploy` is enough. API keys, the app and `hlm` 0.5 keep working; the
only visible change for them is a longer `WWW-Authenticate` header on `401` from `/mcp`.
Connecting the Claude app afterwards is a manual step done once on the phone
([oauth.md](oauth.md#connecting-the-claude-app-manual-procedure)). The Android app needs 0.7.0
for Settings → Agent connections; older apps keep working without it.

Rollback: revoke the connections first (`hlm connection revoke <id>`), then deploy 0.5.0
again. Its schema has no OAuth tables and no `connectionId`; if Convex refuses the push because
of rows in them, empty the four `oauth*` tables and `callLimits` the same way as for 0.4.0
below. History entries written through a connection keep their `connectionId` and would block
the push too; they are rare enough to delete by hand (`npx convex data taskEvents`), or stay on
0.6.0.

## Upgrading to 0.5.0

0.5.0 adds `checklist` and `reminders` to tasks and new optional fields to `repeat` (`from`,
`monthDay`, `weekdayOfMonth`, `until`, `count`). All of them are optional in the schema, so the
deploy accepts existing data and needs no migration: a task without them repeats, rings and
exports as before. Deploy with `npx convex deploy`.

Clients: the CLI and the agent keep working unchanged. An app older than 0.6.0 shows repeat rules
with the new fields as their plain unit and does not show checklists or per-task reminders;
changing such a task's repeat rule in that app replaces the rule with what it shows.

Rollback: deploying 0.4.0 again fails schema validation once any task uses a new field. Roll
forward with a fix, or remove the new fields from those tasks first (or restore a snapshot taken
before the deploy with `npx convex export`).

## Upgrading to 0.4.0

0.4.0 adds the table `callLimits` (MCP calls per key and minute) and changes nothing in the
existing tables, so there is no migration: `npx convex deploy` is enough, and 0.3 clients (the
app, `hlm` 0.3, agents) keep working. Calls are now limited per key (120 reads and 60 changes a
minute), and `/mcp` refuses requests with a browser `Origin` that is not in
`HELM_MCP_ALLOWED_ORIGINS`; MCP clients outside a browser send no `Origin`.

Rollback: deploy 0.3.0 again. Its schema does not define `callLimits`; if Convex refuses the
push because that table holds rows, empty it first (`npx convex import --table callLimits
--replace --yes empty.jsonl` with an empty file). The rows only count calls, so nothing is lost.

## Upgrading to 0.3.0

0.3.0 adds task numbers (`tasks.ref`, new table `taskCounters`) and key kinds (`apiKeys.kind`,
`taskEvents.keyId` and `actorName`). All new fields are optional in the schema, so the deploy
accepts existing data, and the app, the agent and old API keys keep working before the
migration runs. Until then, tasks created before the upgrade have no number (`#n` does not
find them) and old keys count as `agent` keys.

0. Take a snapshot to roll back to: `npx convex export --path helm-before-0.3.0.zip` (it holds
   the user's tasks; keep it out of the repository).
1. Deploy: `npx convex deploy`.
2. Right after, number the existing tasks (oldest first, per user; runs in batches of 200 and
   schedules itself until done) and mark the existing keys as `agent` keys:

   ```sh
   npx convex run migrations:backfillTaskRefs
   npx convex run migrations:backfillKeyKinds
   ```

   Run it right away: tasks added between the deploy and the migration get numbers first, so
   older tasks get the numbers after them. Both migrations are idempotent and can be run again.
3. Check that nothing is left: `npx convex run migrations:status` must show
   `keysWithoutKind: 0` and `tasksWithoutRef: 0` (later backends return additional counters).
   If `tasksWithoutRef` is not 0 yet, the scheduled batches are still running; check again after
   a few seconds.
4. If the key the user types commands with is a CLI key, make a new one with
   `"kind": "cli"` (see [mcp.md](mcp.md#keys-and-actors)), switch the CLI to it and revoke the
   old one, so the history shows `cli` instead of `agent: <name>`. Kinds cannot be changed on
   an existing key.

Rollback: deploying 0.2.0 again over migrated data fails schema validation (`ref`, `kind`,
`actor: "cli"`, `keyId` and `actorName` are unknown to it). Roll forward with a fix instead, or
restore the snapshot from step 0 (`npx convex import --replace-all helm-before-0.3.0.zip`,
which drops changes made since) and deploy 0.2.0.

## Moving an existing key from disk into the deployment

For a deployment that already trusts a key pair kept on a computer (the private half was used
to sign app tokens locally):

1. Check that the deployment publishes the key you hold:

   ```sh
   npx convex env get DAYHAND_JWKS | node scripts/signing-key.mjs check /path/to/key.json
   ```

   It must print `OK: DAYHAND_JWKS publishes this key (kid …)`. The file may hold the private JWK
   itself or `{ "privateJwk": … }`, as written by `npm run app-token -- --generate` and
   `scripts/signing-key.mjs new`.

2. Set the private key, then deploy the code with pairing:

   ```sh
   node scripts/signing-key.mjs private /path/to/key.json | npx convex env set DAYHAND_JWT_PRIVATE_JWK
   npx convex deploy
   ```

3. Check the configuration without a real device: a bogus device token must get `401`
   (configured), not `503` (not configured):

   ```sh
   curl -s -X POST https://<name>.convex.site/auth/token \
     -H 'Content-Type: application/json' -d '{"deviceToken":"helmdev_x.y"}'
   # {"error":"invalid_grant",…}
   ```

   On `503`, `npx convex logs` shows the reason (missing variable, or a key that does not
   match `DAYHAND_JWKS`).

4. Check that the CLI's API key belongs to the app user: `npx convex data apiKeys` must show
   `userId` = `<DAYHAND_JWT_ISSUER>|owner`. Then `dayhand pair` works and the phone sees the same tasks.

5. Paste-in tokens issued earlier with `npm run app-token` keep working until they expire
   (same key). Pair the phone instead, then stop issuing them.

6. Move the key file off the disk into an offline backup (a password manager), or delete it.
   The deployment environment is now the only place that needs it. Anyone with admin access to
   the deployment can read its environment variables.

## Rotating the signing key

1. `node scripts/signing-key.mjs new new-key.json`.
2. Publish both public keys for an hour: set `DAYHAND_JWKS` to a data URI whose `keys` array holds
   the old and the new key, and deploy (`auth.config.ts` is read at deploy time).
3. Pipe the new private key into `DAYHAND_JWT_PRIVATE_JWK`; new tokens are signed with it.
4. After an hour (the token lifetime), set `DAYHAND_JWKS` to the new key only and deploy again.

Paired devices keep working through a rotation: their device tokens do not depend on the key.
