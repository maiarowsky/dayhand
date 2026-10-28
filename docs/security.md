# Security and privacy

Dayhand has no hosted service yet and no accounts of its own. Your plan lives on your devices and on a
server you run, and nothing in Dayhand sends it anywhere else. This page says what is stored where, which
secrets exist and how they are protected, what the agent controls can and cannot do, and how to report a
problem. The detailed threat models are linked at the end.

## Where your plan is

| Place | What it holds | Who can read it |
|---|---|---|
| Your server (a Convex deployment) | the whole plan, its history, settings, hashes of keys and tokens, webhook secrets, the calendar address | you, and anyone with admin access to that deployment: your Convex account, or your computer for the local server |
| The Android app | its copy of the plan and the waiting changes; the sign-in, encrypted with a key in the Android Keystore | the phone; Android's cloud backup and device transfer are off for Dayhand |
| Dayhand for macOS | its copy of the plan in `~/Library/Application Support/Dayhand`; the sign-in in the login Keychain | your Mac user |
| Dayhand for Linux | its copy in `~/.local/share/dayhand`; the sign-in in the Secret Service keyring | your Linux user |
| `dayhand` and `dayhand ui` | no offline plan or outbox; shell completion caches task numbers, titles and project names; the key is in the system keychain, or a file only you can read | your user on that computer |
| Backups and exports | whatever you export: `dayhand export`, the phone's backup file, `npx convex export` | wherever you keep them |

Shell completion writes `tasks-<hash>.json` in the CLI cache folder: `~/.cache/dayhand` (or
`$XDG_CACHE_HOME/dayhand`) on Linux, `~/Library/Caches/dayhand` on macOS, or
`%LOCALAPPDATA%\dayhand\Cache` on Windows; `DAYHAND_CACHE_DIR` overrides it. The folder is created
with mode 700 and files with mode 600 where POSIX permissions apply. The 60-second lifetime controls
freshness, not deletion: cached titles and project names remain on disk until you remove the cache files.

The local server (`dayhand server start`) keeps its data and keys in a private folder (mode 700, files
600) and listens on `127.0.0.1` only. A server on your Convex account runs on Convex's infrastructure, in
your account; Convex can technically reach it, as any host can reach what it hosts.

## No tracking

- The Android app has no analytics, no crash reporting and no other outside services. It talks only to
  your server.
- Dayhand for macOS and Linux talk only to your server. A macOS build made with the release key also
  checks the update feed (Sparkle), with Sparkle's system profile off; builds you make yourself never do.
- `dayhand` talks only to the server you signed it in to. `dayhand server start` downloads the Convex
  local backend from Convex's GitHub releases once, at a pinned version whose checksum it checks.
- This website sets no cookies and loads nothing from other servers.

## Secrets and how they are kept

| Secret | Made by | Kept as | Ends |
|---|---|---|---|
| API key (`dayhand_…`) | `dayhand server start` or `deploy`, `dayhand key create`, the deployment admin | shown once; the server stores only its SHA-256 | when revoked or at its expiry; keys made with a key stop with it |
| Pairing code | `dayhand pair` | 12 characters, the secret part stored as SHA-256 | after one use, 10 minutes, or 5 wrong tries |
| Device token (a paired phone or computer) | `POST /auth/pair` | on the device, encrypted (Keystore, Keychain, Secret Service); SHA-256 on the server | when the device is revoked (`dayhand revoke`) |
| App token (JWT) | the server, from a device token | in memory on the device | after one hour |
| OAuth tokens (the Claude apps) | `/oauth/token`, after you approve on the phone | SHA-256 on the server | access one hour; refresh 60 days, rotated on every use; at once when the connection is revoked |
| App-signing key | `dayhand server start` or `deploy` | in the deployment's environment; a copy in the server folder | when you rotate it ([rotating](deploy.md#rotating-the-signing-key)) |
| Calendar address | turning the feed on | the secret part on the server, so it can be shown again | when you make a new address or turn the feed off |
| Webhook secret (`whsec_…`) | `dayhand webhook add` | on the server as it is, since every message is signed with it | when the webhook is removed |

Keys and tokens are long random values compared in constant time; error answers never say whether a code
or token existed, expired or was revoked. A key never goes into `config.toml`: `dayhand login` keeps it in
the macOS Keychain, the Windows Credential Manager or the Secret Service, or in a file readable only by you
when there is none. The keychain keeps the key out of dotfiles and shell history; it does not hide it from
programs running as you.

## Who may do what

- **Scopes.** An API key reads (`read`), also changes tasks and settings (`write`), or also manages keys,
  webhooks, devices, connections and the calendar feed (`full`). A key made with another key is `read` or
  `write` and never outlives its parent.
- **Owner tools.** Deciding approval requests, pausing agents, tool policies and accepting, merging or
  rejecting proposals are for you only: the apps and `cli` keys. Agents do not see these tools and are
  refused when they call them.
- **Agent controls** are checked inside the same transaction as the change, for MCP and the REST API alike,
  so there is no way around them through another surface ([agents](agents.md)).
- **Limits.** Each key and each OAuth connection may make 120 reads and 60 changes a minute.
- **What Dayhand cannot do**: stop an agent from acting outside Dayhand. An approval is a record the agent
  is expected to respect; enforce it in the agent's own tooling as well.

## The server's doors

- `/mcp` refuses requests from a browser page (an `Origin` header) unless you allow that origin, and
  answers a missing or wrong credential with `401`.
- The REST API has no CORS: other websites cannot call it from a browser, and OAuth tokens do not work
  there.
- Webhooks are sent only to public HTTPS addresses: local, private, link-local and reserved addresses are
  refused when the webhook is added and again before each delivery, and redirects are not followed
  ([webhooks](webhooks.md#security)).
- OAuth sign-ins return only to the Claude apps' documented addresses, with PKCE, and every connection is
  approved on your phone ([OAuth threat model](oauth-threat-model.md)).

## Good habits

- Give every agent and integration its own key, with the smallest scope and an expiry. Revoke it when it is
  no longer used (`dayhand key list`, `dayhand key revoke`).
- Only the owner's key (`cli`) or the app can pair a phone, never an `agent` key; the phone keeps working
  after the key is revoked: when a `cli` key may have leaked, revoke it and also check `dayhand devices`.
- Lost a phone or a laptop: `dayhand revoke <deviceId>`. Its app token still works for up to an hour.
- Treat the calendar address like a password. If it was shared, make a new one (`dayhand calendar rotate`).
- Keep the copy of the app-signing key in a password manager, or delete it; the deployment holds the one in
  use. Keep backups and exports out of shared folders: they contain your plan.
- Keep the backend up to date: `git pull` and `dayhand server deploy` (or `start`) again
  ([updating](deploy.md#updating)).

## Reporting a problem

Report security problems **privately**, never in a public issue, pull request or discussion.
See [SECURITY.md](../SECURITY.md#reporting-a-vulnerability) for reporting steps, what to include
and response times.

## Threat models and details

- [OAuth threat model](oauth-threat-model.md): the Claude apps' sign-in, with each threat, its control and
  its test.
- [Calendar feed](calendar.md#threat-model): the secret calendar address.
- [Phone pairing](pairing.md#security-notes): codes, device tokens and app tokens.
- [Architecture](architecture.md#authentication): how each kind of client proves who it is.
