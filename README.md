# Helm

Helm is a personal task manager and day plan. Its main screen is **Today**: overdue
tasks on top, then today's tasks, then what is already done. A three-column board,
labels, repeating tasks (also RFC 5545 RRULE), checklists, per-task reminders, links and a
30-day trash complete it.

The app and an AI agent are two clients of the same operations: the agent connects over
[MCP](https://modelcontextprotocol.io) with a personal, revocable API key and can do
everything the user can. The Claude apps connect as a custom connector instead: they sign in
with OAuth, and the owner approves each connection on the paired phone and can disconnect it
there ([docs/oauth.md](docs/oauth.md)). Every change is recorded with who made it (`app`,
`cli` or `agent: <name>`).

Status: the backend (Convex), the MCP endpoint, the `hlm` CLI, phone pairing and the Android
app (Today with quick add, the board, task details and the trash, reminders and Settings, all
working offline) are in place; iOS comes later.

```
backend/   Convex backend: data model, domain operations, MCP endpoint, old CLI (helm)
cli/       hlm, the command line client for people and agents; see cli/README.md
android/   Android app (Kotlin, Compose): Today, board, task details, reminders, settings, offline outbox; see android/README.md
ios/       iOS app (Swift), later
docs/      Architecture, MCP, OAuth for the Claude apps, phone pairing, deployment and release notes
man/       hlm(1), generated from the CLI's command registry
packaging/ Homebrew formula template
```

## The `hlm` command line

`hlm` needs Node.js 22.12 or newer and runs on macOS, Linux and Windows. It is not on npm or
Homebrew yet (see [docs/release.md](docs/release.md)); install it from this repository:

```sh
cd cli
npm ci --ignore-scripts && npm run build
npm link                       # puts hlm on the PATH (npm unlink -g hlm removes it)
```

Once it is published: `npm install -g <package>` or `brew install <owner>/hlm/hlm`.

Quick start:

```sh
hlm login --url https://<deployment>.convex.site   # paste an API key (kind cli) made in the app
hlm add Call the accountant --due "fri 2pm" -l home
hlm                                                 # Today: now, overdue, today, done
hlm done 1
hlm pair                                            # QR code: signs the phone app in as you
```

`hlm login` keeps the key in the OS keychain, never in a shell profile. `hlm help dates` lists
the date phrases, `source <(hlm completion bash)` adds Tab completion (also zsh, fish,
PowerShell), and `man hlm` or [docs/cli.md](docs/cli.md) has every command. Without Kubernetes
Helm on your machine, `alias helm=hlm` works too.

For AI agents: give each agent its own key (kind `agent`) in `HLM_API_KEY`, use `--json`
(exact MCP results, [schemas](docs/schemas)), and add `hlm prime` to a session-start hook.
[docs/skills/hlm/SKILL.md](docs/skills/hlm/SKILL.md) is a ready Agent Skill: copy the folder
to `~/.claude/skills/hlm/` (or your agent's skills folder).

## Run the backend locally

Requirements: Node.js 20 or newer, macOS or Linux (arm64 or x64). No Convex account is needed:
the open-source Convex local backend binary runs on your machine.

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
export HLM_URL=http://127.0.0.1:3211
export HLM_API_KEY=<the key>
node dist/bin/hlm.js add "Review the plan" --time 09:00     # or `npm link` once, then: hlm …
node dist/bin/hlm.js                                        # Today
node dist/bin/hlm.js pair    # one-time code that signs the phone app in as the same user
```

`hlm` replaces the old `helm` command (`backend/cli/helm.mjs`, `npx helm` in `backend/`), which
still works with `HELM_URL` and `HELM_API_KEY` until `hlm` has fully taken over. `hlm` reads
those old names too, with a deprecation warning. All commands: [docs/cli.md](docs/cli.md).

The user id `https://helm.local|me` is the app user of the local backend (issuer
`https://helm.local`), so the CLI, the agent and a paired phone share one task list. See
[docs/pairing.md](docs/pairing.md) for the pairing protocol.

Connect an MCP client to `http://127.0.0.1:3211/mcp` with the header
`Authorization: Bearer <the key>`. See [docs/mcp.md](docs/mcp.md) for the tools, resources,
prompts, limits and protocol versions. To add Helm to the Claude app, see
[docs/oauth.md](docs/oauth.md#connecting-the-claude-app-manual-procedure); the Claude apps
reach the server from Anthropic's network, so this needs a public HTTPS deployment.

Run the tests (they start their own throwaway backend):

```sh
cd backend
npm test
cd ../cli
npm test        # needs backend/node_modules; tests hlm against a throwaway backend
```

## Deploy your own copy

The repository holds no secrets. The Android app connects by default to the author's own
deployment, which lets a phone in only with a pairing code from that account's owner. Deploy
the `backend/` folder to your own Convex project (`npx convex deploy`) or to a self-hosted
Convex backend, and set `HELM_JWT_ISSUER`, `HELM_JWKS` and `HELM_JWT_PRIVATE_JWK` in its
environment (see [docs/deploy.md](docs/deploy.md)). Type your server's address on the
Connect screen, or build the app with `-Phelm.serverUrl=https://<deployment>.convex.site` to
make it the default ([android/README.md](android/README.md)).

## License

[Apache License 2.0](LICENSE). Contributions are accepted under the
[Developer Certificate of Origin](CONTRIBUTING.md).
