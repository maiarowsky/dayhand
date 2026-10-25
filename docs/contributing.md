# Contributing

Dayhand is open source under the Apache License 2.0, and contributions are welcome. The rules for a
change, signing off your commits, the commit format and the tests each part needs are in
[CONTRIBUTING.md](../CONTRIBUTING.md); this page is a map of the repository and of these docs.

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
| `site/` | dayhand.dev: the landing page and these docs, built with Astro | [site/STYLE.md](../site/STYLE.md) |
| `scripts/` | checks and builders for the README and the site | |

Test setup and the checks each change needs:
[backend](../CONTRIBUTING.md#testing), [CLI](../CONTRIBUTING.md#the-dayhand-cli).

## Writing these docs

Edit the Markdown in `docs/`; dayhand.dev renders it when the site is built, and nothing generated is
committed. Build and check commands are in [CONTRIBUTING.md](../CONTRIBUTING.md#the-site-and-the-documentation);
how the site turns the Markdown into pages is in [site/STYLE.md](../site/STYLE.md#documentation-pages-docs).

- Which files become pages, their titles in the menu and their order are in `site/src/docs/pages.ts`. A
  new page goes there.
- Link to other pages by their file name (`[webhooks](webhooks.md#events)`). Links to any other file in
  the repository become links to it on GitHub. A link to a missing file stops the build, and
  `scripts/check-site.sh` reports a link to a missing heading.
- For generated command references and the Agent Skill, follow the
  [CLI contribution instructions](../CONTRIBUTING.md#the-dayhand-cli) instead of editing the output.
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

The CLI is released on its own with release-please, to npm as `dayhand` and to the Homebrew tap
`maiarowsky/tap`. How a release works, for maintainers: [release.md](release.md).
