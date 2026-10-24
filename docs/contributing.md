# Contributing

Dayhand is open source under the Apache License 2.0, and contributions are welcome. The rules for a
change, signing off your commits, the commit format and the tests each part needs are in
[CONTRIBUTING.md](../CONTRIBUTING.md); this page is a map of the repository and of these docs.

## The short version

- **Sign off every commit** (`git commit -s`): it certifies the Developer Certificate of Origin, and
  commits without it cannot be merged.
- **Commit messages** are `<type>: <description>`, with the types `feat`, `fix`, `refactor`, `docs`,
  `test`, `chore`, `perf` and `ci`.
- **Install dependencies from the lockfile** with install scripts off: `npm ci --ignore-scripts`.
- **Never commit keys, tokens or `.env` files.**
- **Security problems** go privately, never in an issue ([security](security.md#reporting-a-problem)).

## The repository

| Folder | What it is | Start with |
|---|---|---|
| `backend/` | the Convex backend: data model, operations, MCP, REST API, webhooks, OAuth | [architecture](architecture.md) |
| `cli/` | `dayhand`, the command line and `dayhand ui` | [cli/README.md](../cli/README.md) |
| `android/` | the Android app (Kotlin, Compose) | [android/README.md](../android/README.md) |
| `macos/` | Dayhand for macOS (Swift, SwiftUI) | [macos/README.md](../macos/README.md) |
| `linux/` | Dayhand for Linux (Qt 6, QML, C++) | [linux/README.md](../linux/README.md) |
| `packaging/` | the Arch Linux package and the Homebrew formula template | |
| `docs/` | these pages, the JSON schemas of `--json` and the MCP results, the Agent Skill | below |
| `man/` | the manual pages, generated from the CLI | |
| `site/` | dayhand.dev: the landing page and the built docs | [site/STYLE.md](../site/STYLE.md) |
| `scripts/` | checks and builders for the README and the site | |

The backend and CLI tests start their own throwaway Convex backend, so they need no account:

```sh
(cd backend && npm ci --ignore-scripts && npm test)
(cd cli && npm ci --ignore-scripts && npm test)
```

## Writing these docs

The pages are the Markdown files in `docs/`. `scripts/build-docs.mjs` turns them into the static pages
of [dayhand.dev/docs](https://dayhand.dev/docs/) in `site/docs/`, with the landing page's stylesheet, a
menu, and a search that runs in the browser from a small index file. It uses only Node's standard
library; the built pages are committed, so the site needs no build step to be served.

```sh
node scripts/build-docs.mjs            # after changing docs/*.md
scripts/check-site.sh                  # the whole site: HTML, links, no outside resources, docs up to date
```

- Which files become pages, their titles in the menu and their order are in `scripts/docs/pages.mjs`. A
  new page goes there.
- Link to other pages by their file name (`[webhooks](webhooks.md#events)`). Links to any other file in
  the repository become links to it on GitHub. A link to a missing file or heading stops the build.
- `docs/cli.md`, `man/dayhand.1` and `docs/skills/dayhand/SKILL.md` are generated from the CLI's command
  registry: change the command in `cli/src/registry/`, then `npm run build && npm run docs` in `cli/`.
- Write only what is true in `main`. Something that is not released or not built yet is marked as
  planned or coming soon, with no command for it. Check a command before you document it.
- English, short sentences, plain words.

## Translations

The apps and `dayhand ui` speak eight languages. Each part keeps its texts in one place and has a check (a test or lint) that
fails when a text is missing in a language:

- Android: `android/app/src/main/res/values*/strings.xml`
- macOS: `macos/Sources/DayhandLocalization/Localizable.xcstrings`
- Linux: `linux/translations/dayhand_<language>.ts`
- `dayhand ui`: `cli/src/i18n/`

Corrections from native speakers are welcome.

## Releases

The CLI is released on its own with release-please, and nothing is published yet. How a release will
work, for maintainers: [release.md](release.md).
