# hlm

`hlm` is the Helm command line client. Every command is one or more calls of the MCP tools the
agent uses (`/mcp`), so the terminal, the app and an agent share one set of operations, and
`hlm call <tool> '<json>'` reaches any tool directly. `hlm key`, `hlm webhook` and `hlm import`
use the REST API instead (`/api/v1`, backend 0.8.0, [docs/api.md](../docs/api.md)): keys that
only read or write and expire, for other tools; signed webhooks; importing Helm JSON,
iCalendar or Todoist CSV. It replaces the old `helm` command (`backend/cli/helm.mjs`).

Requires Node.js 22.12 or newer; runs on macOS, Linux and Windows.

```sh
npm ci --ignore-scripts
npm run build                   # then `npm link` once to get `hlm` on the PATH
hlm login --url https://<deployment>.convex.site    # locally: http://127.0.0.1:3211
hlm                             # Today
hlm add Call the accountant --due "fri 2pm" -l home
hlm list --due-before eow --search accountant
hlm ui                          # full screen: Today, board, week, trash (? lists the keys)
source <(hlm completion bash)   # or zsh, fish, powershell: hlm help completion
```

`hlm login` checks the API key (kind `cli`, created in the app) and keeps it in the OS keychain
(macOS Keychain, Windows Credential Manager, Secret Service on Linux), or in a private
`credentials.json` when there is none; the key never goes into a shell profile or config.toml.
`config.toml` holds the URL, profiles, aliases and the color default (`hlm help config`).
Dates are English phrases resolved in your time zone (`hlm help dates`, `hlm when "next mon"`).

`hlm ui` is the same client full screen, written with [Ink](https://github.com/vadimdemedes/ink)
(React for the terminal; Ink and React load only for this command). It shows Today, the board,
the week and the trash, polls what is on screen every 12 s (`--interval`) within the key's
limits, keeps the last data with a red status line when the server cannot be reached, and
shows who made each change in a task's history. Keys follow vim and lazygit; `hlm help ui`
lists them, and [docs/omarchy.md](../docs/omarchy.md) turns it into an Omarchy app.

For agents and scripts: `HLM_URL` and `HLM_API_KEY` win over the file and the keychain,
`--json` prints exactly the tool's `structuredContent` (schemas in
[docs/schemas](../docs/schemas)), errors are one JSON line on stderr, exit codes are distinct
(2 usage, 3 key, 4 not found, 5 server unavailable or rate limited: retry with the same
`--client-id`), `--dry-run` shows a change checked by the backend without saving it, and `hlm`
never prompts without a terminal.
Give each agent its own key of kind `agent`; history then shows its changes as `agent: <key name>`.
`hlm prime` prints Today and these rules as plain text for an agent's session-start hook, and
[docs/skills/hlm/SKILL.md](../docs/skills/hlm/SKILL.md) is the same guidance as an Agent Skill.

The full reference is generated from the command registry: [docs/cli.md](../docs/cli.md),
the man page [man/hlm.1](../man/hlm.1) (in the package, so `man hlm` works after a global
install) and the agent skill. Releases: [docs/release.md](../docs/release.md).

## Layout

```
src/bin/hlm.ts        entry point
src/main.ts           commander program built from the registry; aliases; hlm help
src/run.ts            runs one command: context, output format, exit codes, --dry-run
src/registry/         the commands (single source for help, completion, docs/cli.md and tests)
src/transport/        MCP JSON-RPC, /devices and /api/v1 over HTTP
src/config/           environment, folders per system, config.toml, profiles, aliases
src/credentials/      API key: environment, OS keychain (@napi-rs/keyring), 0600 file
src/when/             English date phrases and calendar arithmetic in a time zone
src/render/           human (tables, colors, relative days) and plain (TSV) output
src/ui/               hlm ui: controller (polling, changes, mouse), key reducer, screens as rows, Ink app
src/completion/       hlm __complete and the bash, zsh, fish and PowerShell scripts
src/docs.ts, man.ts, skill.ts   docs/cli.md, man/hlm.1 and the agent skill, rendered from the registry
scripts/              gen-docs (npm run docs), pack-files (prepack), check-release (publish workflow)
tests/                unit tests (*.unit.test.ts) and tests against a real local Convex backend
```

## Tests

```sh
(cd ../backend && npm ci --ignore-scripts)   # the tests start the backend with its scripts
npm test                                      # builds, then runs everything
npm run test:unit                             # pure tests only (dates, config, output, completion)
npm run build && npm run docs                 # regenerate docs/cli.md, man/hlm.1 and SKILL.md
npm pack                                      # a local tarball with dist/, the man page and LICENSE (not published)
```

The tests never touch the real keychain or config folder: every run gets its own
`HLM_CONFIG_DIR` and keys go to a file. `tests/tty.test.ts` drives prompts and `$EDITOR` on a
real pseudo-terminal with node-pty, which ships prebuilt binaries for macOS and Windows only;
on Linux without a build toolchain those tests are skipped. `tests/ui.test.ts` drives `hlm ui`
the same way and reads the screen through a headless xterm (`tests/screen.ts`);
`HLM_UI_SCREENS=<dir>` saves the screens it checks as text. `tests/shells.test.ts` runs the
completion scripts in whichever of bash, zsh, PowerShell and fish are installed.
