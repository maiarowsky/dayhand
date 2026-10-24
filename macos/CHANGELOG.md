# Changelog: Dayhand for macOS

Versions before 0.2.0 are described in the commit history (`git log -- macos`). The app has no
signed release yet; `scripts/build-app.sh` writes the version (`DAYHAND_VERSION`, by default the
latest one below).

## 0.2.1 (2026-10-24)

### Fixed

- The main window's content starts below the title bar again. Once Today held tasks while the status line
  ("Not connected to a server; tasks stay on this Mac.") was shown, the window's content grew taller than the
  window and slid up under it: the status line and its **Connect…** button were cut off at the top and quick add sat
  among the window buttons, next to the sidebar button and the title. The update button at the bottom of the
  sidebar was cut off the same way.

### Changed

- `DayhandSnapshots` also lays out the main window in a real window with its title bar and fails when the content
  does not fit it or quick add sits under the title bar.

## 0.2.0 (2026-10-24)

### Added

- **Eight languages**: English (the source), Polish, German, Spanish, French, Brazilian Portuguese,
  Japanese and Simplified Chinese, with each language's plural forms, in every window, the menu bar,
  the reminders and morning summary, the update window and Settings → Updates.
- Settings → General → **Language**: the Mac's languages (the default) or one of the eight. Dayhand's
  windows change at once and the planned notifications are made again in the new language; the menus
  that come with macOS follow after **Restart Dayhand**. `DAYHAND_LANG=<code>` starts the app in a
  language without changing Settings.
- Days and times follow the Mac's region (14:00 or 2:00 PM, "Fri 23 Oct" or "Fri, Oct 23").

### Changed

- The texts live in the string catalog `Localizable.xcstrings`; `scripts/compile-strings.sh` compiles
  it into the `.lproj` folders the package ships (SwiftPM does not compile string catalogs), and
  `Info.plist` lists the eight languages (`CFBundleLocalizations`).
- Date phrases in quick add and the date field stay English in every language ("fri 2pm").
