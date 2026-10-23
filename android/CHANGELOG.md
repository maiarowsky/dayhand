# Changelog: Helm for Android

Versions before 0.8.4 are described in the commit history (`git log -- android`).

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
