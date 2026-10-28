# Dayhand for Android

Kotlin, Jetpack Compose and Material 3. This version has **Today** with quick add, the **calendar**
(week and day), the **board**, **projects**, **task details** and the **trash**, works offline, rings reminders and a morning summary computed
on the phone, has the **Settings** screen, connects to a server by **pairing** with a one-time
code from `dayhand pair`, approves and disconnects **agent connections** such as the Claude app, and
turns on the read-only **calendar address** for Google and Apple Calendar.

**Install**: the signed release build is ready, but no release is published yet. Once it is,
download the `.apk` from the [latest release](https://github.com/maiarowsky/dayhand/releases/latest),
allow your browser or file manager to install apps when Android asks, and on the first start
choose **On this phone only** to use Dayhand without a server. What works without a server, what
needs one and how to connect your own: [On the phone](../README.md#on-the-phone). To build it yourself, see
[Run it locally](#run-it-locally) and [Release build](#release-build).

Dayhand works **on this phone only**, without an account or a server, and that is what the first
start offers first: the plan lives in Room, reminders and the morning summary ring from the phone,
and a **backup file** (Dayhand's JSON export format) can be saved, shared and restored. A server of
your own can be connected later; everything made on the phone then goes to it
(["On this phone only"](#on-this-phone-only)).

- Application id `io.github.maiarowsky.dayhand` (fixed from the first public release; it cannot
  change once people have installed it). The code keeps the namespace `dev.helm.planner` from
  before the rename (and with it the names of the database and settings on the phone), so
  the launcher activity is `io.github.maiarowsky.dayhand/dev.helm.planner.MainActivity`. Builds
  with the earlier id `dev.helm.planner` are a different app and install side by side.
- Version 0.13.4 (`versionName`: 0.x, MINOR for each step that adds screens, PATCH for fixes and
  polish); `versionCode` is the number of commits on `HEAD`.
- minSdk 26, compileSdk and targetSdk 36 (see "Dependencies" for why not 37 yet).
- Eight languages: English (the source and the default), Polski, Deutsch, Español, Français,
  Português (Brasil), 日本語 and 简体中文, with dates in the order and words of the language;
  text that follows the system font size, touch targets of at least 48 dp and descriptions for
  screen readers.
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

Since 0.13.4 the arrows next to the title (`HelmButton`s of 48 dp) show the day before and after:
open tasks due that day and those done on it (`daySections`), titled **Tomorrow**, **Yesterday** or
the weekday with the date under it; a tap on that title returns to today, the day shown survives a
rotation and the system ending the app (`SavedStateHandle`), and quick add opened there proposes
that day. Ticking a task off completes it at once; the row then stays 360 ms (`LeavingTasks`: the
box fills and the title is struck through in 180 ms, then the row fades in 180 ms) and the rows
under it move up. With animations off in the system settings the row stays still and ticked for
600 ms instead.

With nothing to do, one sentence and an **Add task** button. A line at the top says when the
phone is offline (and how many changes wait), while changes are being sent, or when the server
signed the phone out; on this phone only there is no such line. While the sample plan is on the
phone, a line says so with **Remove them**, which removes every sample task.

With a server (backend 0.11.0 or later), a **plan health** card sits under those lines: one
sentence with what needs a look, the most pressing first, and only what is there: agents paused,
overdue, claims that ran out, approval requests, blocked tasks, proposals, tasks done today
without proof, due today, in progress, done today, and the oldest open task when it is two weeks
old or more (`app:planHealth`, the same report as `plan_health` and `dayhand health`). It is red
when agents are paused or something is late, amber when the owner is asked for something, and
**Review** opens Agents when there is a request or a proposal to decide. It is read when Today
opens, when Dayhand comes back to the front and when the tasks change; offline it keeps the last
report, and without a server it is not shown.

**First start** asks where the plan lives (**Welcome to Dayhand**), on two cards, the phone first:

1. **On this phone only**: no account and no server. **Start with an empty plan**, or **Try with
   sample data**: two overdue tasks, the "now" task with its note, today's tasks (a checklist, a
   repeating stand-up, a task with its own reminder), something done, a timed task on every other
   day of this week (done before today), a task in progress with a link, one without a day and
   the projects Home, Work and Health, in the app's language. Sample tasks (`sample-` ids,
   `sample/SamplePlan.kt`) change only on the phone: the outbox never sends them, and they go with
   one tap (Today's line or Settings → Data) or when the phone connects to a server.
2. **Connect to my server** opens the pairing form below. Back returns to the two cards; leaving
   the first start any other way is on this phone only.

**Connect to my server** (the form) opens from the first start, from Settings and from a
`dayhand://pair` link (the QR code of `dayhand pair`):

1. **Server address**: the link's `url`, else the last server used, else the built-in default
   (`BuildConfig.DEFAULT_SERVER_URL`), which is **empty** unless the build sets
   `-Pdayhand.serverUrl=…`. Public builds leave it empty, so the form starts with an empty address;
   the author builds their own copy with
   `-Pdayhand.serverUrl=https://example-deployment-123.eu-west-1.convex.site`. A `.convex.cloud`
   address is turned into its `.convex.site` one.
2. **Pairing code** from `dayhand pair`: any case, with or
   without dashes; `O` is read as `0`, `I` and `L` as `1`.
3. **Connect**. Errors are said in words: a wrong, used or expired code; too many wrong codes
   (with the wait); no network; the server cannot be reached; no Dayhand server at the address;
   a problem on the server. A code for **another server** than the one whose plan is on the
   phone first asks **Replace the plan on this phone?** (see ["On this phone only"](#on-this-phone-only)).

Tapping a task opens its details. The bar at the bottom switches between Today (where the app
opens), the calendar, the board and **Projects**.

**Projects**: a flat, manually ordered list with open and overdue counts, **No project**,
**Archived** and **Trash**; with no project yet, a sentence and a **New project** button under No
project. A project has a unique name (1–50 characters, case-insensitive, including
archived projects; `none` is reserved), one of twelve named colours, an optional single emoji and
a note. Add with **+**; long-press a project to edit, archive or delete it. **Set order** exposes drag
handles and Move up/down buttons and screen-reader actions. Archiving optionally archives the open
tasks too; otherwise its tasks stay in Today, Calendar and Board with a neutral marker. Deleting
keeps every task, including those in the trash, and asks for a destination (another project or No
project). Creating, editing, archiving, reordering and deleting require a server connection (also when
unpaired).
They execute on the server, not through the offline queue; without a connection the app says
**Requires a connection to the server** and keeps the current project unchanged.

A project or No project opens its task list: Overdue, Today, Later, No day and the fifty
latest Done (collapsed). In a real project, **List / Board** switches to the existing board
filtered to that project; No project offers only the list. A project's **+** preselects
it in quick add; archived projects and unpaired demo projects cannot receive new tasks.
The same project picker (with search above eight active projects and New project in place) is in
quick add's More options, task details and the menus on Today, Board and the calendar's day sheet.
With no project to offer it says so and makes **New project** a full button; the new project is
assigned at once.
Project dots meet 3:1 on the surfaces of every palette; the name remains readable text, never
colour alone. Deploy backend **0.13.2 or later before Android 0.12.0**: it confirms offline
repeat restoration without opening an archived project.

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
optional time, repeat, reminders, a checklist, links (http/https only; no files in version 1)
and the note. **Project** uses the shared picker to assign or clear the task's single project.
Since 0.13.4 there are no labels in the app: they are not shown, stored or sent, a server response
that still has them is read without them, and the database drops them (version 7). The title takes
at most two lines (**Show the whole title** unfolds it). Everything above the note is one card
(`TaskSummary`): status, due day (its menu holds the time and removing the day) and project as
chips in one row, wrapping only when they do not fit, and one folded **More** row naming the rest
with its values (now, proof, repeat, reminders, checklist, links). On a 360 × 780 dp phone the note
starts at 380 dp (0.13.3: 444 dp). The note folds after about eight lines (**Show the whole
note**); the change history follows right under it with its last three entries and **Show the
whole history**. The note is edited in a modal bottom sheet (`LongTextEditor`): the phone's width,
nine tenths of its height, a handle, Cancel, the title and Save in a bar on top above the keyboard;
Back cancels; one-line fields (title, checklist item) keep their compact dialogs. Field names are
small and muted, values larger in the text colour, and values and notes use the phone's sans-serif
when the app font is monospaced.
Every button is `HelmButton` in the shape of Mussh's Send button (`HelmButtonShape`): a filled pill
without an outline, 34 dp high (a 34 dp circle around an icon), in a 48 × 48 dp touch target, in
one of four tones (accent, soft accent, danger, quiet); a disabled one is drawn on the raised
colour with faint text. Chips, fields and tiles are not buttons and keep their own shapes.
Since 0.9.1 it also shows the agent's acceptance criteria with the met ones ticked, and the proof the task was
completed with, read-only (backend 0.10.0, [agent-work.md](../docs/agent-work.md)). The owner's own
changes always go through. Since 0.11.0 the **Agent** card shows "agent: \<name\> works until
\<time\>" while a claim lasts, the blocked reason in red, the tasks it waits for ("#12 Send the
invoice (done)") and the plan. These fields are read-only except for **End the claim** under a
live claim: after a confirmation the claim ends on the phone at once and `app:release` goes
through the outbox. On Today and the board, "⛔" before a title marks an unfinished task with a
blocked reason or a known open dependency; screen readers hear why. Dependencies in the trash
do not hold it back. Dependencies absent from the phone appear as "A task not on this phone"
without a completed mark and do not add a blocked mark: they may be proposals or purged tasks,
so the phone's marks can differ from the server's plan health report.
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
**Change history** lists who changed what, newest first: **You (app)**, **You (CLI)** (`dayhand` with a
`cli` key) or **Agent**.

**Trash**: tasks deleted by you or the agent, newest first, with the day each one goes for good;
**Restore** brings one back.

**Quick add**: the button at the bottom opens a sheet with one title field; one tap (or the
keyboard's Done key) saves it for today by default. A date phrase at the end of the title sets the day and
time: "Call the accountant fri 2pm" is "Call the accountant" on the coming Friday at 14:00. The
phrases are English, the grammar of `dayhand add --due` (`today`, `tomorrow 9am`, `fri`, `next mon`,
`in 3 days`, `23 oct`, `2026-10-23`, `2pm`; all of them in `dayhand help dates`), read in the
server's time zone, or the phone's on this phone only. The longest phrase at the end wins and at
least one word stays the title, so a title that is only "tomorrow" stays a title. A grey line under
the field says what will happen: "Friday 23 Oct, 14:00 · from “fri 2pm”", or "No date phrase:
today" (or the day shown on Today); **Keep in title** keeps the words as text, until the title
changes. "More options" adds the day, a time and a note; a day or time picked there wins over the
phrase, which then stays in the title. The grammar is ported from `cli/src/when/parse.ts` (`domain/When.kt`, `domain/QuickAdd.kt`),
and `WhenParserTest` runs every case of `linux/tests/cases/when.json`, shared with the CLI, macOS
and Linux. A known `+Project-name` token sets the project, case-insensitively (hyphens stand for
spaces); it works before or after the date phrase. Unknown or archived names remain in the title
with a hint, and never create a project by accident. `linux/tests/cases/quickadd-project.json`
holds the shared project cases.

**Settings** is laid out like Mussh's: groups under upper-case labels, one row per setting with a
thin outline icon, the name, a short current value and "›". Each row opens its own page with the
choice, what it means and, where something is missing, the one button that fixes it; Back returns
to the list. Settings are drawn in the system sans whatever the font (as in Mussh); the font shows
in its preview and on the other screens. Top to bottom:

1. **Appearance**: **Theme** (system, light or dark), **Color palette** (a dark and a light
   palette, each from the Mussh palettes, with a preview of both) and **Font** (system, Inter,
   IBM Plex Sans, Atkinson Hyperlegible, Geist, Source Serif 4 or JetBrains Mono, each shown in
   itself); **Language** (phone language or one of the eight, each in its own name; Android 13+ per-app
   language, the same choice as the system's App languages; older phones follow the phone). The
   appearance is stored on the phone and applies at once, without a restart.
2. **Notifications**: **Notifications and alarms** (on, off, or "needs fixing" when exact alarms
   are missing; the page says what each means and has a button that asks Android (13+) or opens
   the system settings, and one that allows exact alarms); **Morning summary** (the time, default
   05:00, picked on a clock); **Default reminders** (at the due time, 5, 10, 15, 30 min, 1 h, 2 h
   or 1 day before, any number of them or none).
3. **Data**: **Backup**, the plan on this phone as a file in Dayhand's JSON export format: **Save a
   backup file** (the system save dialog), **Share a backup** (the share sheet, from the app's
   cache through its `FileProvider`) and **Restore from a file**, with the time of the last
   backup and what the last action did; see [Backups](#backups). **Remove sample tasks** while
   the sample plan is on the phone. With a server also: **Export**, the whole plan from the
   server as Markdown or JSON (with the change history), saved where you choose in the system
   dialog. **Calendar**: the read-only iCalendar address of the plan
   ([docs/calendar.md](../docs/calendar.md)): turn it on, then copy it, add it to Google Calendar
   ("From URL", opened in the browser) or share the `webcal://` address to Apple Calendar;
   **Create a new address** replaces it (the old one stops working) and **Turn off** removes it,
   each after a confirmation. The address is a secret and the page says so; it is read from the
   server each time the page opens, never stored on the phone. **Export .ics** makes a one-time
   file of the plan and hands it to the share sheet (to import into any calendar).
4. **Connection**: **Server**. On this phone only: that it is so (and, after a Disconnect, the
   server its changes wait for), **Connect to my server**, and how a server of your own is set
   up; the time zone is the phone's. Connected: the status (connected, connecting, no network,
   signed out, cannot reach the server) and the number of changes waiting, the server and this
   phone's name with **Disconnect** (after a confirmation that names the `dayhand revoke <deviceId>`
   command); the time zone is the server's, with **Use this phone's time zone** when the two
   differ. **Agent connections** (with a server): the agents connected with
   OAuth, such as the Claude app ([docs/oauth.md](../docs/oauth.md)), each with where it comes
   from, read only or read and change, and its last use; tapping one disconnects it after a
   confirmation. **Approve a connection** takes the code the agent's sign-in page shows, then
   shows who asks (identified by its host, or "registered itself" with an unverified name),
   where the answer goes, when it asked (with a warning when the request is minutes old or the
   answer goes to a program on the computer) and a switch per permission; **Approve** or
   **Refuse** answers the page, which continues by itself.
   **Agents** (with a server, backend 0.11.0 or later; [agent-work.md](../docs/agent-work.md)):
   **Pause agents**, one switch that refuses every change from every agent key and agent
   connection while reading still works; the approval requests **waiting for you**, each with
   who asks, the task, whether it can be undone and the time to decide by, and the ten latest
   decided or expired ones; the **proposals** with who asked and their source; and the **tool
   policies**, one row per rule ("Key claude: complete_task → Ask"). A rule opens on its own page
   with **Allow**, **Ask** and **Deny**, each with what it does for that key and tool; tapping
   another one sends it to the server at once (`app:setToolPolicy`, not through the outbox, so it
   needs a connection). After a successful save, the list says "Rule saved" and `dayhand policy`
   reflects the change. **Allow** is the default and removes the row unless it overrides a
   non-Allow `*` rule for that key. A final refusal returns to the list and says why: a key revoked
   meanwhile ("this agent key was revoked or removed") or a rule the server does not take. If the
   phone is signed out, offline, times out or no longer has a server configured, the policy page
   stays open with "No connection to the server. Try again." and the last displayed rule still
   selected; tap the desired rule again to retry. New rules for other keys or tools are added in
   the terminal with `dayhand policy set`. A request opens on its own page in
   the style of a connection's approval: what the agent wants to do and why, a row per option with
   its consequence, and a confirmation with an optional word for the agent. A proposal is
   **accepted** (it becomes a task of the plan), **merged** into an open task found by its title
   (its note and links join that task) or **rejected** with an optional reason. Dayhand
   records the decision; it cannot stop what an agent does outside Dayhand. Agent changes run
   one at a time: the pause switch, rule choices and decision buttons stay disabled until the
   current send and any follow-up refresh finish, even if you reopen a rule.
5. **About**: the Apache License 2.0, the licenses of the bundled fonts (SIL Open Font License
   1.1) and the version.

The summary time and default reminders are kept on the phone with or without a server. With a
server they are server settings (`summaryTime`, `defaultReminderMinutes`), so the agent sees and
can change them too: a change on the phone is stored at once and sent through the outbox
(`app:updateSettings`) like any other change, and a snapshot does not undo it while it waits.
Changes made on this phone only wait in the outbox too and reach the first server connected.

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
- Times are read in the zone that decides "today": on this phone only the **phone's own time
  zone** (followed when it changes, `TIMEZONE_CHANGED`), with a server the **server's**, so the
  phone and the agent agree. A time of day the spring clock change skips rings after the gap
  (01:30 on 29 Mar in London rings at 02:30 BST).

How: `ReminderEngine` keeps exactly **two alarms** in AlarmManager, the next reminder and the
next summary. When one fires, `AlarmReceiver` shows what is due and arms the next one. Alarms
are exact (`setExactAndAllowWhileIdle`) when the user allows exact alarms (Android 12+; off by
default from Android 14), otherwise inexact and possibly a few minutes late; Settings says
which. They are armed again on every change of tasks or reminder settings, at app start, after
a reboot, an app update, a clock or time zone change and a change of the exact-alarm
permission (`SystemEventsReceiver`). After a force stop Android drops the alarms until Dayhand is
opened again. A reminder's **Done** button completes the task offline-first, like a tap on
Today. Android 13+ asks for the notification permission when the first task with a time is
added, or from Settings.

## Approval requests while Dayhand is closed

The server cannot push to the phone (the app has no Firebase or other push service), so a
periodic WorkManager job (`agents/ApprovalPoll.kt`) asks for pending requests every 15 minutes,
WorkManager's shortest period, while the phone is connected to a server and has a network. Each
new request becomes one notification in the **Approval requests** channel (who asks and what),
shown once; a tap opens Agents, and deciding it in the app removes the notification. A request
can therefore wait up to about 15 minutes, longer while the phone is in Doze, before the phone
shows it; one that expires first is never shown. Without the notification permission nothing is
shown, and Agents and the health card still list the requests.

## How offline works

```
tap ──> Room transaction: change the task row + append to outbox ──> screen updates at once
                                                │
            WorkManager (needs network) ── sends the outbox in order over
            POST /api/mutation, deletes a record only after the server answered
                                                │
Convex subscription (app:listAll, app:listTrash, app:listProjects, app:getSettings) ──> SnapshotMerger ──> Room
```

- **Room is the source of truth for the screens.** Task edits appear at once; project management
  waits for the server to confirm the command.
- **Outbox** (`outbox` table): one record per change with `opId`, mutation name, arguments,
  time and a `clientId`. The backend applies an operation with a known `clientId` only once, so
  a change resent after a lost answer is not applied twice. A new task's `clientId` is its local
  id, which is also how the server copy is matched to the local row.
- **WorkManager** sends the outbox strictly in order and stops at the first failure, so nothing
  overtakes an earlier change. The request survives the app being killed and the phone
  restarting. After a force stop, Android runs it again once the app is opened.
- **Projects**: Room schema 6 and AutoMigration(5,6) preserve existing tasks and the task outbox,
  adding the project cache and a server-confirmed `projectId` on tasks. Project management is
  online-only; there are no project commands or local project references in the outbox, and no
  name-conflict linking. Task edits and assignments to previously confirmed active projects still
  work offline and append at the end of the task queue. If another device deletes or archives a
  target before an assignment reaches the server, the task and later edits are kept: only the
  refused assignment and its dependent repeat proof are cleared, and a refused move leaves the task
  in its previous server project. The project is never reopened
  as conflict recovery. Sample projects never leave the phone; removing them also clears any old
  sample assignment and its dependent proof without losing the task.
  A locally calculated repeat carries the parent's local id, its completion operation id and the
  phone's completion day. At send time these become `app:add.repeatedFrom`: backend 0.13.2 checks
  the repeat-clear and completion history, the next date/rule and the same project, deduplicates
  by clientId, and permits that one inherited occurrence even in an archived project. If the
  server refuses the proof (or the parent never reached it), the occurrence is sent as an ordinary
  task; only an older backend that cannot read the proof keeps it waiting in the outbox. It is
  never erased with its later edits.
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
  normally takes a server copy only when it is newer than the one merged before. Version
  invalidation can force reconciliation even at the same version; the merge rules are in
  `sync/SnapshotMerger.kt`.
- **Today and overdue** are computed on the phone by `HelmDates` and `todaySections`, the same
  rules as `backend/convex/lib/dates.ts`, in the phone's time zone on this phone only and in the
  server's when connected (default `Europe/London`, as on the backend). The screen moves on at
  local midnight.

## On this phone only

Without a server Room is the whole plan, and every change still goes into the outbox, where it
waits (WorkManager finds no server and stops). Nothing leaves the phone.

- **Repeating tasks**: the server adds a repeating task's next occurrence when it is completed;
  without one the phone does (`Recurrence.advance`, the backend's `advance`). The done task
  loses its rule and the next one is queued as a task of its own (`app:update {repeat: null}`,
  `app:complete`, `app:add` with every field), so a server connected later does not add another.
- **Connecting later** (the first server): the outbox sends everything in order, the tasks made
  on the phone included (their `clientId` is their local id, which is also how the server copy
  finds its row), then the live subscription brings the server's plan. Sample tasks stay behind
  and are removed before the sign-in is stored. Settings changes made on the phone reach the
  server; its time zone then applies, and Settings offers the phone's when they differ.
- **Disconnect** keeps the plan and its waiting changes: they belong to that server and go there
  when the phone connects to it again (no question asked).
- **Another server**: a code for another address than the server last paired with (`serverUrl`,
  kept after Disconnect) is not used before the user agrees to **Replace the plan on this
  phone?**, which says how many tasks and projects (including notes) go from the phone and how
  many changes would never be sent, and how to keep them (a backup, or connecting to the old
  server). A plan containing only projects also requires this confirmation. **Replace and connect**
  empties the phone (tasks, projects, history, outbox) before the new sign-in is stored, so nothing of the
  old plan reaches the new server; **Cancel** leaves everything as it was. A phone that never had
  a server needs no question. (One deployment has one owner, so another account is another
  address; `auth/PlanSwitch.kt`.)

## Backups

**Android's Auto Backup is off** (`android:allowBackup="false"`, and `data_extraction_rules.xml`
excludes every domain from cloud backup and device transfer), so the Room database, the settings
and the encrypted device token go neither to Google Drive nor to a new phone. On this phone only
that makes the backup file the only copy outside the phone, and Settings → Data → Backup says so.
Why: "nothing leaves the phone" is what on this phone only promises; the device token and its
Tink keyset are bound to a Keystore key that a restore cannot bring back; and a restored outbox
and server copy of another phone would be hard to reason about.

The **backup file** (`backup/PlanBackup.kt`) is Dayhand's JSON export format, version 1, as
`app:exportPlan` and `dayhand export --format json` write it (`docs/schemas/export.schema.json`):
`version`, `exportedAt`, `settings`, `projects`, `tasks` (with the server id where the server knows a task,
else the phone's, and `projectId`) and an empty `events`. Project names, colours, icons, notes,
order and archive state are kept. Tasks and projects are read in one Room transaction. Restoring
a file containing projects requires a connection: projects are matched by name or created directly
on the server (one archived in the file is archived right after creation), tasks use their confirmed
ids, and an archived project is never reopened: its tasks are restored without a project.
The combined existing/imported project count is checked before changes (at most 200). Project
management is not queued if the connection fails; restore reports the failure rather than crashing. Task numbers (`ref`), cached change history and agent-work
fields (including the plan, dependencies and blocked reason) are not included. Sample tasks are
not in it. A server reads it (`dayhand import`, `POST /api/v1/import`, format `dayhand-json`), and
so does **Restore from a file**: every task the backend's rules accept
is added as a new task and queued like one added on the phone (a done task without its rule, so
a server does not repeat it again; archived tasks archived); one whose id is already on the
phone is skipped, so the same file restores once; tasks in the trash and tasks that fail a check
are counted, not restored. On this phone only the backup's summary time and default reminders
are restored too; with a server its settings stay. At most 2000 tasks, as the server's import.

## Signing in

The phone is paired once and then asks the server for short-lived app tokens
([docs/pairing.md](../docs/pairing.md)):

```
Connect: POST /auth/pair {code, deviceName}  ──> deviceToken + convexUrl (stored encrypted)
any time: POST /auth/token {deviceToken}       ──> app JWT for 1 hour (kept in memory only)
Convex client and HTTP API with that JWT       ──> app.* as the owner
```

- The **device token** is encrypted with AES-256-GCM by Tink under a key in the Android
  Keystore and never logged or shown. Backups and device transfers are switched off for the app
  ([Backups](#backups)).
  The device name sent is the phone model (`Build.MODEL`); `dayhand devices` shows it.
- `DeviceTokens` keeps one JWT for the live feed, the outbox and the export, and fetches a new
  one when less than 5 minutes are left. The Convex client gets the new token before the old
  one ends, and asks again when the server refuses one; the HTTP API retries once with a new
  token.
- **Network errors and `503`** keep the device token; a cached JWT that is still valid is used
  meanwhile, and changes wait in the outbox. **`401` from `/auth/token`** means the phone was
  revoked (`dayhand revoke`): the device token is deleted, Today and Settings say the server signed
  the phone out, and Connect asks for a new code. Tasks and waiting changes stay on the phone.
- On a local backend `/auth/pair` returns `http://127.0.0.1:3210` as the Convex URL; the app
  keeps the port and uses the host it paired with (`10.0.2.2` on the emulator).
- **Disconnect** forgets the sign-in on the phone only. The backend has no endpoint for a
  device to revoke itself, so the dialog names `dayhand revoke <deviceId>` for that.
- A phone that had an app token pasted in version 0.2 keeps using it until it is paired or
  disconnected; pasting tokens is no longer offered.

What happens after connecting: the outbox starts at once and sends every change made before,
in order (tasks added on this phone only before any server was known included), and the live
Convex subscription downloads the whole plan into Room. The connection line shows the progress.
Sample tasks are not sent, and a code for another server than the one whose plan is on the
phone asks first ([On this phone only](#on-this-phone-only)).

## Run it locally

Requirements: JDK 17 or newer, the Android SDK with platform 36, Node.js 20+ for the backend.

1. Start the backend (see the top-level README), in `backend/`:

   ```sh
   npm ci --ignore-scripts
   npm run backend:start
   ```

2. In a second terminal, in `backend/`, create a CLI key for the app user and a pairing code
   (with the CLI built in `cli/`: `npm ci --ignore-scripts && npm run build`):

   ```sh
   npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"cli","kind":"cli"}'
   export DAYHAND_URL=http://127.0.0.1:3211 DAYHAND_API_KEY=<key>
   node ../cli/dist/bin/dayhand.js pair          # or dayhand pair, with dayhand installed (docs/install.md)
   ```

   Optionally set your time zone:
   `npx convex run ops:updateSettings '{"userId":"https://helm.local|me","actor":"app","timezone":"Europe/Warsaw"}'`

3. Build and install the app (in `android/`):

   ```sh
   ./gradlew :app:installDebug
   ```

4. In the app, on Connect, enter `http://10.0.2.2:3211` on the emulator (on a phone in the
   same network use the computer's address; debug builds allow plain HTTP, release builds only
   HTTPS) and the code, then Connect. Or open the link from `dayhand pair` on the emulator:
   `adb shell am start -a android.intent.action.VIEW -d "'dayhand://pair?url=http%3A%2F%2F10.0.2.2%3A3211&code=<code>'"`.

5. Check from the computer: `dayhand today` and `dayhand device list`.

For a production deployment see [docs/deploy.md](../docs/deploy.md); the app's default server
(empty unless set) is `-Pdayhand.serverUrl=…`, read in `app/build.gradle.kts`.

## Release build

The APK on the releases page is `assembleRelease` signed with the project's release key, which
is kept outside the repository. Point the build at the keystore with environment variables:

```sh
export DAYHAND_RELEASE_KEYSTORE=~/.config/dayhand-release/release.p12        # PKCS12
export DAYHAND_RELEASE_PASSWORD_FILE=~/.config/dayhand-release/keystore-password  # one line, store and key password
# DAYHAND_RELEASE_KEY_ALIAS defaults to helm, the alias of the key made before the rename
./gradlew :app:assembleRelease
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

Without `DAYHAND_RELEASE_KEYSTORE` the release APK is left unsigned; debug builds and tests never
use the key. Every update must be signed with the same key, or Android refuses to install it
over the installed app: keep a copy of the keystore and its password somewhere safe.

## Tests

```sh
./gradlew :app:testDebugUnitTest            # JVM + Robolectric: projects, Room 5→6→7, Compose project/picker flows; dates, repeat dates, Today, calendar days, board, rules, history, reminders, outbox, merge,
                                            # HTTP, export, pairing input, /auth/pair and /auth/token, token refresh,
                                            # agent connections (answers, code input, approval flow), calendar address,
                                            # backup file (write, read, the server's export), sample plan, another server,
                                            # agents (answers, requests, proposals, the switch, tool policies and their refusals,
                                            # the health card, new requests)
                                            # translations (keys, placeholders, plural forms) and the language picker's tags
./gradlew :app:lintDebug                    # missing or extra translations and plural forms are errors
./gradlew :app:connectedDebugAndroidTest    # emulator: Room and its migrations, outbox across restarts, settings sync and the phone's zone,
                                            # on this phone only (repeats made on the phone, sample tasks, restore, emptying),
                                            # Compose (Today, calendar, board, details, Settings, Settings → Calendar and Backup, Connect,
                                            # agent connections, Agents and the health card), encrypted pairing storage, and a real alarm + notification
                                            # (ReminderDeliveryTest, about 80 s, with no server configured),
                                            # the eight languages and switching them in Settings (LanguageSwitchTest)
```

Project integration against a real local backend is opt-in: set `DAYHAND_ANDROID_TEST_URL` to
its loopback Convex API URL and `DAYHAND_ANDROID_TEST_TOKEN` to a temporary app JWT, then run
`:app:testDebugUnitTest`. Without them the `ProjectBackendTest` and `ArchivedProjectRepeatTest`
integration cases are skipped. They refuse non-loopback URLs. These cover online-only management,
offline task assignments, refused targets, conversion/delete, ordering limits, backup restore,
owner-switch isolation and archived-repeat replay against the actual app mutations. Robolectric's Android 34 runtime and all of its
dependencies are pinned in the Gradle lockfile; its own Maven downloader is disabled.

`AgentsRefreshRaceTest` covers overlapping control reads and the busy interval of agent changes,
releasing held replies newest first and holding a pause mutation in flight.

`ReminderDeliveryTest` speeds time up by setting a task and the summary to the next whole
minute: Android fires the real alarm, the test checks both notifications and taps **Done**.

The end-to-end checks drive the app on an emulator against the local backend and pair it with
a code from the CLI. `e2e-local.py`: the first start offers on this phone only first; the sample
plan on Today, the calendar and the board, removed with one tap; a task of one's own next to the
sample plan, a shared backup (pulled with `run-as`, optionally dry-run through the server's
import with `--import-check`); pairing sends the own task and none of the sample tasks; after
Disconnect a code for another address asks before replacing the plan, Cancel keeps it, Replace
empties the phone first so the waiting task never reaches the server; the same server again
needs no question. `e2e-pairing.py`: first start, on this phone only, a task added before pairing,
a wrong code refused, the right one typed by hand, the CLI's task on the phone and the phone's
on the server, a task added in airplane mode reaching the server when the network is back,
Disconnect. `e2e-offline.py`: the same offline path with a killed and a force-stopped app. With
the backend running, `DAYHAND_URL`/`DAYHAND_API_KEY` set and the CLI built (`cli/`: `npm ci
--ignore-scripts && npm run build`):

```sh
./gradlew :app:assembleDebug
python3 scripts/e2e-local.py --apk app/build/outputs/apk/debug/app-debug.apk --shots /tmp/shots --import-check
python3 scripts/e2e-pairing.py --apk app/build/outputs/apk/debug/app-debug.apk --shots /tmp/shots
python3 scripts/e2e-offline.py --apk app/build/outputs/apk/debug/app-debug.apk
```

`scripts/e2e-projects.py` checks that unpaired/offline project creation is refused, pairs the
phone, creates a project online, adds its task offline, switches List/Board, takes light/dark
screenshots and verifies both ids through `dayhand call list_projects --json` and `dayhand list`.
It uses one task-owned emulator for that whole feature run.

`scripts/e2e-board-details.py` (same arguments) checks the board and details the same way: a task
added by the agent is dragged to "In progress", moved to "Done" from its menu, renamed and given a
time and a link; offline it goes to the trash and the change reaches the server after the
app was killed; it is restored from the Trash screen, and an agent edit shows in its history as
the agent's. Every step is checked on the server through MCP, with an agent key of the same user
in `DAYHAND_AGENT_KEY` (`npx convex run apiKeys:create '{"userId":"https://helm.local|me","actor":"app","name":"agent","kind":"agent"}'`).

`scripts/e2e-agent-work.py` (same arguments and keys) checks the agent work in the details:
`dayhand` adds a task that waits for two others (`--depends-on`), with `--blocked` and `--plan`,
and completes one of them, and the agent claims it through MCP; the phone shows "⛔" on Today and
the board, and in the details the claim, the blocked reason, "#n … (done)" and the plan; **End the
claim** is confirmed on the phone and `dayhand show` then has no claim.

`scripts/e2e-tool-policy.py` (same arguments; `DAYHAND_API_KEY` must be a `cli` key) checks
editing tool policies: `dayhand` creates two agent keys with `ask` for `complete_task`; on the
phone the rule of the first is opened in Settings → Agents and set to **Deny**, and `dayhand policy`
must then print `deny`; the second key is revoked with `dayhand key revoke` while the phone still
lists it, and choosing a rule for it must show "The server did not change the rule: this agent
key was revoked or removed."

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
