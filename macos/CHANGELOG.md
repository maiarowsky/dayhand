# Changelog: Dayhand for macOS

Versions before 0.2.0 are described in the commit history (`git log -- macos`). The app has no
signed release yet; `scripts/build-app.sh` writes the version (`DAYHAND_VERSION`, by default the
latest one below).

## 0.3.0 (unreleased)

### Added

- **Repeat** and **Reminders** in the task details are now editors, with drafts validated before saving.
  Choices and usage: [README.md](README.md).

- **Trash** with **Restore** in the task sidebar, and per-task **History** in the details.
  Usage and offline behavior: [README.md](README.md).

### Changed

- Repeating tasks completed without a server now create their next occurrence locally.
  Sync behavior and limitations: [docs/macos.md](../docs/macos.md#offline-repeating).
- The existing sidebar now switches between Today and Trash; the window keeps its two-column layout.
- The local database now caches server history; the cache leaves the Mac with a purged task.
  Migration details: [`AppDatabase.swift`](Sources/DayhandCore/Store/AppDatabase.swift).

## 0.2.2 (2026-10-24)

### Fixed

- A release build connected to a server no longer quits about 15 seconds after it starts. When the sync loop's
  wait between two polls ended, the app aborted (`swift_task_dealloc`: "freed pointer was not the last
  allocation"), so it closed again shortly after every start. The wait and the snapshot tool's pauses now sleep
  with `Task.sleep(nanoseconds:)`, as planning the notifications already does.

### Added

- `scripts/check-sync-loop.sh` runs the release app against a server that never answers and fails when the app
  ends before the time is up or the sync loop did not turn. `SignalTests` runs the wait many times.

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
