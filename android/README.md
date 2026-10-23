# Helm for Android

Kotlin, Jetpack Compose and Material 3. This version has **Today** with quick add, the **calendar**
(week and day), the **board**, **task details** and the **trash**, works offline, rings reminders and a morning summary computed
on the phone, has the **Settings** screen, connects to a server by **pairing** with a one-time
code from `hlm pair`, approves and disconnects **agent connections** such as the Claude app, and
turns on the read-only **calendar address** for Google and Apple Calendar.

- Package and application id: `dev.helm.planner`. This is a **working id: change it before any
  store release** (it cannot change after the first upload).
- Version 0.8.3 (`versionName`: 0.x, MINOR for each step that adds screens, PATCH for fixes and
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

Tapping a task opens its details. The bar at the bottom switches between Today (where the app
opens), the calendar and the board.

**Calendar**: the week on an hour grid, or one day, switched by two text tabs (**Week** / **Day**).
The week always shows Monday to Sunday; a swipe or the arrows turn it (in the day view the arrows go
a day). With at least 80 dp a day (from about 610 dp wide: a tablet, a phone on its side) the tasks
have their titles. A title breaks only between words: what does not fit ends in "…" (`wordLines`),
never "Zadzw / onić". Tasks with a time are blocks at their hour (30 minutes tall, side by side when
they overlap); tasks without a time sit in a band above the hours (two per day, then "+N", which
opens the day). On a phone held upright (`barsOnly`) the tasks are **bars without titles**, in the
same colours and with the same marks: a bar at its hour per timed task, a short bar per task without
a time in the band (three, then "+N"). A tap on a bar opens the task; a tap on a day (its column or
its part of the band) opens the day with the titles; a **long press on a day** opens a sheet of its
tasks with their titles, each with **Move**, for bars too small to read or hold. Bars drag like
blocks (the lifted task is drawn at least 72 dp wide with its time and title); the left and right
edges that turn the week are 12 dp there instead of 32 dp, so a task can be dropped on Sunday. The day view lists overdue
tasks (on today) and tasks without a time above its hours. Today's header is in the accent and
underlined, its column lightly tinted, with a line at the current time; overdue tasks are in the
danger colour and marked "!", later dates of a repeating task "↻" (computed by
`domain/Recurrence.kt`, from today on), done tasks "✓". **Today** comes back, a day's header opens
that day, and leaving a day for the week shows that day in it. A tap opens the task's details. A
**long press** lifts a block (with a tap of haptic feedback); dragging it moves it to another day
(column) and time: its top snaps to a quarter of an hour, and a line in its column with the time
in the hours' column shows where it lands. Dropped over the day headers or the band (in the day
view, the "All day" row that appears at the top while dragging, or the lists above the hours), it
loses its time; a task from the band dropped in the hours gets one. Held at the left or right edge
the days move on (the week turns; the day view turns the day), and near the top or bottom of the hours they scroll. The gesture is followed by the
calendar, not the block (`CalendarDrag.kt`), so it goes on when the block's own day leaves the
screen; the snapping and the edges are plain functions (`DropMath`). A long press let go without
moving (or the screen reader's long press and "Move" action) opens a sheet, laid out like Settings, to
pick a day of the task's week, another day or a time or "No time". A drop and **Move** change
Room and queue `setDue` through the outbox like any other change, and the snackbar offers
**Undo**, which sends the old day and time back the same way. Later dates of a series and done
tasks do not move. Moving a repeating task moves its own (current) date, as editing its due date
does; its later dates follow from the rule and that date.

**Board**: three columns, **To do / In progress / Done** (the 50 most recently done). On a phone
one column shows at a time under tabs; from 600 dp wide the columns sit side by side. The "now"
task leads "In progress", highlighted, with "where I stopped" under its title (tap to edit).
Move a card by long-pressing it and dragging it onto another column (or its tab), or without
dragging from the card's menu (each other column, "Work on it now", "Not now"); screen readers
get the same moves as actions on the card. Tap a card for its details. The bin icon opens the
trash.

**Task details**: title, status (and "Work on it now" with the resume note), due day with an
optional time, repeat, reminders, a checklist, labels (which are also the projects: the backend has
one list for both), links (http/https only; no files in version 1) and the note.
**Repeat**: every N days, weeks (on chosen weekdays), months or years; a monthly task on the due
date's day, the last day of the month, or an nth weekday ("the 2nd Tuesday", "the last Friday");
the next date counted from the due date or from the day you complete it; ending never, on a day
or after a number of times. A day the month lacks (the 31st in April) falls on its last day. The
dates are those of `domain/Recurrence.kt`, which mirrors the backend's `lib/repeat.ts` case for
case (the server stores and exports the rule as RFC 5545 RRULE).
**Checklist**: items with a checkbox, in order; tap the box to tick, tap the text to rename, move
up or down, or remove. Ticking items does not complete the task; the next task of a repeating
series starts with every item unticked.
**Reminders**: as in Settings (the default), none, or the task's own: minutes before the due time
and times of day on the due day or a day before (at most five). Each field is edited in place or in a small dialog and checked against
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
   dialog. **Calendar**: the read-only iCalendar address of the plan
   ([docs/calendar.md](../docs/calendar.md)): turn it on, then copy it, add it to Google Calendar
   ("From URL", opened in the browser) or share the `webcal://` address to Apple Calendar;
   **Create a new address** replaces it (the old one stops working) and **Turn off** removes it,
   each after a confirmation. The address is a secret and the page says so; it is read from the
   server each time the page opens, never stored on the phone. **Export .ics** makes a one-time
   file of the plan and hands it to the share sheet (to import into any calendar).
4. **Connection**: **Server**, with the connection status (connected, connecting, no network,
   offline test mode, not connected, signed out, cannot reach the server) and the number of
   changes waiting; the server and this phone's name with **Disconnect** (after a confirmation
   that names the `hlm revoke <deviceId>` command), or **Connect to server**; the offline test
   switch and the time zone from the server. **Agent connections**: the agents connected with
   OAuth, such as the Claude app ([docs/oauth.md](../docs/oauth.md)), each with where it comes
   from, read only or read and change, and its last use; tapping one disconnects it after a
   confirmation. **Approve a connection** takes the code the agent's sign-in page shows, then
   shows who asks (identified by its host, or "registered itself" with an unverified name),
   where the answer goes, when it asked (with a warning when the request is minutes old or the
   answer goes to a program on the computer) and a switch per permission; **Approve** or
   **Refuse** answers the page, which continues by itself.
5. **About**: the Apache License 2.0, the licenses of the bundled fonts (SIL Open Font License
   1.1) and the version.

The summary time and default reminders are server settings (`summaryTime`,
`defaultReminderMinutes`), so the agent sees and can change them too. A change on the phone is
stored at once and sent through the outbox (`app:updateSettings`) like any other change; a
snapshot does not undo it while it waits.

## Reminders and the morning summary

Computed on the phone from Room, with no server and no foreground service:

- A task **rings** when it has a day, is not done and not archived: once for each of its own
  reminders, or of the default reminders from Settings when it has none of its own. Minutes before
  the due time need a time; a time of day ("18:00, the day before") rings for a task without one
  too. A task whose own reminders are "none" never rings.
- **Overdue tasks never ring**; they wait at the top of Today. A reminder that would come more
  than 15 minutes late (phone off, Doze) is dropped instead, and so is one whose moment had
  already passed when the task was set.
- The **morning summary** comes every day at the summary time: how many tasks today (the now
  task included), how many overdue, and where to start (the now task, else the first overdue,
  else the first of today). Its channel is quiet, so it waits on the lock screen instead of
  waking you at 05:00.
- Times are read in the **time zone from the server settings**, the same zone that decides
  "today", so the phone and the agent agree. A time of day the spring clock change skips rings
  after the gap (01:30 on 29 Mar in London rings at 02:30 BST).

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
./gradlew :app:testDebugUnitTest            # JVM: dates, repeat dates, Today, calendar days, board, rules, history, reminders, outbox, merge,
                                            # HTTP, export, pairing input, /auth/pair and /auth/token, token refresh,
                                            # agent connections (answers, code input, approval flow), calendar address
./gradlew :app:connectedDebugAndroidTest    # emulator: Room and its migration, outbox across restarts, settings sync,
                                            # Compose (Today, calendar, board, details, Settings, Settings → Calendar, Connect, agent connections), encrypted pairing
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

`scripts/e2e-connections.py` (same arguments, plus `--site-url` for the HTTP actions URL as the
computer sees it) plays the Claude app over HTTP: it registers, opens the authorization page and
reads its code; the code is typed in Settings → Agent connections, the consent is checked and
approved; the script exchanges the code with PKCE, adds a task through `/mcp` with the access
token and checks it on the phone with the history `agent: <client name>`; a second request is
refused on the phone (`access_denied`), and disconnecting on the phone makes `/mcp` answer `401`.

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
