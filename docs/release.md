# Releasing hlm

The `hlm` CLI (`cli/`) is versioned on its own: its version is `cli/package.json`, its tags are
`hlm-vX.Y.Z` and its changelog is `cli/CHANGELOG.md`. The backend and the apps keep their own
versions; `hlm version` checks the server's `serverInfo.version` against
`MIN_SERVER_VERSION` in `cli/src/core/version.ts` (same major, not older than the minimum).

Everything needed to publish is in the repository, and **nothing publishes yet**:

| File | What it does | Off until |
|---|---|---|
| `.github/workflows/release-please.yml` | keeps a release PR for `cli/` (version bump, changelog); merging it tags `hlm-vX.Y.Z` | repository variable `HLM_RELEASE_ENABLED=true` |
| `release-please-config.json`, `.release-please-manifest.json` | release-please setup: only `cli/`, component `hlm`, also bumps the Homebrew formula | |
| `.github/workflows/publish-npm.yml` | on a `hlm-v*` tag: tests, then `npm publish --provenance` with trusted publishing (OIDC, no token) | variable `HLM_PUBLISH_ENABLED=true`, the `npm` environment, and `cli/scripts/check-release.mjs` |
| `packaging/homebrew/hlm.rb` | formula template for a tap | copied into the tap by hand |
| `cli/package.json` | `"private": true`, name `hlm` | the captain's word |

`check-release.mjs` stops the publish job while the package is private, when the tag does not
match the version, when `repository.url` is missing, or when npm is older than 11.5.1.

## Before the first release (on the captain's word)

Each step changes something outside this repository or makes it public, so each needs the
captain's explicit go-ahead.

1. **Choose the npm name.** Unscoped `hlm` only if it is free (`npm view hlm` answers 404).
   Otherwise a scope you own, e.g. `@<user>/hlm`; the command stays `hlm` either way (the
   `bin` field). In `cli/package.json`: set `"name"`, delete `"private": true`, and add
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<owner>/helm.git", "directory": "cli" },
   "homepage": "https://github.com/<owner>/helm/tree/main/cli#readme",
   "bugs": "https://github.com/<owner>/helm/issues"
   ```
   Provenance is verified against `repository.url`, so it must be the public repository.
   Also set `"package-name"` in `release-please-config.json` to the same name.
2. **Make the repository public** on GitHub (`<owner>/helm`). Provenance and trusted publishing
   need a public repository. Before that: check that no secret was ever committed
   (`gitleaks detect` over the whole history), and replace `<owner>` in
   `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/config.yml` and `packaging/homebrew/hlm.rb`.
3. **Turn on the repository settings:** Settings → Security → *Private vulnerability
   reporting* (SECURITY.md relies on it); install the [DCO app](https://github.com/apps/dco)
   (it reads `.github/dco.yml`); protect `main` with the DCO check and the tests required.
4. **Create the `npm` environment** (Settings → Environments → New environment `npm`), with
   *Required reviewers* = the captain and *Deployment branches and tags* = tags `hlm-v*`.
   Every publish then waits for an approval.
5. **Publish the first version by hand, once.** npm can attach a trusted publisher only to a
   package that exists. On a trusted machine, with 2FA: `cd cli && npm ci --ignore-scripts &&
   npm test && npm publish --access public` (no provenance for this one).
6. **Add the trusted publisher on npmjs.com:** package → Settings → *Trusted publishing* →
   GitHub Actions: organization or user `<owner>`, repository `helm`, workflow
   `publish-npm.yml`, environment `npm`. Then, in the same settings, choose *Require two-factor
   authentication and disallow tokens*, so only the workflow can publish.
7. **Set the repository variables** (Settings → Secrets and variables → Actions → Variables):
   `HLM_RELEASE_ENABLED=true` and `HLM_PUBLISH_ENABLED=true`. Optional secret
   `RELEASE_PLEASE_TOKEN` (a fine-grained token with contents and pull requests write on this
   repository only): with it the tag from release-please starts `publish-npm.yml` by itself;
   without it, start that workflow by hand on the tag (Actions → Publish hlm to npm → Run
   workflow → the tag).
8. **Create the tap** `<owner>/homebrew-hlm` (public), with `Formula/hlm.rb` copied from
   `packaging/homebrew/hlm.rb`. Then `brew install <owner>/hlm/hlm` works.

## Every release

1. Merge work into `main` with Conventional Commit messages (`feat:` → minor, `fix:` → patch;
   before 1.0.0 a breaking change bumps the minor version).
2. release-please keeps a PR “chore(main): release hlm X.Y.Z” up to date. Review its changelog,
   check that `npm run build && npm run docs` in `cli/` leaves no changes, and merge it.
3. The tag `hlm-vX.Y.Z` starts `publish-npm.yml` (or start it by hand on the tag), and the
   `npm` environment waits for approval. The job checks the package, runs the tests and
   publishes with provenance. Check it: `npm view <name>@X.Y.Z` and the provenance badge on
   npmjs.com.
4. Update the tap: download the tarball and take its checksum,
   ```sh
   curl -sLO https://registry.npmjs.org/<name>/-/hlm-X.Y.Z.tgz    # scoped: .../@<scope>/hlm/-/hlm-X.Y.Z.tgz
   shasum -a 256 hlm-X.Y.Z.tgz
   ```
   then copy `packaging/homebrew/hlm.rb` (release-please has already set the version) into the
   tap with that `sha256`, run `brew audit --strict --online hlm` and `brew test hlm` in the
   tap, and push.

## A JSON contract change

`--json` is a contract (docs/cli.md#json-output). Adding a field is a minor release. Removing
or retyping one, or changing an exit code, is a breaking change: a major version (or a minor
one before 1.0.0) with a `BREAKING CHANGE:` footer, and the schemas in `docs/schemas/` change
in the same PR.

## Rolling back

npm does not allow publishing the same version twice. Unpublishing is possible only within 72
hours and only without dependents; prefer `npm deprecate <name>@X.Y.Z "<why>"` and publish a
fixed X.Y.Z+1. In the tap, revert the formula commit. To stop all releases at once, set
`HLM_PUBLISH_ENABLED` to `false`.

## Check a package locally (nothing is published)

```sh
cd cli
npm ci --ignore-scripts
npm pack                         # runs prepack: build, copies man/hlm.1 and LICENSE into the package
mkdir -p /tmp/hlm-try && cd /tmp/hlm-try
npm init -y >/dev/null && npm install --ignore-scripts <path to>/hlm-X.Y.Z.tgz
npx hlm --version && npx hlm help && npx hlm completion bash | head
```
