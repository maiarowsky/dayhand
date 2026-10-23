# Helm for Android

Kotlin, Jetpack Compose and Material 3. This version has **Today** with quick add, the **board**,
**task details** and the **trash**, works offline, rings reminders and a morning summary computed
on the phone, has the **Settings** screen and connects to a server by **pairing** with a one-time
code from `hlm pair`.

- Package and application id: `dev.helm.planner`. This is a **working id: change it before any
  store release** (it cannot change after the first upload).
- Version 0.5.2 (`versionName`: 0.x, MINOR for each step that adds screens, PATCH for fixes and
  polish); `versionCode` is the number of commits on `HEAD`.
- minSdk 26, compileSdk and targetSdk 36 (see "Dependencies" for why not 37 yet).
- English and Polish, text that follows the system font size, touch targets of at least 48 dp
  and descriptions for screen readers.
- The look of Mussh: its 16 colour palettes, type scale, buttons, cards and fields, with a
  light/dark/system theme and a choice of bundled fonts; see [docs/design.md](../docs/design.md).

## Screens

**Today**, top to bottom:

1. **Overdue (n)**: not done, due before today in your time zone. Each task: tick it off,
   **To today**, or from the menu another day or archive.
2. **Now**: the single task you are working on, with "where I stopped / next step" under its
   title (tap it to edit). Pick it with "Work on it now" in a task's menu.
3. **Today**: tasks due today, timed ones first by time.
4. **Done (n)**: collapsed by default.

With nothing to do, one sentence and an **Add task** button. A line at the top says when the
phone is offline (and how many changes wait), while changes are being sent, when the server
signed the phone out, or when no server is connected.

**Connect to server** opens by itself at the first start (with **Not now, use Helm offline**),
from Settings, and from a `helm://pair` link (the QR code of `hlm pair`):

1. **Server address**, filled in with the built-in server (`BuildConfig.DEFAULT_SERVER_URL`,
   the production HTTP actions URL; another with `-Phelm.serverUrl=…`), the last server used or
   the link's `url`. A `.convex.cloud` address is turned into its `.convex.site` one.
2. **Pairing code** from `hlm pair` (or `npx helm pair` in `backend/`): any case, with or
   without dashes; `O` is read as `0`, `I` and `L` as `1`.
3. **Connect**. Errors are said in words: a wrong, used or expired code; too many wrong codes
   (with the wait); no network; the server cannot be reached; no Helm server at the address;
   a problem on the server.

Tapping a task opens its details. The bar at the bottom switches between Today and the board.

**Board**: three columns, **To do / In progress / Done** (the 50 most recently done). On a phone
one column shows at a time under tabs; from 600 dp wide the columns sit side by side. The "now"
task leads "In progress", highlighted, with "where I stopped" under its title (tap to edit).
Move a card by long-pressing it and dragging it onto another column (or its tab), or without
dragging from the card's menu (each other column, "Work on it now", "Not now"); screen readers
get the same moves as actions on the card. Tap a card for its details. The bin icon opens the
trash.

**Task details**: title, status (and "Work on it now" with the resume note), due day with an
optional time, repeat (every N days, weeks on chosen weekdays, months or years), labels (which
are also the projects: the backend has one list for both), links (http/https only; no files in
version 1) and the note. Each field is edited in place or in a small dialog and checked against
the backend's limits before it is queued, so a change the server would refuse is never queued.
**Move to trash** keeps the task for 30 days; a task in the trash is read-only until restored.
**Change history** lists who changed what, newest first: **You (app)**, **You (CLI)** (`hlm` with a
`cli` key) or **Agent**.

**Trash**: tasks deleted by you or the agent, newest first, with the day each one goes for good;
**Restore** brings one back.

**Quick add**: the button at the bottom opens a sheet with one title field; one tap (or the
keyboard's Done key) saves it for today. "More options" adds the day, a time and a note.

**Settings** is laid out like Mussh's: groups under upper-case labels, one row per setting with a
thin outline icon, the name, a short current value and "›". Each row opens its own page with the
choice, what it means and, where something is missing, the one button that fixes it; Back returns
to the list. Settings are drawn in the system sans whatever the font (as in Mussh); the font shows
in its preview and on the other screens. Top to bottom:

1. **Appearance**: **Theme** (system, light or dark), **Color palette** (a dark and a light
   palette, each from the Mussh palettes, with a preview of both) and **Font** (system, Inter,
   IBM Plex Sans, Atkinson Hyperlegible, Geist, Source Serif 4 or JetBrains Mono, each shown in
   itself); **Language** (phone language, Polski or English, Android 13+ per-app language). The
   appearance is stored on the phone and applies at once, without a restart.
2. **Notifications**: **Notifications and alarms** (on, off, or "needs fixing" when exact alarms
   are missing; the page says what each means and has a button that asks Android (13+) or opens
   the system settings, and one that allows exact alarms); **Morning summary** (the time, default
   05:00, picked on a clock); **Default reminders** (at the due time, 5, 10, 15, 30 min, 1 h, 2 h
   or 1 day before, any number of them or none).
3. **Data**: **Export**, the whole plan as Markdown or JSON, saved where you choose in the system
   dialog.
4. **Connection**: **Server**, with the connection status (connected, connecting, no network,
   offline test mode, not connected, signed out, cannot reach the server) and the number of
   changes waiting; the server and this phone's name with **Disconnect** (after a confirmation
   that names the `hlm revoke <deviceId>` command), or **Connect to server**; the offline test
   switch and the time zone from the server.
5. **About**: the Apache License 2.0, the licenses of the bundled fonts (SIL Open Font License
   1.1) and the version.

The summary time and default reminders are server settings (`summaryTime`,
`defaultReminderMinutes`), so the agent sees and can change them too. A change on the phone is
stored at once and sent through the outbox (`app:updateSettings`) like any other change; a
snapshot does not undo it while it waits.

## Reminders and the morning summary

Computed on the phone from Room, with no server and no foreground service:

- A task **rings** when it has a day and a time, is not done and not archived: once for each
  default reminder (minutes before the due time). Tasks without a time never ring.
- **Overdue tasks never ring**; they wait at the top of Today. A reminder that would come more
  than 15 minutes late (phone off, Doze) is dropped instead, and so is one whose moment had
  already passed when the task was set.
- The **morning summary** comes every day at the summary time: how many tasks today (the now
  task included), how many overdue, and where to start (the now task, else the first overdue,
  else the first of today). Its channel is quiet, so it waits on the lock screen instead of
  waking you at 05:00.
- Times are read in the **time zone from the server settings**, the same zone that decides
  "today", so the phone and the agent agree.

How: `ReminderEngine` keeps exactly **two alarms** in AlarmManager, the next reminder and the
next summary. When one fires, `AlarmReceiver` shows what is due and arms the next one. Alarms
are exact (`setExactAndAllowWhileIdle`) when the user allows exact alarms (Android 12+; off by
default from Android 14), otherwise inexact and possibly a few minutes late; Settings says
which. They are armed again on every change of tasks or reminder settings, at app start, after
a reboot, an app update, a clock or time zone change and a change of the exact-alarm
permission (`SystemEventsReceiver`). After a force stop Android drops the alarms until Helm is
opened again. A reminder's **Done** button completes the task offline-first, like a tap on
Today. Android 13+ asks for the notification permission when the first task with a time is
added, or from Settings.

## How offline works

```
tap ──> Room transaction: change the task row + append to outbox ──> screen updates at once
                                                │
            WorkManager (needs network) ── sends the outbox in order over
            POST /api/mutation, deletes a record only after the server answered
                                                │
Convex subscription (app:listAll, app:listTrash, app:getSettings) ──> SnapshotMerger ──> Room
```

- **Room is the source of truth for the screens.** The screen never waits for the network.
- **Outbox** (`outbox` table): one record per change with `opId`, mutation name, arguments,
  time and a `clientId`. The backend applies an operation with a known `clientId` only once, so
  a change resent after a lost answer is not applied twice. A new task's `clientId` is its local
  id, which is also how the server copy is matched to the local row.
- **WorkManager** sends the outbox strictly in order and stops at the first failure, so nothing
  overtakes an earlier change. The request survives the app being killed and the phone
  restarting. After a force stop, Android runs it again once the app is opened.
- **Reads**: while the app is open, the official Convex client (`dev.convex:android-convexmobile`)
  keeps a live subscription and every snapshot is merged into Room. Both directions sit behind
  `TaskRemote` (`TaskFeed` + `MutationSender`), so the Convex client can be replaced by plain
  HTTP (`HttpTaskRemote`, which also polls `POST /api/query` if the native client cannot load).
- **The trash is part of every snapshot** (`app:listTrash`), so trashed tasks stay on the phone
  with `deletedAt` set and the Trash screen works offline; a task purged after 30 days disappears.
- **History** (`app:getTask`) is read over HTTP when a task's details open and whenever a newer
  server copy of it arrives, and cached in Room (`task_events`), so it shows offline too.
  Changes still in the outbox are counted under it; they join the history once sent.
- **Conflicts: last write wins per field, by `updatedAt`.** A field changed by a change still in
  the outbox keeps its local value (that change will reach the server last). Every other field
  takes the server value, but only from a server copy newer than the one merged before, so a
  late snapshot never undoes a newer state.
- **Today and overdue** are computed on the phone by `HelmDates` and `todaySections`, the same
  rules as `backend/convex/lib/dates.ts`, in the time zone from your server settings (default
  `Europe/London`, as on the backend). The screen moves on at local midnight.

## Signing in

The phone is paired once and then asks the server for short-lived app tokens
([docs/pairing.md](../docs/pairing.md)):

```
Connect: POST /auth/pair {code, deviceName}  ──> deviceToken + convexUrl (stored encrypted)
any time: POST /auth/token {deviceToken}       ──> app JWT for 1 hour (kept in memory only)
Convex client and HTTP API with that JWT       ──> app.* as the owner
```

- The **device token** is encrypted with AES-256-GCM by Tink under a key in the Android
  Keystore and never logged or shown. Backups and device transfers are switched off for the app.
  The device name sent is the phone model (`Build.MODEL`); `hlm devices` shows it.
- `DeviceTokens` keeps one JWT for the live feed, the outbox and the export, and fetches a new
  one when less than 5 minutes are left. The Convex client gets the new token before the old
  one ends, and asks again when the server refuses one; the HTTP API retries once with a new
  token.
- **Network errors and `503`** keep the device token; a cached JWT that is still valid is used
  meanwhile, and changes wait in the outbox. **`401` from `/auth/token`** means the phone was
  revoked (`hlm revoke`): the device token is deleted, Today and Settings say the server signed
  the phone out, and Connect asks for a new code. Tasks and waiting changes stay on the phone.
- On a local backend `/auth/pair` returns `http://127.0.0.1:3210` as the Convex URL; the app
  keeps the port and uses the host it paired with (`10.0.2.2` on the emulator).
- **Disconnect** forgets the sign-in on the phone only. The backend has no endpoint for a
  device to revoke itself, so the dialog names `hlm revoke <deviceId>` for that.
- A phone that had an app token pasted in version 0.2 keeps using it until it is paired or
  disconnected; pasting tokens is no longer offered.

What happens after connecting: the outbox starts at once and sends every change made before,
in order (tasks added offline before any server was known included), and the live Convex
subscription downloads the whole plan into Room. The connection line shows the progress.

## Run it locally

Requirements: JDK 17 or newer, the Android SDK with platform 36, Node.js 20+ for the backend.

1. Start the backend (see the top-level README), in `backend/`:

   ```sh
   npm ci --ignore-scripts
   npm run backend:start
   ```

2. In a second terminal, in `backend/`, create a CLI key for the app user and a pairing code:

   ```sh
   npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli","kind":"cli"}'
   export HELM_URL=http://127.0.0.1:3211 HELM_API_KEY=<key>
   npx helm pair                               # or hlm pair with HLM_URL / HLM_API_KEY
   ```

   Optionally set your time zone:
   `npx convex run ops:updateSettings '{"userId":"https://helm.local|me","actor":"app","timezone":"Europe/Warsaw"}'`

3. Build and install the app (in `android/`):

   ```sh
   ./gradlew :app:installDebug
   ```

4. In the app, on Connect, enter `http://10.0.2.2:3211` on the emulator (on a phone in the
   same network use the computer's address; debug builds allow plain HTTP, release builds only
   HTTPS) and the code, then Connect. Or open the link from `helm pair` on the emulator:
   `adb shell am start -a android.intent.action.VIEW -d "'helm://pair?url=http%3A%2F%2F10.0.2.2%3A3211&code=<code>'"`.

5. Check from the computer: `npx helm today` and `npx helm devices`.

For a production deployment see [docs/deploy.md](../docs/deploy.md); the app's default server
is set in `app/build.gradle.kts` (`helm.serverUrl`).

## Tests

```sh
./gradlew :app:testDebugUnitTest            # JVM: dates, Today, board, rules, history, reminders, outbox, merge,
                                            # HTTP, export, pairing input, /auth/pair and /auth/token, token refresh
./gradlew :app:connectedDebugAndroidTest    # emulator: Room and its migration, outbox across restarts, settings sync,
                                            # Compose (Today, board, details, Settings, Connect), encrypted pairing
                                            # storage, and a real alarm + notification (ReminderDeliveryTest, about 80 s)
```

`ReminderDeliveryTest` speeds time up by setting a task and the summary to the next whole
minute: Android fires the real alarm, the test checks both notifications and taps **Done**.

The end-to-end checks drive the app on an emulator against the local backend and pair it with
a code from the CLI. `e2e-pairing.py`: first start opens Connect, a task added before pairing,
a wrong code refused, the right one typed by hand, the CLI's task on the phone and the phone's
on the server, a task added in airplane mode reaching the server when the network is back,
Disconnect. `e2e-offline.py`: the same offline path with a killed and a force-stopped app. With
the backend running, `HELM_URL`/`HELM_API_KEY` set and the CLI built (`cli/`: `npm ci
--ignore-scripts && npm run build`):

```sh
./gradlew :app:assembleDebug
python3 scripts/e2e-pairing.py --apk app/build/outputs/apk/debug/app-debug.apk --shots /tmp/shots
python3 scripts/e2e-offline.py --apk app/build/outputs/apk/debug/app-debug.apk
```

`scripts/e2e-board-details.py` (same arguments) checks the board and details the same way: a task
added by the agent is dragged to "In progress", moved to "Done" from its menu, renamed and given a
label, a time and a link; offline it goes to the trash and the change reaches the server after the
app was killed; it is restored from the Trash screen, and an agent edit shows in its history as
the agent's. Every step is checked on the server through MCP, with an agent key of the same user
in `HELM_AGENT_KEY` (`npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"agent","kind":"agent"}'`).

## Dependencies

All versions are pinned in `gradle/libs.versions.toml` and every resolved dependency is locked
(`app/gradle.lockfile`, `buildscript-gradle.lockfile`, `settings-gradle.lockfile`); regenerate
with `./gradlew :app:dependencies buildEnvironment --write-locks`. No version newer than 7 days
at the time of choosing (2026-10-22) is used. Compose BOM 2026.09.00, androidx.core 1.19 and
lifecycle 2.11 need compileSdk 37; until platform 37 is set up, the app uses BOM 2026.06.01,
core 1.18.0 and lifecycle 2.10.0 with compileSdk 36.

Permissions: the app declares `INTERNET` and `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`
(reminders and the summary; Android 13+ asks), `SCHEDULE_EXACT_ALARM` (reminders on the minute;
the user can refuse) and `RECEIVE_BOOT_COMPLETED` (alarms and the outbox after a reboot).
WorkManager adds `WAKE_LOCK`; its `FOREGROUND_SERVICE` is removed. No analytics, crash reporting
or other outside services.
