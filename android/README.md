# Helm for Android

Kotlin, Jetpack Compose and Material 3. This version has **Today** with quick add, the **board**,
**task details** and the **trash**, and works offline; full settings and reminders come in later
steps.

- Package and application id: `dev.helm.planner`. This is a **working id: change it before any
  store release** (it cannot change after the first upload).
- Version 0.2.0 (`versionName`, 0.x with the minor number raised for each new screen);
  `versionCode` is the number of commits on `HEAD`.
- minSdk 26, compileSdk and targetSdk 36 (see "Dependencies" for why not 37 yet).
- English and Polish, light and dark theme, text that follows the system font size, touch
  targets of at least 48 dp and descriptions for screen readers.

## Screens

**Today**, top to bottom:

1. **Overdue (n)**: not done, due before today in your time zone. Each task: tick it off,
   **To today**, or from the menu another day or archive.
2. **Now**: the single task you are working on, with "where I stopped / next step" under its
   title (tap it to edit). Pick it with "Work on it now" in a task's menu.
3. **Today**: tasks due today, timed ones first by time.
4. **Done (n)**: collapsed by default.

With nothing to do, one sentence and an **Add task** button. A line at the top says when the
phone is offline (and how many changes wait), when the server refused the token, or when no
server is set up.

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
**Change history** lists who changed what, **You (app)** or **Agent**, newest first.

**Trash**: tasks deleted by you or the agent, newest first, with the day each one goes for good;
**Restore** brings one back.

**Quick add**: the button at the bottom opens a sheet with one title field; one tap (or the
keyboard's Done key) saves it for today. "More options" adds the day, a time and a note.

**Settings** (minimal): backend address, app token (pasted) and an offline test switch.

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

## Signing in (this step)

The app stores the backend address and an **app token**: an ES256 JWT signed by
`backend/scripts/app-token.mjs` with a private key that never enters the repository. The token
is pasted into Settings, encrypted with AES-256-GCM by Tink under a key in the Android Keystore,
and never logged or shown again. Backups and device transfers are switched off for the app.
Pairing with a QR code is described, not built, in [docs/pairing.md](../docs/pairing.md).

## Run it locally

Requirements: JDK 17 or newer, the Android SDK with platform 36, Node.js 20+ for the backend.

1. Start the backend (see the top-level README), in `backend/`:

   ```sh
   npm ci --ignore-scripts
   npm run backend:start
   ```

2. In a second terminal, in `backend/`, issue an app token and a CLI key **for the same user**:

   ```sh
   npm run app-token > ~/helm-token.txt        # user https://helm.local|me, valid 90 days
   npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli"}'
   ```

   Optionally set your time zone:
   `npx convex run ops:updateSettings '{"userId":"https://helm.local|me","actor":"app","timezone":"Europe/Warsaw"}'`

3. Build and install the app (in `android/`):

   ```sh
   ./gradlew :app:installDebug
   ```

4. In the app open Settings, enter `http://10.0.2.2:3210` on the emulator (on a phone in the
   same network use the computer's address; debug builds allow plain HTTP, release builds only
   HTTPS), paste the token and save.

5. Check from the computer: `HELM_URL=http://127.0.0.1:3211 HELM_API_KEY=<key> npx helm today`.

For your own deployment, create a key pair with `npm run app-token -- --generate <file outside
the repo>`, set the printed `HELM_JWKS` and `HELM_JWT_ISSUER` on the deployment, and issue
tokens with `HELM_SIGNING_KEY_FILE=<file> HELM_JWT_ISSUER=<issuer> npm run app-token`.

## Tests

```sh
./gradlew :app:testDebugUnitTest            # JVM: dates, Today, board, rules, history, outbox, merge, HTTP
./gradlew :app:connectedDebugAndroidTest    # emulator: Room and its migration, outbox across restarts, Compose
```

The end-to-end offline check drives the app on an emulator against the local backend: add a
task, go offline, add another, kill the app, go online, and verify both on the server with the
CLI. With the backend running, the token in a file and `HELM_URL`/`HELM_API_KEY` set:

```sh
./gradlew :app:assembleDebug
python3 scripts/e2e-offline.py --apk app/build/outputs/apk/debug/app-debug.apk --token-file ~/helm-token.txt
```

`scripts/e2e-board-details.py` (same arguments) checks the board and details the same way: a task
added by the agent is dragged to "In progress", moved to "Done" from its menu, renamed and given a
label, a time and a link; offline it goes to the trash and the change reaches the server after the
app was killed; it is restored from the Trash screen, and an agent edit shows in its history as
the agent's. Every step is checked on the server through MCP.

## Dependencies

All versions are pinned in `gradle/libs.versions.toml` and every resolved dependency is locked
(`app/gradle.lockfile`, `buildscript-gradle.lockfile`, `settings-gradle.lockfile`); regenerate
with `./gradlew :app:dependencies buildEnvironment --write-locks`. No version newer than 7 days
at the time of choosing (2026-10-22) is used. Compose BOM 2026.09.00, androidx.core 1.19 and
lifecycle 2.11 need compileSdk 37; until platform 37 is set up, the app uses BOM 2026.06.01,
core 1.18.0 and lifecycle 2.10.0 with compileSdk 36.

Permissions: the app declares `INTERNET` and `ACCESS_NETWORK_STATE`. WorkManager adds
`WAKE_LOCK` and `RECEIVE_BOOT_COMPLETED` (needed for the outbox to survive a reboot); its
`FOREGROUND_SERVICE` is removed. No analytics, crash reporting or other outside services.
