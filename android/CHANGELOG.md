# Changelog: Dayhand for Android

Versions before 0.8.4 are described in the commit history (`git log -- android`). The app was
called Helm until 0.9.0.

## 0.9.0 (2026-10-24)

### Changed

- Helm is now **Dayhand**: the app's name and its texts in English and Polish, and the names of
  the backup file (`dayhand-backup-<date>.json`) and the exported plan (`dayhand-plan-<date>.md`
  and so on). The app id `io.github.maiarowsky.dayhand`, the plan on the phone, the sign-in and
  the settings stay as they were, so the update installs over 0.8.4.
- Pairing links are `dayhand://pair`; `helm://pair` links from older servers still open the app.
- The build reads `-Pdayhand.serverUrl` and `DAYHAND_RELEASE_*`; `helm.serverUrl` and
  `HELM_RELEASE_*` still work, with a warning in the build output.

## 0.8.4 (2026-10-23)

### Added

- **On this phone only**: Helm works without an account or a server, and the first start offers
  it first, next to **Connect to my server**. Settings → Server says whether the phone works on
  its own or is connected, and how to connect a server of your own later.
- **Try with sample data** at the first start: a sample plan for Today, the calendar and the
  board, in the app's language, which stays on the phone and goes with one tap.
- **Backup** in Settings → Data: save the plan on this phone to a file, share it or restore one,
  in Helm's JSON export format, which a Helm server imports too (`hlm import`).
- Without a server the phone adds a repeating task's next occurrence when it is completed.
- **Use this phone's time zone** in Settings → Server when the server's differs.

### Changed

- Without a server "today" and the reminders follow the phone's time zone, not Europe/London.
- No warning line on Today when no server is connected.
- A pairing code for another server than the one whose plan is on the phone asks before it
  replaces the plan; the old server's tasks and waiting changes never reach the new one.
- Export (from the server), the calendar address and agent connections are shown only with a
  server.

### Removed

- The offline test mode switch; on this phone only and airplane mode cover what it did.
