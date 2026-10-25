# Changelog: Dayhand for macOS

Versions before 0.2.0 are described in the commit history (`git log -- macos`). The app has no
signed release yet; `scripts/build-app.sh` writes the version (`DAYHAND_VERSION`, by default the
latest one below).

## 0.4.0 (unreleased)

### Added

- **Projects** in the local database and sync, the groundwork for the project list in the sidebar: each task
  belongs to at most one project, and projects (name, colour, emoji icon, note, order, archived) are added, edited,
  archived and deleted offline through the outbox (`app:addProject`, `app:updateProject`, `app:deleteProject`,
  `projectId` in `app:add` and `app:update`). A project and tasks written in it offline reach the server in order,
  with the server's project id in each task. Quick add reads `+project` (`+strona-piekarni`). Behaviour, limits and
  the shared cases: [README.md](README.md#projects).

### Changed

- The local database keeps projects and each task's project (migration v4); the next snapshot fills them in.
- With a server older than 0.13.0 (no projects) the app syncs as before: projects stay off, a project written on the
  Mac goes and its tasks reach the server without it, and nothing is resent in a loop.

## 0.3.0 (unreleased)

### Added

- **Repeat** and **Reminders** in the task details are now editors, with drafts validated before saving.
  Choices and usage: [README.md](README.md).

- **Trash** with **Restore** in the task sidebar, and per-task **History** in the details.
  Usage and offline behavior: [README.md](README.md).

- A **plan health card** above Today, with **Review** listing the waiting approval requests and proposals read-only.
- An **Agent** section in the task details, read-only: the claim and until when, acceptance criteria with ticks,
  the plan, the proof of completion, the tasks it waits for and why it is blocked.
- Settings → General → **Notifications** edits the morning summary time and the default reminders; the change goes
  through the outbox (`app:updateSettings`) and a snapshot taken while it waits does not undo it.
  Usage and limitations: [README.md](README.md), [docs/macos.md](../docs/macos.md#agent-work-and-settings-on-the-mac).

### Changed

- Repeating tasks completed without a server now create their next occurrence locally.
  Sync behavior and limitations: [docs/macos.md](../docs/macos.md#offline-repeating).
- The existing sidebar now switches between Today and Trash; the window keeps its two-column layout.
- The local database now caches server history; the cache leaves the Mac with a purged task.
  Migration details: [`AppDatabase.swift`](Sources/DayhandCore/Store/AppDatabase.swift).
- The local database also keeps each task's number and agent fields from the snapshot (migration v3) and the last
  plan health report.

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
