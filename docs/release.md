# Releasing dayhand

The `dayhand` CLI (`cli/`) is versioned on its own: its version is `cli/package.json`, its tags are
`dayhand-vX.Y.Z` and its changelog is `cli/CHANGELOG.md`. The backend and the apps keep their own
versions; `dayhand version` checks the server's `serverInfo.version` against
`MIN_SERVER_VERSION` in `cli/src/core/version.ts` (same major, not older than the minimum).

Everything needed to publish is in the repository, and **nothing publishes yet**:

| File | What it does | Off until |
|---|---|---|
| `.github/workflows/release-please.yml` | keeps a release PR for `cli/` (version bump, changelog); merging it tags `dayhand-vX.Y.Z` | repository variable `DAYHAND_RELEASE_ENABLED=true` |
| `release-please-config.json`, `.release-please-manifest.json` | release-please setup: only `cli/`, component `dayhand`, also bumps the Homebrew formula | |
| `.github/workflows/publish-npm.yml` | on a `dayhand-v*` tag: tests, then `npm publish --provenance` with trusted publishing (OIDC, no token) | variable `DAYHAND_PUBLISH_ENABLED=true`, the `npm` environment, and `cli/scripts/check-release.mjs` |
| `packaging/homebrew/dayhand.rb` | formula template for a tap | copied into the tap by hand |
| `cli/package.json` | `"private": true`, name `dayhand` | the maintainer's word |

`check-release.mjs` stops the publish job while the package is private, when the tag does not
match the version, when `repository.url` is missing, or when npm is older than 11.5.1.

## Before the first release (on the maintainer's word)

Each step changes something outside this repository or makes it public, so each needs the
maintainer's explicit go-ahead.

1. **Choose the npm name.** Unscoped `dayhand` only if it is free (`npm view dayhand` answers 404;
   it did on 2026-10-24). Otherwise a scope you own, e.g. `@<user>/dayhand`; the commands stay
   `dayhand` and `dh` either way (the `bin` field, which also keeps `hlm` until 1.0). In `cli/package.json`: set `"name"`, delete `"private": true`, and add
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
   `packaging/homebrew/dayhand.rb` (`.github/CODEOWNERS` and `.github/ISSUE_TEMPLATE/config.yml`
   already name `maiarowsky`).
3. **Turn on the repository settings:** Settings → Security → *Private vulnerability
   reporting* (SECURITY.md relies on it); install the [DCO app](https://github.com/apps/dco)
   (it reads `.github/dco.yml`); protect `main` with the DCO check and the tests required.
4. **Create the `npm` environment** (Settings → Environments → New environment `npm`), with
   *Required reviewers* = the maintainer and *Deployment branches and tags* = tags `dayhand-v*`.
   Every publish then waits for an approval.
5. **Publish the first version by hand, once.** npm can attach a trusted publisher only to a
   package that exists. On a trusted machine, with 2FA: `cd cli && npm ci --ignore-scripts &&
   npm test && npm publish --access public` (no provenance for this one).
6. **Add the trusted publisher on npmjs.com:** package → Settings → *Trusted publishing* →
   GitHub Actions: organization or user `<owner>`, repository `helm`, workflow
   `publish-npm.yml`, environment `npm`. Then, in the same settings, choose *Require two-factor
   authentication and disallow tokens*, so only the workflow can publish.
7. **Set the repository variables** (Settings → Secrets and variables → Actions → Variables):
   `DAYHAND_RELEASE_ENABLED=true` and `DAYHAND_PUBLISH_ENABLED=true` (the `HLM_*` names from
   before the rename are not read). Optional secret
   `RELEASE_PLEASE_TOKEN` (a fine-grained token with contents and pull requests write on this
   repository only): with it the tag from release-please starts `publish-npm.yml` by itself;
   without it, start that workflow by hand on the tag (Actions → Publish dayhand to npm → Run
   workflow → the tag).
8. **Create the tap** `<owner>/homebrew-dayhand` (public), with `Formula/dayhand.rb` copied from
   `packaging/homebrew/dayhand.rb`. Then `brew install <owner>/dayhand/dayhand` works. The
   formula links `dayhand` and `dh`; on Linux, where debhelper may have its own `dh`, users type
   `dayhand`.

## Every release

1. Merge work into `main` with Conventional Commit messages (`feat:` → minor, `fix:` → patch;
   before 1.0.0 a breaking change bumps the minor version).
2. release-please keeps a PR “chore(main): release dayhand X.Y.Z” up to date. Review its changelog,
   check that `npm run build && npm run docs` in `cli/` leaves no changes, and merge it.
3. The tag `dayhand-vX.Y.Z` starts `publish-npm.yml` (or start it by hand on the tag), and the
   `npm` environment waits for approval. The job checks the package, runs the tests and
   publishes with provenance. Check it: `npm view <name>@X.Y.Z` and the provenance badge on
   npmjs.com.
4. Update the tap: download the tarball and take its checksum,
   ```sh
   curl -sLO https://registry.npmjs.org/<name>/-/dayhand-X.Y.Z.tgz    # scoped: .../@<scope>/dayhand/-/dayhand-X.Y.Z.tgz
   shasum -a 256 dayhand-X.Y.Z.tgz
   ```
   then copy `packaging/homebrew/dayhand.rb` (release-please has already set the version) into the
   tap with that `sha256`, run `brew audit --strict --online dayhand` and `brew test dayhand` in the
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
`DAYHAND_PUBLISH_ENABLED` to `false`.

## Check a package locally (nothing is published)

```sh
cd cli
npm ci --ignore-scripts
npm pack                         # runs prepack: build, copies man/dayhand.1, man/dh.1 and LICENSE into the package
mkdir -p /tmp/dayhand-try && cd /tmp/dayhand-try
npm init -y >/dev/null && npm install --ignore-scripts <path to>/dayhand-X.Y.Z.tgz
npx dayhand --version && npx dayhand help && npx dayhand completion bash | head
```

## After the first release

- [ ] Add the release and npm badges to the README row (and to [badges.md](badges.md)):
  `[![Release](https://img.shields.io/github/v/release/maiarowsky/helm?style=flat)](https://github.com/maiarowsky/helm/releases)`
  and `[![npm](https://img.shields.io/npm/v/dayhand?style=flat)](https://www.npmjs.com/package/dayhand)`
  (use the chosen npm name if it is not `dayhand`).
