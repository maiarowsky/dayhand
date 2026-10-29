# Dayhand for Android

The Android app is the fullest Dayhand client: Today with quick add, the week and day calendar, the
board, projects, task details with repeats, checklists and reminders, the trash, a backup file, and, with a
server, phone pairing, the calendar address, agent connections and the controls for your agents. It
works offline, and reminders and the morning summary are worked out on the phone.

It runs on Android 8.0 or newer and speaks English, Polish, German, Spanish, French, Brazilian
Portuguese, Japanese and Simplified Chinese. No APK is published yet; [Install](install.md#android)
says how to build it. How the app is built and tested: [android/README.md](../android/README.md).

## First start: where the plan lives

The first start asks where your plan lives, on two cards:

- **On this phone only**: no account and no server. **Start with an empty plan**, or **Try with
  sample data** to look around first: a few overdue, today's and done tasks, a repeating one, a
  checklist and three projects. One tap removes the sample tasks (on Today, or Settings → Data), and they are
  never sent to a server.
- **Connect to my server**: the pairing form ([below](#connect-to-your-server)). Back returns to the
  two cards.

Without a server, the plan lives only on this phone. Android's own backup is off for Dayhand, so
keep a backup file ([Backups](#backups)).

## Today

From top to bottom:

1. **Overdue**: not done and due before today in your time zone. Tick it off, move it **To today**,
   or pick another day or archive it from the menu.
2. **Now**: the one task you are working on, with "where I stopped / next step" under its title. Tap
   the note to edit it. Choose the task with **Work on it now** in a task's menu.
3. **Today**: tasks due today, timed ones first, by time.
4. **Done**: what you finished today, folded.

The arrows next to the title show the day before and the day after: that day's tasks and what you finished
on it, with **Tomorrow**, **Yesterday** or the weekday as the title and the date under it. Tap the title to
come back to today. A task added while another day is shown is due on that day.

Ticking a task off saves it at once; its row stays a moment (the box fills, the title is struck through,
the row fades) so you see which one you ticked, then the rows under it move up. With the phone's
animations turned off the row stays still, ticked, for a moment instead.

A line at the top says when the phone is offline and how many changes wait, while changes are sent,
or when the server signed the phone out.

With a server, a **plan health** card sits above the lists: one sentence with what needs a look, the
most pressing first (agents paused, overdue tasks, claims that ran out, approval requests, blocked
tasks, proposals, tasks done today without proof). It is red when agents are paused or something is
late and amber when you are asked for something; **Review** opens the agents page.

### Quick add

The button at the bottom opens one title field. A date phrase at the end sets the day and time:
"Call the accountant fri 2pm" is "Call the accountant" on the coming Friday at 14:00. Without a
phrase, the task is for today, or for the day shown on Today. A grey line under the field says what
will happen; **Keep in title** keeps the words as text. **More options** adds a day, a time and a note.

The phrases are English in every language of the app, the same as `dayhand add --due`: `today`,
`tomorrow 9am`, `fri`, `next mon`, `in 3 days`, `23 oct`, `2026-10-23`, `2pm`. The full list:
[dates](cli.md#topic-dates).

`+Project-name` anywhere in the line puts the task in a project that exists, in any case, with hyphens
for spaces: "Order business cards +Bakery-website fri". A name that matches no active project stays in
the title, with a hint. **More options** also has the project picker.

## Calendar

The bar at the bottom switches between Today, the calendar, the board and Projects.

- **Week** shows Monday to Sunday on an hour grid, **Day** one day. Swipe or use the arrows to turn.
- Tasks with a time are blocks at their hour; tasks without a time sit in a band above the hours.
  On a phone held upright the week shows them as bars without titles; tap a day for its titles, or
  long-press a day for a list with **Move** on each task.
- **Long-press a task and drag it** to another day and time. It snaps to a quarter of an hour; drop
  it on the day headers or the band to remove its time. **Undo** in the message puts it back.
- Overdue tasks are marked **!**, later dates of a repeating task **↻** and done tasks **✓**. Later
  dates of a series and done tasks do not move.

## Board

Three columns: **To do**, **In progress** (with the now task first) and **Done** (the 50 most
recently done). On a phone one column shows at a time under tabs; from 600 dp wide they sit side by
side. Long-press a card and drag it to another column or tab, or use the card's menu. The bin icon
opens the trash.

## Projects

The **Projects** tab lists only projects: yours in your order, each with its colour, its emoji and the
number of open and overdue tasks, then **No project**, **Archived** and **Trash**. Without any project
yet, a sentence under **No project** says so, with a **New project** button. Tap a project for its tasks:
overdue, today, later, without a day and the latest done. A project also has **List / Board**, and its
**+** adds a task to it.

- **+** at the top makes a project: a name, one of twelve colours, an optional emoji and a note on what
  it is about. Long-press a project to edit, archive or delete it; **Set order** shows handles to drag
  and buttons to move a project up or down.
- **Archive** keeps the project's tasks where they are, in Today, the calendar and the board; a switch
  archives its open tasks too. **Delete** asks where its tasks go, to another project or to No project;
  no task is deleted.
- The project picker (task details, quick add, a task's menu) lists the projects you can assign. With
  none yet, it says so and offers **New project**; the project you make there is assigned at once.
- Managing projects needs your server: offline, or without a server, the app says **Requires a connection
  to the server** and changes nothing. Putting a task into a project works offline.

The rules for projects: [projects.md](projects.md).

## Task details

Tap a task to open it. You can change its title, status, the now flag and its note, the day with an
optional time, the repeat, reminders, a checklist and links (http and https only).

The title shows two lines, with **Show the whole title** when it is longer. One card under it holds the rest
in as little room as it takes: the status, the due day (red once it has passed) and the project as three
chips in one row; tap one to change it (the due day's menu also adds, changes or removes the time and
removes the day). Under them one row, **More**, names everything else with its value ("Does not repeat ·
Default reminders · Checklist 1 of 3 done"); tap it for work on it now, the proof the task was completed
with, the repeat, reminders, the checklist and the links. The note follows, with a small gap between its
paragraphs; a note longer than about eight lines is folded with **Show the whole note**. Tap the note to
edit it in a sheet over most of the screen, as wide as the phone: **Cancel** and **Save** stay on top above
the keyboard, and Back cancels too, so nothing is saved without **Save**. **Change history** is right under
the note with its last three entries; **Show the whole history** lists the rest. Values and notes are set
in the phone's own font even when the app font is the monospaced one.

- **Repeat**: every N days, weeks (on chosen weekdays), months or years; a monthly task on a day of
  the month, the last day, or an nth weekday ("the 2nd Tuesday", "the last Friday"); counted from the
  due date or from the day you complete it; ending never, on a day or after a number of times. A day
  the month lacks (the 31st in April) falls on its last day.
- **Checklist**: items in order; ticking them does not complete the task, and the next occurrence of
  a repeating task starts with every item unticked.
- **Reminders**: the defaults from Settings, none, or the task's own: minutes before the due time, or
  a time on the due day or days before (at most five).
- **Project** picks the task's one project, or none ([projects.md](projects.md)).
- **Move to trash** keeps the task for 30 days. A task in the trash is read only until you restore it.
- **Change history** lists who changed what, newest first: you in the app, you with `dayhand`, or an
  agent by name.

When an agent works on a task, the details show it: "agent: *name* works until *time*" while its
claim lasts, the acceptance criteria with the met ones ticked, and, under the status, the proof the task
was completed with ([agent work](agent-work.md)). Your own changes always go through, claim or not.

## Trash

Tasks you or an agent deleted, newest first, with the day each one goes for good. **Restore** brings
one back; it works offline too.

## Reminders and the morning summary

Reminders are worked out on the phone from its copy of the plan, so they ring without a network and
without a server.

- A task rings when it has a day and is not done or archived: for each of its own reminders, or the
  default ones from Settings when it has none. Minutes before the due time need a time; a time of day
  ("18:00 the day before") also works for tasks without one.
- **Overdue tasks never ring**; they wait at the top of Today. A reminder that would come more than 15
  minutes late (phone off, battery saving) is dropped.
- The **morning summary** comes every day at the summary time (05:00 unless you change it): how many
  tasks today, how many overdue and where to start. It is quiet, so it waits on the lock screen.
- Times are read in the time zone that decides "today": the phone's own on this phone only, the
  server's when connected, so the phone and your agents agree.
- A reminder's **Done** button completes the task, offline too.

Android 13 and newer ask for permission to show notifications when the first task with a time is
added, or from Settings. For reminders on the minute, also allow **exact alarms** (off by default from
Android 14); Settings → Notifications says which is missing and has a button for each. After a force
stop, Android drops the alarms until you open Dayhand again.

## Connect to your server

**Settings → Server → Connect to my server** (also on the first start, and from a `dayhand://pair` link):

1. **Server address**: your server's address, such as `https://<deployment>.convex.site`. A link or QR
   code fills it in. A `.convex.cloud` address is turned into its `.convex.site` one.
2. **Pairing code** from `dayhand pair` on a computer signed in to that server. Case and dashes do not
   matter, and `O` is read as `0`, `I` and `L` as `1`.
3. **Connect**. Errors are said in words: a wrong, used or expired code, too many wrong codes (with the
   wait), no network, a server that cannot be reached or is not a Dayhand server.

Scanning the QR code that `dayhand pair` prints opens the form filled in. After connecting, every
change made on the phone is sent in order, the tasks made before included (sample tasks stay behind),
and the server's plan comes down.

- Release builds of the app connect over **HTTPS only**. A server on your computer needs
  `tailscale serve` in front of it ([Phone and computer](deploy.md#phone-and-computer-tailscale)).
- A code for **another server** than the one whose plan is on the phone first asks **Replace the plan
  on this phone?**, with how many tasks and waiting changes would go. **Cancel** keeps everything.
- **Disconnect** (Settings → Server) forgets the sign-in on the phone and keeps the plan. The phone
  cannot sign itself out on the server; the dialog names `dayhand revoke <deviceId>` for that.
- When the server revokes the phone, Today and Settings say so, and Connect asks for a new code. Tasks
  and waiting changes stay on the phone.

How the app signs in and stays signed in: [Phone pairing](pairing.md).

## Settings

- **Appearance**: theme (system, light or dark), a colour palette for each of dark and light, the
  font, and the language (the phone's, or one of the eight). Changes apply at once.
- **Notifications**: whether notifications and exact alarms are allowed, the morning summary time and
  the default reminders (at the due time, 5, 10, 15 or 30 minutes, 1 or 2 hours or a day before, any
  number of them).
- **Data**: the backup file, removing sample tasks and, with a server, **Export** (the whole plan as
  Markdown or JSON with its history) and **Calendar**, the read-only address for Google or Apple
  Calendar ([calendar feed](calendar.md)): turn it on, copy it, add it to a calendar app, **Create a
  new address** or **Turn off**. The address is a secret; anyone who has it can read your dated tasks.
  **Export .ics** shares a one-time calendar file.
- **Connection**: **Server** (status, waiting changes, the server's time zone with **Use this phone's
  time zone** when they differ, Disconnect), **Agent connections** and **Agents** ([below](#agents-and-connections)).
- **About**: the licences and the version.

The summary time and default reminders are server settings once connected, so your agents see them too.

## Agents and connections

With a server, two pages under Settings → Connection keep you in charge of your agents:

- **Agent connections** lists the agents connected with OAuth, such as the Claude app, with where they
  come from, whether they may change tasks and when they were last used. Tap one to disconnect it.
  **Approve a connection** takes the code that an agent's sign-in page shows, then shows who asks, where
  the answer goes and how long ago it asked, with a switch per permission. Approve only a sign-in page
  you opened yourself. The steps for the Claude app: [Claude apps](oauth.md#connecting-the-claude-app-manual-procedure).
- **Agents** has **Pause agents**, one switch that refuses every change from every agent while they can
  still read; the **approval requests** waiting for you, each with what the agent wants to do and the
  options it offers; the **proposals** agents and integrations made, to accept, merge into a task or
  reject; and the **tool policies** of your agent keys ([phone controls](../android/README.md#screens)).

While the app is closed, the phone looks for new approval requests every 15 minutes and shows a
notification for each. There is no push service in between, so a request can wait up to about 15
minutes, longer in battery saving, before the phone shows it. What these controls do and what they
cannot do: [Agents and you](agents.md).

## Backups

Android's Auto Backup is off for Dayhand: the plan, the settings and the sign-in go neither to Google
Drive nor to a new phone. On this phone only, a backup file is the only copy outside the phone.

**Settings → Data → Backup** saves the plan as a file in Dayhand's JSON export format (**Save a backup
file** or **Share a backup**) and restores one (**Restore from a file**). The same file can be imported
into a server with `dayhand import`. Restoring adds the tasks from the file that the phone does not
have yet, so the same file restores once.

## Privacy

The app asks for the network (to reach your server), notifications, exact alarms and starting after a
reboot (to arm reminders again). It has no analytics, no crash reporting and no other outside services:
the only address it talks to is your server. The sign-in to the server is encrypted with a key in the
Android Keystore. More: [Security and privacy](security.md).
