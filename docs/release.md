# Releasing dayhand

The `dayhand` CLI (`cli/`) is versioned on its own: its version is `cli/package.json`, its tags are
`dayhand-vX.Y.Z` and its changelog is `cli/CHANGELOG.md`. The backend and the apps keep their own
versions; `dayhand version` checks the server's `serverInfo.version` against
`MIN_SERVER_VERSION` in `cli/src/core/version.ts` (same major, not older than the minimum).

The CLI goes to npm as `dayhand` (`npm i -g dayhand`) and to the Homebrew tap `maiarowsky/tap`
(`brew install maiarowsky/tap/dayhand`). Everything needed to publish is in the repository, and
**nothing publishes yet**:

| File | What it does | Off until |
|---|---|---|
| `.github/workflows/release-please.yml` | keeps a release PR for `cli/` (version bump, changelog); merging it tags `dayhand-vX.Y.Z` | repository variable `DAYHAND_RELEASE_ENABLED=true` |
| `release-please-config.json`, `.release-please-manifest.json` | release-please setup: only `cli/`, component `dayhand`, also bumps the Homebrew formula | |
| `.github/workflows/publish-npm.yml` | on a `dayhand-v*` tag: tests, then `npm publish --provenance` with trusted publishing (OIDC, no token) | variable `DAYHAND_PUBLISH_ENABLED=true`, the `npm` environment, and `cli/scripts/check-release.mjs` |
| `packaging/homebrew/dayhand.rb` | the formula: installs the npm tarball, links `dayhand` and `dh`, man pages and completion | copied into the tap `maiarowsky/homebrew-tap` by hand, with the tarball's `sha256` |
| `cli/package.json` | name `dayhand`, public, `repository` `maiarowsky/dayhand` (`cli/`); `npm pack` holds `dist/`, the man pages, README and LICENSE | |

`check-release.mjs` stops the publish job while the package is private, when the tag does not
match the version, when `repository.url` is missing, or when npm is older than 11.5.1.

## Before the first release (on the maintainer's word)

Done in the repository: the package is named `dayhand` (free on npm: `npm view dayhand` answered 404
on 2026-10-24), it is no longer private, and `repository`, `homepage` and `bugs` point to the public
repository `maiarowsky/dayhand`, which provenance checks. `node scripts/check-release.mjs
dayhand-v<version>` in `cli/` passes. The commands stay `dayhand` and `dh` (the `bin` field, which
also keeps `hlm` until 1.0).

Each step below changes something outside this repository or makes it public, so each needs the
maintainer's explicit go-ahead.

1. **Turn on the repository settings:** Settings → Security → *Private vulnerability
   reporting* (SECURITY.md relies on it); install the [DCO app](https://github.com/apps/dco)
   (it reads `.github/dco.yml`); protect `main` with the DCO check and the tests required.
2. **Create the `npm` environment** (Settings → Environments → New environment `npm`), with
   *Required reviewers* = the maintainer and *Deployment branches and tags* = tags `dayhand-v*`.
   Every publish then waits for an approval.
3. **Publish the first version by hand, once.** npm can attach a trusted publisher only to a
   package that exists. On a trusted machine, logged in to npm with 2FA:
   `cd cli && npm ci --ignore-scripts && npm test && npm publish --access public` (no provenance
   for this one; npm asks for the one-time code).
4. **Add the trusted publisher on npmjs.com:** package → Settings → *Trusted publishing* →
   GitHub Actions: organization or user `maiarowsky`, repository `dayhand`, workflow
   `publish-npm.yml`, environment `npm`. Then, in the same settings, choose *Require two-factor
   authentication and disallow tokens*, so only the workflow can publish.
5. **Set the repository variables** (Settings → Secrets and variables → Actions → Variables):
   `DAYHAND_RELEASE_ENABLED=true` and `DAYHAND_PUBLISH_ENABLED=true` (the `HLM_*` names from
   before the rename are not read). Optional secret
   `RELEASE_PLEASE_TOKEN` (a fine-grained token with contents and pull requests write on this
   repository only): with it the tag from release-please starts `publish-npm.yml` by itself;
   without it, start that workflow by hand on the tag (Actions → Publish dayhand to npm → Run
   workflow → the tag).
6. **Create the tap** `maiarowsky/homebrew-tap` (public; the `homebrew-` prefix is what lets users
   type `maiarowsky/tap`). Copy `packaging/homebrew/dayhand.rb` to `Formula/dayhand.rb` there, with
   the `sha256` of the published tarball (step 4 of [Every release](#every-release)), and check it:
   ```sh
   brew tap maiarowsky/tap
   brew audit --strict --online maiarowsky/tap/dayhand
   brew install maiarowsky/tap/dayhand && brew test maiarowsky/tap/dayhand
   ```
   The formula links `dayhand` and `dh`; on Linux, where debhelper may have its own `dh`, users type
   `dayhand`. The tap can hold other formulae later under the same short name.
7. **Switch the install pages to “available”** (one small commit, see
   [After the first release](#after-the-first-release)).

## Every release

1. Merge work into `main` with Conventional Commit messages (`feat:` → minor, `fix:` → patch;
   before 1.0.0 a breaking change bumps the minor version).
2. release-please keeps a PR “chore(main): release dayhand X.Y.Z” up to date. Review its changelog,
   check that regenerating the references and published pages with the
   [CLI contribution instructions](../CONTRIBUTING.md#the-dayhand-cli) leaves no changes, and merge it.
3. The tag `dayhand-vX.Y.Z` starts `publish-npm.yml` (or start it by hand on the tag), and the
   `npm` environment waits for approval. The job checks the package, runs the tests and
   publishes with provenance. Check it: `npm view dayhand@X.Y.Z` and the provenance badge on
   npmjs.com.
4. Update the tap `maiarowsky/homebrew-tap`: download the tarball and take its checksum,
   ```sh
   curl -sLO https://registry.npmjs.org/dayhand/-/dayhand-X.Y.Z.tgz
   shasum -a 256 dayhand-X.Y.Z.tgz
   ```
   then copy `packaging/homebrew/dayhand.rb` (release-please has already set the version) to
   `Formula/dayhand.rb` in the tap with that `sha256`, run
   `brew audit --strict --online maiarowsky/tap/dayhand` and `brew test maiarowsky/tap/dayhand`, and push.

## A JSON contract change

`--json` is a contract (docs/cli.md#json-output). Adding a field is a minor release. Removing
or retyping one, or changing an exit code, is a breaking change: a major version (or a minor
one before 1.0.0) with a `BREAKING CHANGE:` footer, and the schemas in `docs/schemas/` change
in the same PR.

## Rolling back

npm does not allow publishing the same version twice. Unpublishing is possible only within 72
hours and only without dependents; prefer `npm deprecate dayhand@X.Y.Z "<why>"` and publish a
fixed X.Y.Z+1. In the tap, revert the formula commit. To stop all releases at once, set
`DAYHAND_PUBLISH_ENABLED` to `false`.

## Check a package locally (nothing is published)

```sh
cd cli
npm ci --ignore-scripts
npm pack --dry-run               # the file list: dist/, man/dayhand.1, man/dh.1, README.md, LICENSE, package.json
npm pack                         # runs prepack: build, copies man/dayhand.1, man/dh.1 and LICENSE into the package
mkdir -p /tmp/dayhand-try && cd /tmp/dayhand-try
npm init -y >/dev/null && npm install --ignore-scripts <path to>/dayhand-X.Y.Z.tgz
npx dayhand --version && npx dh --help && npx dayhand completion bash | head
```

## After the first release

The release badge is already live and updates when a release exists. Once `npm view dayhand` and
`brew install maiarowsky/tap/dayhand` work, one small commit switches the install pages from
“available after the first release” to available:

- [ ] `README.md`: delete the quoted line “**npm and Homebrew: available after the first release.** …”
  under the Install table, and replace the static npm badge with
  `[![npm](https://img.shields.io/npm/v/dayhand?style=flat)](https://www.npmjs.com/package/dayhand)`.
- [ ] `docs/install.md`: delete the same quoted line under the table.
- [ ] `docs/README.md`: in “What exists and what is planned”, move npm and Homebrew to *Today*.
- [ ] `docs/contributing.md`: drop “nothing is published yet” from Releases.
- [ ] [badges.md](badges.md): the npm row becomes live.
- [ ] `site/index.html` (dayhand.dev): the same commands in its install section.
