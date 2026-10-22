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
- The `hlm` CLI (`cli/`): `cd cli && npm ci --ignore-scripts && npm test` (the backend's
  dependencies must be installed too). A command is an entry in the registry
  (`cli/src/registry/`); after changing one, run `npm run build && npm run docs` to regenerate
  `docs/cli.md`. A change to `--json` output must keep its schema in `docs/schemas/` passing:
  fields may be added, never removed or retyped.
- New operations go into the domain layer first; the app layer (`convex/app.ts`) and the MCP
  tools (`convex/mcp.ts`) only establish identity and must stay thin.

## Secrets

Never commit keys, tokens or `.env` files. `.env.example` lists the variable names only.
Install dependencies from the lockfile with install scripts disabled (`npm ci --ignore-scripts`).
