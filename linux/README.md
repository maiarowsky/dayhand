# Dayhand for Linux

Qt 6 and QML, C++20, built with CMake; Apache-2.0 like the rest of the repository. The app is `dayhand-qt`,
its app id `io.github.maiarowsky.dayhand` (the Wayland app id, the `.desktop` file and the icon name). This version
is the basic one (MVP); installing it and setting it up on Omarchy/Hyprland is in [docs/linux.md](../docs/linux.md).

- **Today**: overdue (with **To today**), **Now** with "where I stopped", today (timed tasks first by time) and done
  today (folded). One click on the circle ticks a task off; the context menu (right click or **⋯**) works on it now,
  moves it to today or tomorrow, archives it or moves it to the trash.
- **Task details**: click a row to open a right-hand panel in a wide window, or a page with **Back** in a narrow one.
  Edit the title, status, **Working on it now**, where you stopped and checklist items.
  A date phrase has an **I understand** preview; Return or **Set date** applies it, with **Today**, **No day** and
  **Remove time** shortcuts.
  **Save note** saves the note explicitly; repeat, reminders and links are read-only previews.
  **Archive** and **Move to Trash** keep the selected details open; a trashed task is read-only until **Restore**.
  Per-task reminder/repeat/link editors are not part of this version.
- **Trash**: **⋯ → Trash** lists deleted tasks, newest deletion first, with the permanent-deletion date (30 days
  after deletion) and **Restore**. **Back** returns to Today; the server's next snapshot removes purged tasks.
- **Quick add** at the top of Today and as a small window of its own for a keyboard binding
  (`dayhand-qt --quick-add`). A date phrase at the end of the line sets the day and time, with the grammar of
  `dayhand` (`cli/src/when/parse.ts`): "Call the accountant fri 2pm", "Pay rent the 1st". The line below the field
  says what was understood; **Keep in title** keeps the words as text. Without a phrase the task is for today.
- **Tray**: a StatusNotifierItem (the Omarchy shell's tray, Waybar's `tray` module, KDE) with the number of open
  tasks today in the tooltip, a red mark when some are overdue, quick add, and today's open tasks to tick off.
  Closing the window keeps Dayhand in the tray.
- **Connect** with a code from `dayhand pair`, typed or from a `dayhand://pair?…` link (also `helm://pair?…` from
  older versions). **Not now** keeps everything on this computer until a server is connected.
- **Offline first**: every change is in the local SQLite database and the outbox at once; the screens never wait
  for the network. Changes go to the server in order when it can be reached, every 15 seconds and after each change.
- **Reminders and the morning summary** as desktop notifications (`org.freedesktop.Notifications`), worked out from
  the local database with the Android app's rules. A reminder's **Done** completes the task; a click opens Dayhand.
  **⋯ → Settings…** changes the summary's hour and minute (05:00 by default) and the default reminders: at the time,
  5, 10, 15 or 30 minutes, 1 or 2 hours, or 1 day before. Uncheck all to disable default reminders. These defaults
  apply to timed tasks without their own reminders. Changes save immediately, replan the running reminder clock,
  and queue `app:updateSettings`; a snapshot keeps each edited field local while its changes wait in the outbox.
- **Languages**: English, Polish, German, Spanish, French, Brazilian Portuguese, Japanese and Simplified Chinese,
  the system's by default, chosen in **⋯ → Settings…**. Quick add reads dates in English in every language, as
  `dayhand` does.
- **Colours** from the system palette, or from a palette file that an Omarchy theme can write
  ([docs/linux.md](../docs/linux.md#colours-and-omarchy-themes)).

## How it works

The rules are ported from the macOS app as behaviour, not code, and checked against the same cases:

| Part | Where |
|---|---|
| Dates in the server's time zone, date phrases, quick add, repeat (RFC 5545 subset), Today's sections | `src/core/HelmDates`, `WhenParser`, `QuickAdd`, `Recurrence`, `TodaySections` |
| Reminders and the morning summary | `src/core/Reminders`, `ReminderPlanner`; `src/app/ReminderClock` rings them |
| Local database (Qt SQL, SQLite, WAL) with the task rows and the outbox | `src/core/Database`, `TaskRows`, `TaskRepository` |
| Sync: the outbox in order with `clientId` idempotency, then the snapshot merged field by field | `src/core/SyncEngine`, `SnapshotMerger`, `ConvexRemote`, on its own thread in `SyncWorker` |
| Pairing and the device token, kept in the Secret Service keyring (libsecret) | `src/core/PairingApi`, `Credentials`, `SecretServiceStore` |
| Window, quick add window, settings | `src/app/qml/*.qml` over `src/app/AppModel` |
| Tray, notifications, one instance per session, palette file | `src/app/Tray`, `Notifier`, `SingleInstance`, `PaletteFile` |
| Translations | `translations/dayhand_<language>.ts`, `src/core/Translations` |

`src/core` has no screen and builds on its own (`-DDAYHAND_BUILD_APP=OFF`), so its tests need only Qt Core, SQL
and Network.

## Build and test

On Arch Linux (or Omarchy):

```sh
sudo pacman -S --needed cmake ninja qt6-base qt6-declarative qt6-svg qt6-tools qt6-wayland libsecret
cmake -S linux -B linux/build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build linux/build
ctest --test-dir linux/build --output-on-failure     # tst_desktop and smoke_wayland also need weston and dbus
linux/build/src/app/dayhand-qt
```

On another system, `linux/scripts/container-test.sh` builds and tests in an Arch Linux container (Docker, 4 CPUs,
pinned image and package snapshot; `DAYHAND_SNAPSHOT_DIR=<folder>` also saves pictures of the windows). The
tests:

| Test | What it checks |
|---|---|
| `tst_dates`, `tst_recurrence` | the date phrases and repeat rules on the cases shared with the CLI and macOS (`tests/cases/*.json`) |
| `tst_rules`, `tst_merge`, `tst_pairing`, `tst_sync` | Today's sections, reminders, task/settings merges (including waiting settings mutations), pairing and sync against a fake server |
| `tst_translations` | runs lupdate on the sources and fails when a text is missing, unfinished or stale in any language |
| `tst_app` | the model, reminder rescheduling after settings changes, the Today window and the quick add window on the offscreen platform: typing, ticking off, responsive task details and edits, the language switch |
| `tst_desktop` | notifications and the tray against fake desktop services, as a client of a headless Weston |
| `smoke_wayland` | the real `dayhand-qt` on Weston: starts in the background, a second copy hands `--quick-add` and a pairing link over |

New texts: wrap them in `tr()` or `qsTr()`, run `cmake --build linux/build --target update_translations`, translate
the new entries in every `translations/*.ts` (Qt Linguist or by hand), and `tst_translations` passes again.

The package for Arch Linux is `packaging/arch/PKGBUILD` (`makepkg -si` in that folder builds this checkout).
