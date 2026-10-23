# Deploying Helm

Helm deploys the `backend/` folder to a Convex deployment (Convex Cloud or self-hosted). The
repository holds no secrets: everything below goes into the deployment's environment.

## Run your own server in 5 minutes

One command sets up a complete Helm server of your own on your own free Convex account: sync for
the phone app, the MCP endpoint for AI agents, the REST API and `hlm`. Nobody else runs or
maintains anything for you, and nobody else can see your tasks.

You need Node.js 22.12 or newer and git, on macOS, Linux or Windows. The Convex account is made
(or signed in to) in your browser during the setup.

```sh
git clone https://github.com/maiarowsky/helm.git
cd helm/cli && npm ci --ignore-scripts && npm run build && npm link && cd ..
hlm server deploy
```

Without `hlm`, the same setup is `cd helm/backend && npm run setup` (it then prints the
`hlm login` command to use later). `npm link` puts `hlm` on the PATH; where it needs
administrator rights, run `node cli/dist/bin/hlm.js server deploy` instead.

`hlm server deploy` (which runs `backend/scripts/setup.mjs`):

1. installs the backend's dependencies from the lockfile when they are missing
   (`npm ci --ignore-scripts`);
2. logs you in to Convex with the browser (`npx convex login`; skipped when this computer is
   already signed in);
3. creates a project, `helm` by default, in your team and its production deployment (or uses
   the one you name with `--deployment`);
4. generates an ES256 key pair for the app's sign-in and sets `HELM_JWT_ISSUER` (the
   server's address, `https://<deployment>.convex.site`), `HELM_JWKS` and
   `HELM_JWT_PRIVATE_JWK` in the deployment's environment, passing the values on stdin;
5. deploys `backend/` and checks that `/api/v1/openapi.json`, `/auth/token` and `/mcp` answer;
6. creates a CLI key (kind `cli`) and signs `hlm` in with it (OS keychain, or a private file),
   and makes a pairing code for the phone, valid for 10 minutes.

At the end it prints the server address, the pairing code with a QR code, and the next steps:

- **Phone**: open Helm, type the server address on the Connect screen and the code (or scan
  the QR code). Another phone later: `hlm pair`.
- **hlm**: already signed in; `hlm add "First task"` and `hlm` show it works.
- **Claude**: in the Claude app, Settings → Connectors → Add custom connector with
  `https://<deployment>.convex.site/mcp`; in Claude Code, `claude mcp add --transport http helm
  https://<deployment>.convex.site/mcp`, then `/mcp` to sign in. Either way you approve the
  connection on the paired phone ([oauth.md](oauth.md)).

Options: `--team <slug>` (asked when you belong to several teams), `--project <name>`,
`--deployment <name>` (an existing production deployment, e.g. made in the dashboard),
`--issuer <url>` (only for a new server). `--dry-run` lists every step and command without
changing anything or using the network. Without a terminal, add `--yes`: every question then
gets its safe answer (keep what is there).

### Where the keys are

Secrets never go into the repository or the output. They are kept in a private folder (mode 700,
files mode 600; on Windows the profile folder's permissions): `HELM_SERVER_CONFIG_DIR`, or
`~/Library/Application Support/helm-server` (macOS), `$XDG_CONFIG_HOME/helm-server` or
`~/.config/helm-server` (Linux), `%APPDATA%\helm-server` (Windows). `cloud/` holds the Convex
server, `local/` the one on this computer:

| File | What it is |
|---|---|
| `server.json` | The deployment, its address, the issuer and the user id (`<issuer>\|owner`); no secrets |
| `signing-key.json` | A copy of the app-signing key. The deployment's environment holds the one in use; keep the copy in a password manager or delete it |
| `cli-key` | The CLI key `hlm` was signed in with; revoke it with `hlm key revoke` if it leaks |
| `convex.env` | Which deployment the Convex CLI acts on (`local/`: the local backend's admin key) |
| `local/instance-secret.json`, `local/data/` | The local backend's secret and database |

The Convex CLI keeps its own login in `~/.convex`. Anyone with admin access to the deployment
(your Convex account) can read its environment variables.

### Updating

```sh
git pull
hlm server deploy         # or: cd backend && npm run setup
```

A second run deploys the new code and keeps everything else: the deployment, the keys, the CLI
key (while it still works) and the data. It never replaces `HELM_JWT_ISSUER` (it is part of every
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
| File storage (Helm stores no files; backups count) | 1 GB |
| Data egress | 1 GB a month |
| Action compute | 20 GB-hours a month |
| Deployments | 40 per team |
| Developers | 1 to 6 |

On Free the limits are hard caps: once one is reached, new writes may fail; nothing is billed.
The paid Starter plan instead charges for usage above the same amounts. One person's tasks are
small next to these numbers; the Convex dashboard shows what you use.

### Backups

Export the data (tasks, history, keys' hashes, devices) to a zip file outside the repository:

```sh
cd backend
npx convex export --env-file "<folder>/cloud/convex.env" --path ~/helm-backup-$(date +%F).zip
```

`<folder>` is the private folder above. To restore into the same deployment:
`npx convex import --env-file "<folder>/cloud/convex.env" --replace-all <file>.zip` (it drops
changes made since). Into a new deployment, keep the same `HELM_JWT_ISSUER` (from `server.json`),
or the restored tasks belong to a user nobody signs in as: with a new `HELM_SERVER_CONFIG_DIR`,
run `hlm server deploy --deployment <new> --issuer <old issuer>`, import the zip with that
folder's `convex.env`, run `hlm server deploy` once more (the import replaced the keys table, so
it makes a new CLI key) and pair the phone again. The environment variables are not in the
export; the signing key can be new.

### On this computer, without an account

```sh
hlm server start          # or: cd backend && npm run setup -- --local
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

3. Start the server with that address, so it gives the phone the HTTPS addresses instead of
   127.0.0.1:

   ```sh
   hlm server start --public-url https://<machine>.<tailnet>.ts.net
   ```

   (`--public-api-url` when the Convex API is not on port 8443.) Then pair the phone with the
   printed address and code.

`tailscale serve status` shows what is published; `tailscale serve reset` stops it. The phone
syncs only while the computer is on and in the tailnet. This setup has not been tested by the
project yet; if the app does not sync, check that the phone opens
`https://<machine>.<tailnet>.ts.net/api/v1/openapi.json`.

## Environment variables

| Variable | Value | Read by |
|---|---|---|
| `HELM_JWT_ISSUER` | Issuer of app tokens, e.g. `https://helm.example` | `auth.config.ts`, token signing |
| `HELM_JWKS` | Public key(s) as a JWKS data URI (`data:application/json;base64,…`) | `auth.config.ts` (Convex verifies app JWTs) |
| `HELM_JWT_PRIVATE_JWK` | Private ES256 key as a JWK with `kid`; its public half must be in `HELM_JWKS` under the same `kid` | `POST /auth/token` only; never returned |
| `HELM_MCP_ALLOWED_ORIGINS` | Optional. Comma-separated browser origins allowed to call `/mcp`, e.g. `https://inspector.example`. Unset: any request with an `Origin` header gets `403` | `POST /mcp` |
| `HELM_PUBLIC_URL` | Optional. The URL users add in Claude, without `/mcp`, when it is not the Convex site URL (a custom domain). Unset: `CONVEX_SITE_URL` | OAuth issuer and resource ([oauth.md](oauth.md#configuration)) |
| `HELM_OAUTH_CIMD_ORIGINS` | Optional. Comma-separated origins whose OAuth client metadata documents are fetched. Unset: `https://claude.ai`; production should leave it unset | `GET /oauth/authorize` |
| `HELM_WEBHOOK_ALLOWED_ORIGINS` | Optional. Comma-separated origins exempt from the webhook address rules (HTTPS, public hosts), e.g. a receiver on a self-hosted deployment's own network. Unset: none; production should leave it unset | Webhooks ([webhooks.md](webhooks.md#security)) |
| `HELM_WEBHOOK_RETRY_DELAYS` | Optional. Comma-separated seconds before each webhook retry. Unset: `5,300,1800,7200,18000,36000,36000` | Webhook delivery |

App users are `<HELM_JWT_ISSUER>|<subject>` (single-user deployments use `owner` as subject).
Personal API keys for the CLI and agent should belong to that same user, so the phone, the CLI
and the agent see one task list.

## First deployment by hand

What `npm run setup` does, step by step, for a deployment you manage yourself:

```sh
cd backend
node scripts/signing-key.mjs new ~/helm-signing-key.json       # mode 600, keep it out of the repo
npx convex env set HELM_JWT_ISSUER https://helm.example
npx convex env set HELM_JWKS "$(node scripts/signing-key.mjs jwks ~/helm-signing-key.json)"
node scripts/signing-key.mjs private ~/helm-signing-key.json | npx convex env set HELM_JWT_PRIVATE_JWK
npx convex deploy
npx convex run apiKeys:create '{"userId":"https://helm.example|owner","actor":"app","name":"cli","kind":"cli"}'
```

`signing-key.mjs private` refuses to print to a terminal; piping into `npx convex env set NAME`
(no value argument) keeps the key out of shell history and process lists.

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
3. Check that nothing is left: `npx convex run migrations:status` must print
   `{ "keysWithoutKind": 0, "tasksWithoutRef": 0 }`. If `tasksWithoutRef` is not 0 yet, the
   scheduled batches are still running; check again after a few seconds.
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
   npx convex env get HELM_JWKS | node scripts/signing-key.mjs check /path/to/key.json
   ```

   It must print `OK: HELM_JWKS publishes this key (kid …)`. The file may hold the private JWK
   itself or `{ "privateJwk": … }`, as written by `npm run app-token -- --generate` and
   `scripts/signing-key.mjs new`.

2. Set the private key, then deploy the code with pairing:

   ```sh
   node scripts/signing-key.mjs private /path/to/key.json | npx convex env set HELM_JWT_PRIVATE_JWK
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
   match `HELM_JWKS`).

4. Check that the CLI's API key belongs to the app user: `npx convex data apiKeys` must show
   `userId` = `<HELM_JWT_ISSUER>|owner`. Then `helm pair` works and the phone sees the same tasks.

5. Paste-in tokens issued earlier with `npm run app-token` keep working until they expire
   (same key). Pair the phone instead, then stop issuing them.

6. Move the key file off the disk into an offline backup (a password manager), or delete it.
   The deployment environment is now the only place that needs it. Anyone with admin access to
   the deployment can read its environment variables.

## Rotating the signing key

1. `node scripts/signing-key.mjs new new-key.json`.
2. Publish both public keys for an hour: set `HELM_JWKS` to a data URI whose `keys` array holds
   the old and the new key, and deploy (`auth.config.ts` is read at deploy time).
3. Pipe the new private key into `HELM_JWT_PRIVATE_JWK`; new tokens are signed with it.
4. After an hour (the token lifetime), set `HELM_JWKS` to the new key only and deploy again.

Paired devices keep working through a rotation: their device tokens do not depend on the key.
