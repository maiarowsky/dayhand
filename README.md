# Helm

Helm is a personal task manager and day plan. Its main screen is **Today**: overdue
tasks on top, then today's tasks, then what is already done. A three-column board,
labels, repeating tasks, links and a 30-day trash complete it.

The app and an AI agent are two clients of the same operations: the agent connects over
[MCP](https://modelcontextprotocol.io) with a personal, revocable API key and can do
everything the user can. Every change is recorded with who made it (`app` or `agent`).

Status: the backend (Convex), the MCP endpoint, a small CLI, phone pairing and the first
Android version (the Today screen with quick add, working offline) are in place; iOS comes later.

```
backend/   Convex backend: data model, domain operations, MCP endpoint, CLI (helm)
android/   Android app (Kotlin, Compose): Today, quick add, offline outbox; see android/README.md
ios/       iOS app (Swift), later
docs/      Architecture, MCP, phone pairing and deployment notes
```

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
cd backend
npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli"}'
export HELM_URL=http://127.0.0.1:3211
export HELM_API_KEY=<the key>
npx helm add "Review the plan" --time 09:00
npx helm today
npx helm pair                  # one-time code that signs the phone app in as the same user
```

The user id `https://helm.local|me` is the app user of the local backend (issuer
`https://helm.local`), so the CLI, the agent and a paired phone share one task list. See
[docs/pairing.md](docs/pairing.md) for the pairing protocol.

Connect an MCP client to `http://127.0.0.1:3211/mcp` with the header
`Authorization: Bearer <the key>`. See [docs/mcp.md](docs/mcp.md) for the tools.

Run the tests (they start their own throwaway backend):

```sh
cd backend
npm test
```

## Deploy your own copy

Helm has no hosted service and the repository holds no secrets. Deploy the `backend/`
folder to your own Convex project (`npx convex deploy`) or to a self-hosted Convex backend,
and set `HELM_JWT_ISSUER`, `HELM_JWKS` and `HELM_JWT_PRIVATE_JWK` in its environment (see
[docs/deploy.md](docs/deploy.md)).

## License

[Apache License 2.0](LICENSE). Contributions are accepted under the
[Developer Certificate of Origin](CONTRIBUTING.md).
