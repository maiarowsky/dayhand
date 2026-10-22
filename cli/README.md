# hlm

`hlm` is the Helm command line client. Every command is one or more calls of the MCP tools the
agent uses (`/mcp`), so the terminal, the app and an agent share one set of operations, and
`hlm call <tool> '<json>'` reaches any tool directly. It replaces the old `helm` command
(`backend/cli/helm.mjs`).

Requires Node.js 22.12 or newer; runs on macOS, Linux and Windows.

```sh
npm ci --ignore-scripts
npm run build
export HLM_URL=https://<deployment>.convex.site     # locally: http://127.0.0.1:3211
export HLM_API_KEY=<API key with kind "cli">
node dist/bin/hlm.js            # Today; `npm link` once to get `hlm` on the PATH
```

Without a command, `hlm` shows Today. For agents and scripts: `--json` prints exactly the
tool's `structuredContent` (schemas in [docs/schemas](../docs/schemas)), errors are one JSON
line on stderr, exit codes are distinct (2 usage, 3 key, 4 not found, 5 server unavailable:
retry with the same `--client-id`), and `hlm` never prompts without a terminal. Give each agent
its own key of kind `agent`; history then shows its changes as `agent: <key name>`.

The full reference is generated from the command registry: [docs/cli.md](../docs/cli.md).

## Layout

```
src/bin/hlm.ts        entry point
src/main.ts           commander program built from the registry; output and exit codes
src/registry/         the commands (single source for help, docs/cli.md and tests)
src/transport/        MCP JSON-RPC and /devices over HTTP
src/config/           HLM_* environment (a config file comes in batch 2)
src/credentials/      where the API key comes from (environment; the OS keychain comes in batch 2)
src/render/           human and plain (TSV) output
tests/                contract and exit-code tests against a real local Convex backend
```

## Tests

```sh
(cd ../backend && npm ci --ignore-scripts)   # the tests start the backend with its scripts
npm test                                      # builds, then runs vitest
npm run build && npm run docs                 # regenerate docs/cli.md after changing a command
```
