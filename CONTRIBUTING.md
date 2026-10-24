# Contributing to Dayhand

Thank you for helping. Dayhand is licensed under the [Apache License 2.0](LICENSE).

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
- The `dayhand` CLI: see the next section.
- New operations go into the domain layer first; the app layer (`convex/app.ts`) and the MCP
  tools (`convex/mcp.ts`) only establish identity and must stay thin.

## The `dayhand` CLI

```sh
(cd backend && npm ci --ignore-scripts)   # the CLI tests start the backend with its scripts
cd cli
npm ci --ignore-scripts
npm test                                  # builds, then runs everything against a local backend
npm run test:unit                         # pure tests only, under a second
```

- A command is an entry in the registry (`cli/src/registry/`): help, completion,
  `docs/cli.md`, `man/dayhand.1` and `docs/skills/dayhand/SKILL.md` are all generated from it. After
  changing a command, run `npm run build && npm run docs` in `cli/`, then rebuild the
  [published documentation](#the-site-and-the-documentation) and commit the regenerated files;
  checks fail while they are stale.
- **`--json` is a contract for agents and scripts.** A change to what a command prints with
  `--json`, to its error JSON or to an exit code needs the contract tests in the same PR:
  `cli/tests/contract.test.ts` (output equals the MCP tool's `structuredContent` and passes its
  schema) and `cli/tests/exit-codes.test.ts`, plus the schema in `docs/schemas/`. Fields may be
  added; removing or retyping a field, or changing an exit code, is a breaking change
  (`BREAKING CHANGE:` footer, see [docs/release.md](docs/release.md)).
- The tests never touch your keychain or config folder: every run gets its own
  `DAYHAND_CONFIG_DIR` and keys go to a file.
- The CLI is released on its own (`dayhand-vX.Y.Z` tags, release-please); do not bump
  `cli/package.json` by hand in a feature PR.

## The website

`site/` is dayhand.dev: an Astro project that builds a static site into `site/dist/`, with nothing
loaded from other servers. How it is built, the screenshots and the CSS rules it follows:
[site/STYLE.md](site/STYLE.md).

```sh
(cd site && npm ci --ignore-scripts && npm run dev)   # http://localhost:4321
scripts/check-site.sh --build   # build site/, then check dist/: HTML, metadata, links, weight (needs python3)
scripts/render-site-images.sh   # after changing og-image.svg or the icon (needs Chrome)
```

Write only what is true today: a package or a download without a published release is "Coming soon",
with no command or link for it. Screenshots show made-up demo data only.

Maintainers deploy after a merge to `main`, from `site/`, with Wrangler logged in to the account that
owns dayhand.dev:

```sh
npm run build && wrangler deploy
```

`site/wrangler.toml` holds no account id and no secrets; the account comes from `wrangler login`.

## Secrets

Never commit keys, tokens or `.env` files. `.env.example` lists the variable names only.
Install dependencies from the lockfile with install scripts disabled (`npm ci --ignore-scripts`).
