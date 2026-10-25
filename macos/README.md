# Dayhand for macOS

Swift and SwiftUI, macOS 13 or later, all open source (Apache-2.0; the libraries GRDB.swift and
KeyboardShortcuts are MIT, Sparkle is MIT-style). Dayhand is the new name of Helm: the app, its folder and its bundle id
(`io.github.maiarowsky.dayhand`) used it from the start, and the server, `dayhand pair` and its
`dayhand://pair` link use it now (the app also opens `helm://pair` links from older versions).
This version is the basic one (MVP):

- **Main window**: a sidebar on the left (it folds with ⌃⌘S or the toolbar button) and the place picked in it
  on the right, with the selected task in a panel along the bottom. The sidebar lists **Inbox** (the approval
  requests and proposals waiting for the owner, read-only), **Today**, **All Tasks**, **No Project**, **Projects**
  (a dot of the project's colour or its emoji, the name and the number of open tasks, red while some are overdue;
  drag to reorder, **+** or ⌥⌘N for a new one, a context menu to edit, move, archive or delete one, and the
  archived ones under **Archived**), **Labels**, **Done and Archived** and **Trash**. The **Go** menu opens each
  place: ⌘1 Today, ⌘2 All Tasks, ⌘3 No Project, ⌘4 to ⌘9 the first six projects. The toolbar holds search (title, note and labels, in
  every list) and **+ Task**. A task dragged onto a project, No Project or Today goes there; **Task → Move to
  Project…** (⇧⌘M) picks one by typing. The window is at least 820 × 500 points, 1100 × 700 by default.
- **Lists**: All Tasks, No Project, a project and a label list their open tasks in sections (Overdue, Today,
  Later with the day, No Day) and the latest done (folded), each task with a second line of its project (outside
  that project's own list), day, repeat, checklist and labels. Quick add at the top of a project's list adds to
  that project, without a day.
- **Board, plan or list**: the toolbar's switcher (and the **View** menu, ⌃⌘1 Board, ⌃⌘2 Plan, ⌃⌘3 List) shows
  Today and every list place as the list above, as the week's **Plan** below, or as a **Board** of three status columns, To do, In progress and Done, each
  with its line icon (no round background) and a count (Done shows the latest done tasks and counts them all, as
  the list's Done does). A card holds the title, the project and chips for the day, labels and the checklist, with a
  **…** menu of the task's moves; dragging a card to another column changes its status, and a selected card opens
  the panel along the bottom. **Add Task** under To do opens quick add for the place (not in an archived project's
  place, which takes no new tasks). The choice is kept between launches. A drop changes only the status, never the
  day: on Today's board a task done today without today's day leaves the board when it is dragged back to To do or
  In progress.
- **Plan**: the place's week, Monday to Sunday, as a grid of the whole day's hours that opens at 08:00, with
  ‹ **This Week** › to move between weeks. A task with a time is a block with its project's colour on the left, its
  title, project and start time (a task has only a start, so a block is an hour long); tasks within the same hour
  share the width. Tasks without a time sit at the top of their day (**+n more** past a few). A block opens a popover
  with the status, the day and time, the checklist and **Open Task**, which opens the panel. The **Tasks** drawer
  along the bottom (it folds) holds the place's tasks in the three status columns: drag one onto an hour to plan it
  for that day at the half hour under the pointer, onto a day's top for the day without a time, onto another
  column to change its status, or onto a project in the sidebar to move it there. In a short window the header and
  the drawer shrink so the hours stay visible.
- **Today**: overdue (with **To today**), **Now** with "where I stopped", today (timed tasks first by time) and
  done today (folded). One click ticks a task off; the context menu works on it now, moves it to today or
  tomorrow, archives it or moves it to the trash.
- **Quick add** at the top of Today, in the menu bar and in a floating panel from any app (**⌃⌥N** by default,
  changed in Settings). A date phrase at the end of the line sets the day and time, with the grammar of `dayhand`
  (`cli/src/when/parse.ts`): "Call the accountant fri 2pm", "Pay rent the 1st", "Plan next week". The line below
  the field says what was understood; **Keep in title** keeps the words as text. Without a phrase the task is
  for today, as on the phone.
- **Task panel** along the bottom of the main window, with editing: the title, the status, **Work on It Now** and
  the resume note at the top; **Details** (the day and time from a phrase or **Today**, **Tomorrow**, **No day**,
  **Remove the time**; reminders and repeat in popovers; labels; the project), the checklist and the note side by
  side; then what agents set, the history, and archive or trash. Its top edge drags it taller or shorter. Links are
  shown. A task in the trash is read-only until **Restore**.
- **Agent** in the details, read-only, when an agent or `dayhand` set any of it: who holds the
  task's claim and until when (or that the claim ran out), **Blocked:** with the reason in red, the acceptance
  criteria with ticks and how many are met, the plan, **Waiting for** with the tasks it depends on ("#12 Send the
  invoice (done)"; a task the Mac does not have is said so) and the proof of completion (summary, checks that
  passed or failed, links). The fields come with each snapshot and are kept in the database, so they show offline.
- **Plan health card** above Today: one sentence from the server's report (`app:planHealth`), the most pressing
  first ("Plan: 1 overdue · 1 approval request · 2 proposals · 5 due today"), red when something is late or
  agents are paused, orange when the owner is asked for something, green when nothing needs a look. **Review**
  (when approval requests or proposals wait, or agents are paused) opens the waiting approval requests and
  proposals, read from the server and read-only: deciding stays on the phone and with `dayhand approvals` and
  `dayhand proposals`. The last report stays on the Mac offline; it goes with **Disconnect**.
- **Repeat** in the details is an editor: **Frequency** (does not repeat, daily, weekly, monthly, yearly), every
  how many, and weekdays Monday to Sunday for a weekly rule (none picked: the selected anchor's weekday).
  Monthly choices are the anchor's day, the last day, or an nth weekday suggested by the due date (today for an
  undated task), with a last-weekday choice when that date falls in the month's last week. A fixed month day or
  nth weekday set elsewhere is kept as a choice. Count the next date from the due date or from completion;
  without a due date it counts from completion. End never, on a day or after a number of times, **this occurrence
  included**. **Reminders** are as in Settings, none, or custom, at most five: minutes before the due time (only a
  timed task rings them) and times of day on the due day or the day before. Existing reminders further ahead are
  kept. Both editors stay a draft until **Save Repeat** or **Save Reminders**, enabled only for a changed rule or
  reminders the server accepts (`TaskRules`), so a refused change never reaches the outbox; **Revert** drops the draft.
- **Repeating offline**: next-occurrence generation, sync behavior and the paired-offline, agent-field and
  cross-device limitations are described in [docs/macos.md](../docs/macos.md#offline-repeating).
- **History** at the bottom of the details: who changed the task (you in the app, you with `dayhand`, or an agent
  by name) and when, newest first, each field from its old value to the new one. Only server history is shown;
  cached entries remain available offline. Without cached entries, the details say history is unavailable
  offline; a task created locally says its history starts once it reaches the server. Refresh rules are under
  [How it works](#how-it-works).
- **Trash** is a place of the sidebar. Deleted tasks are listed most recently deleted first, with the deletion
  day, the day the task expires from the trash and **Restore**, which also works offline. The server keeps deleted
  tasks for 30 days before its daily purge. The update button sits at the bottom left of the sidebar.
- **Menu bar**: the number of open tasks today (a warning icon when some are overdue), quick add, and today's
  open tasks to tick off without opening the window. Closing the window keeps Dayhand in the menu bar.
- **Connect** with a code from `dayhand pair`, typed or from a `dayhand://pair?…` link, or a `helm://pair?…` one from older versions (the app
  registers both schemes). **Not now** keeps everything on the Mac until a server is connected.
- **Offline first**: every change is in the local database and the outbox at once; the screens never wait for
  the network. Changes are sent in order when the server can be reached. Managing projects is the exception: it
  needs the server ([Projects](#projects)).
- **Reminders and the morning summary** as macOS notifications, worked out on the Mac from the local database
  with the Android app's rules, in the time zone of the server settings (this Mac's until a server has sent them). A
  reminder's **Done** completes the task. Settings → General → **Notifications** changes the **Morning summary**
  time and the **Default reminders** (at the due time, 5, 10, 15 or 30 minutes, 1 or 2 hours, or a day before;
  a value set elsewhere is kept as a choice). A change shows and is planned at once and goes to the server through
  the outbox (`app:updateSettings`); a snapshot taken while it waits does not undo it.
- **Updates** with Sparkle: a round blue button at the bottom left of the window when a newer version is out, a
  small window with its notes and **Update and Relaunch**, the download's progress, and Settings → Updates (check
  automatically, preview versions). Only builds made with the release key update; any other build says
  "Updates aren't available in this build" and never checks. Releasing an update: [docs/macos.md](../docs/macos.md#updates).
- **Eight languages**: English, Polish, German, Spanish, French, Brazilian Portuguese, Japanese and Simplified
  Chinese, with plural forms per language and days and times in the style of the Mac's region (14:00 or 2:00 PM).
  Dayhand follows the Mac's languages; Settings → General → **Language** picks one of the eight and the windows
  change at once (the menus that come with macOS follow after **Restart Dayhand**). Date phrases in quick add stay
  English in every language ("fri 2pm"). `DAYHAND_LANG=<code>` starts it in a language without changing Settings.

## How it works

```
click / quick add ──> TaskRepository: the row and its mutation in the outbox, one SQLite transaction
                                     │                                       (screens update at once)
SyncEngine, one round at a time: OutboxProcessor sends the outbox in order (POST /api/mutation, clientId)
                                 then app:listAll + app:listTrash + app:getSettings + app:listProjects
                                 (POST /api/query)
                                 ──> ProjectMerger (the server's projects win), then SnapshotMerger (last write
                                     wins per field; the settings fields a waiting app:updateSettings sets keep their
                                     local value) ──> the database
rounds: every 15 s, and at once after a local change

project editor ──> SyncEngine project call, never during a round: app:addProject, app:updateProject or
                   app:deleteProject at once ──> the server's answer into the database
                   (no server or no answer: "Requires a connection to the server.", nothing queued)

plan health: PlanHealthSync reads app:planHealth ──> meta table
Review: AgentInbox reads app:listApprovals + app:listProposals

history loads only when details open, the connection changes from offline/signed out/connecting to synced,
or Sync Now is requested:
  TaskHistorySync: app:getTask ──> the task's history replaces its cached copy
  no answer or no server: the cached copy stays, marked as such
  ordinary polls (even with a newer task version): no history request or cancellation; no retry loop
```

Plan health refresh and retention rules and Review's limits:
[docs/macos.md](../docs/macos.md#agent-work-and-settings-on-the-mac).

The code is a Swift package with these application and library targets (test targets are described below):

| Target | What it holds |
|---|---|
| `DayhandCore` | No UI. Model (`TaskItem`, `Project`, `RepeatRule`, …), rules (`HelmDates`, `Recurrence`, `TaskRules`, `todaySections`, `ReminderRules`, `WhenParser`, `QuickAdd`, `ProjectRules`, `TaskLists`, the history entries of `TaskHistory`), the database (`AppDatabase`, `TaskRepository` and `ProjectStore` on GRDB), sync (`OutboxProcessor`, `SnapshotMerger`, `ProjectMerger`, `ConvexRemote`, `SyncEngine`, `TaskHistorySync`, `PlanHealthSync`, `AgentInbox`), agent work (`AcceptanceItem`, `TaskProof`, `PlanHealth`, `HealthSummary`), sign-in (`PairingInput`, `PairingAPI`, `DeviceTokens`, `KeychainCredentialStore`) and `ReminderPlanner`. |
| `DayhandUpdates` | Updates on Sparkle: the configuration from `Info.plist`, the update state machine, release notes as text, the install note, and `Updater` (Sparkle's user driver). macOS only, so the core stays free of it. |
| `DayhandLocalization` | The texts: the string catalog `Localizable.xcstrings` (English is the source and the keys), the `.lproj` folders compiled from it, `tr(…)`, choosing the language (`Localization`) and days and times in the region's style (`DateText`). |
| `DayhandUI` | The SwiftUI app: `AppModel`, the windows and views, the quick add panel, the notifications, the update button and window. |
| `Dayhand` | The executable: starts `DayhandApp`. |
| `DayhandSnapshots` | A tool that renders the main screens to PNG files from synthetic tasks (no display needed). |

Rules ported from the Android app keep their names and comments, so a change on one side can be carried to the
other: `domain/Recurrence.kt` → `Recurrence.swift`, `sync/SnapshotMerger.kt` → `SnapshotMerger.swift`,
`data/remote/HttpTaskRemote.kt` → `ConvexRemote.swift`, `notify/ReminderEngine.kt` → `ReminderPlanner.swift`,
`sync/TaskHistorySync.kt` and `domain/HistoryEntries.kt` → `TaskHistorySync.swift` and `TaskHistory.swift`,
`agents/HealthSummary.kt` → `PlanHealth.swift`.
The backend's own rules are in `backend/convex/lib/dates.ts`, `repeat.ts` and `core.ts`.

**Sign-in.** `POST /auth/pair` with the code and this Mac's name gives a device token, which is kept only in the
login Keychain (one generic password item, service `io.github.maiarowsky.dayhand`). `POST /auth/token` turns it
into an app JWT for an hour, kept in memory only and fetched again five minutes before it ends. `401` from
`/auth/token` means the Mac was revoked (`dayhand revoke`): the token is dropped and Today says so; tasks and waiting
changes stay. Network errors and `503` keep the token and retry. **Disconnect** forgets the sign-in on the Mac and
names `dayhand revoke <deviceId>` for the server.

**Live updates** come from polling every 15 seconds while the app runs (four snapshot queries, well under the
server's limits). Plan health reads are separate, as described above. The official Swift client (`convex-swift`)
ships its core as a binary Rust framework, so it is not used:
the app needs only the Convex HTTP API, as the Android app's `HttpTaskRemote` does.

**Reminders.** Android keeps two alarms and works out what to show when one fires. macOS delivers notifications
left with it in advance, so `ReminderPlanner` makes the next 60 rings (reminders, then a summary for each of the
next seven mornings, each worked out for its own day) and the app updates the pending ones after every change.
Overdue tasks never ring. The summary is quiet (`passive`), so it waits in Notification Center. Dayhand asks for
permission when the first reminder is planned, or from Settings.

Where the app keeps things: the database in `~/Library/Application Support/Dayhand/dayhand.sqlite`, the sign-in
in the Keychain, preferences (the shortcut, the window, the update settings, the language) in `io.github.maiarowsky.dayhand`.
`DAYHAND_DATA_DIR=<folder>` selects another database, and `DAYHAND_CREDENTIALS=memory` keeps the sign-in only until
the app quits. These overrides do not isolate preferences or notifications; the [sync-loop check](#tests) uses a
separate app identity for those.

### Projects

Projects need Dayhand server 0.13.0 or later. Their data and sync are `Project`, `ProjectRules`, `ProjectStore`,
`ProjectCalls`, `ProjectMerger` and `TaskLists`; the sidebar, the lists and the project editor show them
([Main window](#dayhand-for-macos)). While the server has none (0.12.x) the sidebar hides them and the status line
says "Needs backend 0.13.0 or later".

- A task belongs to at most one project or none; labels stay free tags across projects. A project has a name
  (1 to 50 characters on one line, not `none`, unique without regard to case among all projects, archived ones
  included), one of 12 colours, an optional icon (one emoji), a note of up to 2,000 characters, a place in the
  sidebar, and may be archived. There can be at most 200.
- **Managing projects is online only.** Creating, editing (name, colour, icon, note), moving, archiving or restoring
  and deleting a project are calls to the server made at once: `SyncEngine.addProject`, `updateProject`,
  `moveProject`, `setArchived` and `deleteProject` send `app:addProject`, `app:updateProject` with the fields that
  changed, or `app:deleteProject` with `moveTasksTo` another project or `none`. Each change is checked on the Mac
  first (the rules above), and the server's answer is written into the local database at once (a deletion moves the
  tasks on the Mac as the server did); the snapshot keeps reconciling. Without a server, offline, or when the call
  gets no answer, it fails with "Requires a connection to the server." and nothing is queued; any other refusal comes
  back in the server's words and nothing changes. A call waits for a running sync round and the next round waits for
  it, so no snapshot read before a change can undo it. The project editor and the deletion dialog stay open until the
  server has the change and show the failure above their buttons; Move, Archive and Restore show it in an alert.
- **The offline queue holds task changes (and the settings) only**, appended at the end and sent oldest first, with
  no barriers, gating or waiting conditions. Putting a task into a project (`projectId` in `app:add` and
  `app:update`, `null` takes it out) is such a task change and names only a project the server has confirmed (one
  with a server id); any other target is refused at once ("That project is not on the server yet."). The outbox
  names the project by its local id and sends its server id. A repeating task's next occurrence made on the Mac keeps
  its project.
- The snapshot adds `app:listProjects`. Nothing about a project waits in the queue, so the server's copy wins and a
  project missing from the server goes. Projects match only by server id or `clientId`, never by name.
- A refusal never loses a task: when the server refuses an assignment because the project was archived or deleted on
  another device, the task stays and leaves the project on the Mac (unless a later change moves it), so the refusal
  shows as any refused change does, by undoing it; the reason is kept in the change's `lastError` while the change
  is sent again once, without the project. The next snapshot shows where the server has the task.
- **Older servers (0.12.x)** have no `app:listProjects` ("Could not find public function"). The snapshot then has
  no projects and the Mac notes that the server has none (`ProjectSupport.unsupported`): project calls and new
  assignments say "Needs backend 0.13.0 or later", localized in all eight languages, as does the status line. Nothing
  on the Mac is destroyed: the projects already here and the tasks' memberships stay. Tasks keep syncing; a task
  change that names a project goes without `projectId` (refused once for it, then sent without it from the start),
  with no retry loop and nothing waiting.
- **Known limitation:** a repeating task can lose its project when the project is archived on another device or the
  server is older (0.12.x): its next occurrence comes without a project. A task put into a project offline can also
  end without a project when this Mac archives or deletes that project before the queue has been sent. The task
  itself is never lost.
- Development builds of 0.4.0 queued project changes; migration v7 drops them from the outbox together with the
  projects the server never confirmed (their tasks stay, without a project).
- Quick add: a `+word` naming a project the server has that is not archived (any case, a hyphen for a space:
  `+strona-piekarni`) sets the project and leaves the title, the first one only; an exact trimmed, NFC,
  case-insensitive name wins over the hyphen-as-space alias. A `+word` naming none stays in the title and is
  reported as unknown, unless it is a date (`+3d`). The cases, shared with the other clients:
  [`Tests/cases/quickadd-project.json`](Tests/cases/quickadd-project.json).

## Build and run

Requirements: Xcode 26 or later (Swift 6.2; tested with Xcode 26.6 and Swift 6.3) to build; the app runs on macOS 13 or later. In `macos/`:

```sh
swift build                       # everything, debug
scripts/build-app.sh              # dist/Dayhand.app, release
open dist/Dayhand.app
```

`scripts/build-app.sh` builds under `nice` and the machine's shared build lock
(`/private/tmp/mussh-ios-build.lock`, change with `DAYHAND_BUILD_LOCK`), writes `Info.plist` from `Bundle/`
(version from `DAYHAND_VERSION`, build number from the commit count) and copies the packages' resource bundles,
the texts in eight languages among them.

**Texts.** They live in `Sources/DayhandLocalization/Localizable.xcstrings` (edit it in Xcode or as JSON; English
is the source and the keys, each with a comment for translators). SwiftPM copies a string catalog into the bundle
without compiling it, so after a change run `scripts/compile-strings.sh`, which compiles it with `xcstringstool`
into the `.lproj` folders the package ships, and commit both; `swift test` fails while they differ. Code takes a
text with `tr("Every \(n) days")`; the key is the English text with `%lld` for a whole number and `%@` for text.
The app is not signed with a Developer ID, not notarized and not in a DMG: see
[docs/macos.md](../docs/macos.md#distribution) for what that still needs. A locally built app runs on the Mac that
built it; after each rebuild macOS may ask once whether Dayhand may use its Keychain item.

`swift run Dayhand` starts the app without a bundle, which is enough for the screens and sync but not for
notifications or the `dayhand://` link (both need the bundle id).

To try it against a local backend (never your production one), start the backend as in the top-level README,
create a key and a pairing code there, then connect with `http://127.0.0.1:3211` and the code:

```sh
(cd ../backend && npm ci --ignore-scripts && npm run backend:start)
(cd ../backend && npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli","kind":"cli"}')
(cd ../cli && npm ci --ignore-scripts && npm run build && DAYHAND_URL=http://127.0.0.1:3211 DAYHAND_API_KEY=<key> node dist/bin/dayhand.js pair)
```

## Tests

```sh
swift test                        # the live-backend test is skipped by default
scripts/check-sync-loop.sh        # the release app with its sync loop turning, 50 seconds
```

`scripts/check-sync-loop.sh` forces a release build of `dist/Dayhand.app`, even when `DAYHAND_CONFIGURATION` is set
to debug. To use an existing release bundle instead, set `DAYHAND_APP=<path>/Dayhand.app`; `DAYHAND_CHECK_SECONDS`
changes the default 50-second run. The script opens a temporary copy under a separate bundle id for notifications
and preferences, then deletes that preferences domain on cleanup. It uses a temporary database and a process-local
Keychain stand-in for Dayhand's sign-in, pointed at a local server that accepts and closes each connection without
replying. It fails if the app exits early or makes too few server connections. This exercises the release-app crash
at the end of the sync loop's wait, which unit tests and debug builds did not reproduce.

- **Rules, case for case with the other clients**: dates and DST (`HelmDatesTest`), Today
  (`TodaySectionsTest`), repeat (`RecurrenceTest` and the backend's `repeat.test.ts`, with the RFC 5545 dates of
  python-dateutil), input rules (`TaskRulesTest`), reminders (`ReminderRulesTest`), the merge
  (`SnapshotMergerTest`) and pairing input (`PairingInputTest`) from the Android app; the date phrases of
  `cli/tests/when.unit.test.ts`, both clock-change weeks included.
- **The outbox and sync against a fake server** (`FakeServer.swift`, in memory): offline changes reach the server
  in order, a change whose answer was lost is applied once, a waiting change keeps its field against a newer
  snapshot, a refused change is dropped and repaired, a revoked Mac stops with its changes kept, a refused JWT is
  refreshed and the call repeated. `HistoryTests.swift` checks history parsing and actor attribution, fetching
  and cache replacement, retaining cached history offline, and removing it when a task is purged or local data
  is erased. It also checks trash expiry and queuing an offline restore. `RepeatEditingTests.swift` checks the editors'
  drafts against the rules they make, that rules and reminders `TaskRules` refuses queue nothing, and that a
  repeating task completed without a server gets its next occurrence locally and keeps one occurrence when the
  outbox is sent. With a server, generation stays on the server, including after a delayed offline completion.
  Permanent rejection of a parent add, rule-clear or completion drops its unsent generated descendants, while
  retryable failures retain them and unrelated additions still sync. `AgentWorkTests.swift` reads the agent fields
  from a snapshot (numbers as doubles), keeps them from the server even with a local change waiting, migrates a
  database of the earlier 0.3.0 schema (migrations v1 and v2) to v3 without losing a task and hydrates its agent
  fields from an unchanged server snapshot, shows agent work set elsewhere offline, reads the plan health report
  and the card's order, tone and Review as
  on the phone, keeps the last report offline and forgets it, and lists the waiting approval requests and proposals.
  `SettingsSyncTests.swift` checks that a settings change shows at once and queues one `app:updateSettings`,
  that values the backend refuses queue nothing, that a snapshot taken while the change waits keeps its fields
  and the others follow the server, that Sync Now waits for a running poll before sending changes, that an offline
  change is sent later, and that a refused one is repaired.
  The loop's wait ends at its timeout or at
  a change, many times over (`SignalTests`; also worth running as `swift test -c release --filter SignalTests`).
- **Projects** (`ProjectDomainTests.swift`, `ProjectSyncTests.swift`, `ProjectTrashRefusalTests.swift`): the name,
  icon, note and order rules, quick add's `+project` with the shared cases, the sidebar counts and the task list of a
  project, the merge (by server id or `clientId`, never a shared name; the server's copy wins), migrations from a
  0.3.0 database without losing a task and from a development build of 0.4.0 (v7). Against the fake server: without
  a connection every project call fails and queues nothing; creating, editing, moving, archiving and deleting (the
  tasks moved to a project or out of any) act on the server at once and the rows follow; a project call waits for a
  running round; a refusal comes back in the server's words; tasks put offline into a confirmed project arrive with
  its server id, while a project the server has not confirmed is refused on the Mac; a refused assignment leaves
  the task without the project; the queue goes strictly in order (trash, restore, archive and now never wait). With
  the fake server acting as 0.12 (no projects): project calls report the requirement, tasks sync without
  `projectId`, nothing on the Mac is lost and nothing is retried.
- **Against a real local backend** (`LiveBackendTests` and `LiveProjectsTests`, off by default): pairs with a code,
  adds with a date phrase, works offline, syncs, and checks every change with a fresh client. `LiveProjectsTests`
  with `DAYHAND_LIVE_PROJECTS=yes` (a backend with projects) makes, edits, archives and deletes a project online,
  checks that project calls fail offline without queuing anything, and puts tasks into the project offline, then
  syncs them; `no` (a 0.12 backend) checks that project calls report the requirement and tasks still sync. Each test
  uses its own pairing code.

  ```sh
  DAYHAND_LIVE_SITE=http://127.0.0.1:3211 DAYHAND_LIVE_CODE=<code from dayhand pair> swift test --filter LiveBackend
  DAYHAND_LIVE_SITE=http://127.0.0.1:3211 DAYHAND_LIVE_PROJECTS_CODE=<another code> DAYHAND_LIVE_PROJECTS=yes \
    swift test --filter LiveProjects
  ```

- **Updates** (`DayhandUpdatesTests`): the real Sparkle reads appcasts from a server on `127.0.0.1` started by the
  test, with a throwaway key pair made in memory: a newer build is offered with its notes, builds compare as
  numbers, an item for a newer macOS is skipped, previews only when asked for, up to date, an unreadable appcast
  and a server that is down give plain errors, a download that breaks halfway shows its progress and then an error,
  and a build without the key sends no request. Also the state machine, the `Info.plist` rules, the notes, the
  error texts and the install note. The tests keep Sparkle's settings under one test bundle id and remove them
  afterwards (macOS may leave an empty `io.github.maiarowsky.dayhand.updatetests.plist` behind).
- **Screens**: `swift run DayhandSnapshots <folder>` draws the main window with Today, a project and All Tasks
  (a task's panel open) at 1100 and 820 points wide in both appearances, Today and a project as a board, the week's
  plan of Today, a project and All Tasks with its drawer, a block's popover, Done and
  Archived, the archived projects, No Project, a label and the trash, the sidebar with its update button, the
  project editor, Move to Project and the deletion dialog, the panel with cached history and
  with history unavailable offline, the Agent section (claim, blocked, criteria, plan, waiting for) and a proof,
  the plan health card on Today, the read-only requests and proposals, the repeat and reminder editors (weekly with the reminders from Settings,
  monthly on an nth weekday with a count and custom reminders), the menu bar, quick add, Connect, Settings, Settings → General with the notification settings, Settings → Updates and every
  state of the update window. Synthetic data is drawn off screen into PNG files (the sidebar's translucent
  background does not draw off screen, so the sidebar and task lists are also drawn on their own).
  `swift run DayhandSnapshots <folder> pl` draws them in another language, and the tool fails when a text on
  them is missing from the string catalog. It also lays out the main window in a real window with its title bar
  (wide, narrowest, sidebar closed, light and dark, as a list, a board and a plan) and fails when the content is taller
  than the window or quick add sits under the title bar and its window buttons.
- **Sidebar and lists** (`SidebarTests`): the sidebar's counts against the database, a project's list in sections
  and search, quick add in a project, a task dropped on a place, a server without projects hiding them, project
  changes without a server saying "Requires a connection to the server." with nothing queued, the panel's height
  and the project colours.
- **Board** (`BoardTests`): a project's and Today's columns by status and with search, a card dropped on another
  column taking its status (not on its own column or for an unknown task), the Done column counting every done task
  while it shows the latest, no new tasks in an archived project's place, and the view switcher (Board, Plan, List)
  with its choice kept between launches.
- **Plan** (`PlanTests`): the week from Monday and moving it, where times sit in the grid and the half hour a point
  gives, tasks within one hour sharing the width, a short window keeping room for the hours, and a place's active
  tasks due in the week, narrowed by the search.
- **History presentation and editor texts** (`DayhandUITests`): refresh-key equality and connection-recovery
  classification, placeholders for fresh, cached and local-only history, translated, actor-neutral claim labels,
  the month choices and counts of the repeat editor in English and Polish, and picker days and times that do not
  move with the zone. `AgentTextTests` checks the health card's sentence and colour, the claim, dependency and
  approval texts in English and Polish, the default reminder choices and when a synced poll reads the report. These are unit checks, not clicks through the running app.
- **Texts** (`DayhandLocalizationTests`): every key of the catalog is translated into all eight languages and no
  other, the format specifiers (`%lld`, `%@`, `%1$@`) and plural forms of each translation match the source and the
  language's rules, the compiled `.lproj` folders are up to date with the catalog, every `tr("…")` in the sources
  has its key and every key is used, and switching the language changes the texts of the screens, the reminders
  and the update messages.

The Keychain store (`KeychainCredentialStore`) is not exercised by the tests, so they never write to your login
Keychain.

## Dependencies

Pinned exactly in `Package.swift` and locked in `Package.resolved`; every version was older than seven days when
chosen: [GRDB.swift](https://github.com/groue/GRDB.swift) 7.11.1 (MIT, SQLite) and
[KeyboardShortcuts](https://github.com/sindresorhus/KeyboardShortcuts) 3.1.0 (MIT, the global shortcut and its
recorder), chosen 2026-10-23, and [Sparkle](https://github.com/sparkle-project/Sparkle) 2.10.0 (MIT-style, the
updates; released 2026-09-13, chosen 2026-10-24), which SwiftPM takes as a signed binary framework from its GitHub
release. Everything else is Apple's SDK (SwiftUI, AppKit, UserNotifications, Security). No analytics, crash
reporting or other outside services; the only address the app calls besides your server is the appcast, and only
in a build made with the release key (Sparkle's system profile stays off).
