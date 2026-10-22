# Contributing to Helm

Thank you for helping. Helm is licensed under the [Apache License 2.0](LICENSE).

## Developer Certificate of Origin (DCO)

Every commit must be signed off. By adding a `Signed-off-by` line you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that you wrote
the change or otherwise have the right to submit it under the project's open source license.

```sh
git commit -s -m "fix: keep the now task when renaming"
```

This adds a line such as `Signed-off-by: Your Name <you@example.com>` that must match the
commit author. Commits without it cannot be merged. To sign off the last commit afterwards:
`git commit --amend -s --no-edit`.

## Commit messages

Use `<type>: <description>` with an optional body. Types: `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`, `perf`, `ci`.

## Testing

Backend tests run against a real Convex local backend that the test suite starts and
removes by itself (the binary is downloaded once into `backend/.local-backend/`, pinned and
checksum-verified).

```sh
cd backend
npm ci --ignore-scripts
npm run typecheck
npm test
```

What a change needs:

- Domain behaviour (`backend/convex/lib/`): a test in `backend/tests/` that calls the
  operation on the local backend, or a pure unit test for date and repeat logic.
- MCP tools: a test through the official `@modelcontextprotocol/sdk` client.
- The `hlm` CLI: see the next section.
- New operations go into the domain layer first; the app layer (`convex/app.ts`) and the MCP
  tools (`convex/mcp.ts`) only establish identity and must stay thin.

## The `hlm` CLI

```sh
(cd backend && npm ci --ignore-scripts)   # the CLI tests start the backend with its scripts
cd cli
npm ci --ignore-scripts
npm test                                  # builds, then runs everything against a local backend
npm run test:unit                         # pure tests only, under a second
```

- A command is an entry in the registry (`cli/src/registry/`): help, completion,
  `docs/cli.md`, `man/hlm.1` and `docs/skills/hlm/SKILL.md` are all generated from it. After
  changing a command, run `npm run build && npm run docs` and commit the regenerated files; a
  test fails while they are stale.
- **`--json` is a contract for agents and scripts.** A change to what a command prints with
  `--json`, to its error JSON or to an exit code needs the contract tests in the same PR:
  `cli/tests/contract.test.ts` (output equals the MCP tool's `structuredContent` and passes its
  schema) and `cli/tests/exit-codes.test.ts`, plus the schema in `docs/schemas/`. Fields may be
  added; removing or retyping a field, or changing an exit code, is a breaking change
  (`BREAKING CHANGE:` footer, see [docs/release.md](docs/release.md)).
- The tests never touch your keychain or config folder: every run gets its own
  `HLM_CONFIG_DIR` and keys go to a file.
- The CLI is released on its own (`hlm-vX.Y.Z` tags, release-please); do not bump
  `cli/package.json` by hand in a feature PR.

## Secrets

Never commit keys, tokens or `.env` files. `.env.example` lists the variable names only.
Install dependencies from the lockfile with install scripts disabled (`npm ci --ignore-scripts`).
