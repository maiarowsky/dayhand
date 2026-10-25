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
  changing a command, run `npm run build && npm run docs` in `cli/` and commit the regenerated files;
  a test fails while they are stale. The [published documentation](#the-site-and-the-documentation)
  is built from them when the site is built.
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

## The site and the documentation

`site/` is dayhand.dev: an Astro project that builds the landing page and the documentation into a
static site in `site/dist/`, with nothing loaded from other servers. The documentation pages are the
Markdown in `docs/`, rendered at build time, so nothing generated is committed. How it is built, the
screenshots and the CSS rules it follows: [site/STYLE.md](site/STYLE.md); how to write the docs:
[docs/contributing.md](docs/contributing.md).

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

### The Dayhand Cloud waitlist

The waitlist form on the home page posts to `POST /api/waitlist`, the only path the site's Worker script
(`site/worker/`) answers; everything else is served from `dist/` without running it. Addresses go to
their own D1 database, `dayhand-waitlist`, and nowhere else: no other list or CRM. The Worker trims and
lowercases each address, checks it, stores it once with the date and the page it came from, and turns
away a filled-in hidden field (answered as if accepted, stored nowhere), a form sent less than two
seconds after the page opened, another site's origin, and more than five tries from one client address
in ten minutes (counted in `waitlist_rate` under a SHA-256 hash of the address).

Before the first deploy with the waitlist, set up mail for `hello@dayhand.dev`, the address the form gives
for removal: in the Cloudflare dashboard, Email Routing for dayhand.dev, add a custom address
`hello@dayhand.dev` that forwards to the owner's mailbox. Cloudflare sends a confirmation email to that
mailbox, and the owner must confirm it before anything is forwarded.

Then create the database once and apply its migration (`site/migrations/`):

```sh
cd site
wrangler d1 create dayhand-waitlist   # prints the database_id
```

Add that id under `[[d1_databases]]` in `site/wrangler.toml` as `database_id = "<id>"` (an id, not a
secret), then:

```sh
wrangler d1 migrations apply dayhand-waitlist --remote
npm run build && wrangler deploy
```

Read the list:

```sh
wrangler d1 execute dayhand-waitlist --remote --command "SELECT email, created_at, source FROM waitlist ORDER BY created_at"
```

Remove one address on request with
`wrangler d1 execute dayhand-waitlist --remote --command "DELETE FROM waitlist WHERE email = 'name@example.com'"`
(lowercase, as stored). The form promises one email when Dayhand Cloud opens and then deleting the
list: `DELETE FROM waitlist` after that email.

To try the form and the endpoint locally, with a local D1 database and no Cloudflare account:

```sh
cd site
npm run build
wrangler d1 migrations apply dayhand-waitlist --local
wrangler dev --local                                  # http://localhost:8787
node scripts/check-waitlist.mjs http://localhost:8787   # in a second terminal
```

A Wrangler whose runtime is older than `compatibility_date` refuses to start; pass
`--compatibility-date <its newest date>` to `wrangler dev` for a local run, or update Wrangler.

## Secrets

Never commit keys, tokens or `.env` files. `.env.example` lists the variable names only.
Install dependencies from the lockfile with install scripts disabled (`npm ci --ignore-scripts`).
