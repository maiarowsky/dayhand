# Changelog: Dayhand for macOS

Versions before 0.2.0 are described in the commit history (`git log -- macos`). The app has no
signed release yet; `scripts/build-app.sh` writes the version (`DAYHAND_VERSION`, by default the
latest one below).

## 0.3.0 (unreleased)

### Added

- **Trash** in the shared task sidebar: the deleted tasks, the most recent first, each with the day it was
  deleted, the day the server deletes it for good (30 days later) and **Restore**. A task picked there opens
  read-only in the details, as before.
- **History** at the bottom of a task's details: who changed it (you in the app, you with `dayhand`, or an agent
  by name) and when, newest first, with each field from its old value to the new one. It comes from the server
  (`app:getTask`) when the task opens, whenever a newer copy arrives, after successful syncs (including
  reconnection), and on **Sync Now**. It is kept in the local database, so cached history shows offline too; without
  a cached copy, the details say history is unavailable offline. Changes still waiting to be sent are counted
  above it, and a task made offline says its history starts once it reaches the server. Claim actions use an
  actor-neutral label in all eight languages.

### Changed

- The main window keeps two columns and its 720-point minimum width: a Today/Trash segmented chooser at the
  top of the existing sidebar switches its task list, with no count badges, and details stay on the right.
  The update button stays at the bottom left of the sidebar.
- The local database gains the `taskEvent` table (migration `v2`); the history of a task purged from the server
  leaves the Mac with the task.

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
