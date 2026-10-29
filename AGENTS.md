# AGENTS.md

Dayhand (formerly Helm). This repository is public: everything committed here is published.

## Where things are

- `CONTRIBUTING.md`: rules for a change, sign-off, commit format, tests each part needs. Read it first.
- `docs/contributing.md`: map of the folders. `docs/README.md`: index of the user docs. `docs/architecture.md`: backend design.
- Apps and CLI: `android/README.md`, `macos/README.md`, `linux/README.md`, `ios/README.md`, `cli/README.md`. Site: `site/STYLE.md`. Releases: `docs/release.md`.

## Build and test

- Backend: `cd backend && npm ci --ignore-scripts && npm run typecheck && npm test` (starts its own local Convex backend).
- CLI: backend deps first, then `cd cli && npm ci --ignore-scripts && npm test` (`npm run test:unit`: pure tests). After changing a command run `npm run build && npm run docs` and commit the regenerated files.
- Android, in `android/`: `./gradlew :app:testDebugUnitTest :app:lintDebug`. macOS, in `macos/`: `swift test`. Linux: CMake and `ctest`, see `linux/README.md`.
- Site: `scripts/check-site.sh --build`.
- npm packages only through `npm ci --ignore-scripts`.

## Rules

- Sign off every commit (`git commit -s`), fix-up commits from review tools included; `Signed-off-by` matches the author.
- Commit with the GitHub noreply identity already in the git config; never change it or use a personal email address.
- Commit format `<type>: <description>`; types in `CONTRIBUTING.md`.
- `--json` output, error JSON and exit codes are a contract: change them only with the contract tests and schema in the same PR.
- Docs describe only what is in `main`; anything unreleased is "coming soon", with no command.
- Nothing private: no keys, tokens, `.env`, server addresses, account ids or real tasks. Screenshots use sample data only.

## Only on the maintainer's explicit word

Publishing to npm or Homebrew, merging a release PR or tagging, building or uploading a signed APK, deploying dayhand.dev, touching the waitlist database, changing repository settings or variables. Never bump `cli/package.json` by hand.
