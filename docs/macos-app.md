# Dayhand for macOS

Dayhand for macOS has Today, quick add from the menu bar or a global shortcut, task details with
their change history, the trash, reminders and the morning summary as notifications, and works
offline like the phone. It runs on macOS 13 or newer, in English, Polish, German, Spanish, French,
Brazilian Portuguese, Japanese or Simplified Chinese.

It is built from source and is not signed for other Macs yet: [Install](install.md#macos). How the
app is built and tested: [macos/README.md](../macos/README.md). Signing, notarization and the update
feed for a release: [macos.md](macos.md).

## Connect, or keep the plan on this Mac

On the first start, connect to your server with a code from `dayhand pair`: type the server's address
and the code, or open the `dayhand://pair?…` link that `dayhand pair` prints (the Mac hands it to
Dayhand). **Not now** keeps everything on this Mac until you connect; what you add before is sent then.

**Disconnect** forgets the sign-in on this Mac and keeps the plan; `dayhand revoke <deviceId>` ends it
on the server. When the server revokes the Mac, Today says so, and the tasks and waiting changes stay.

## The window

A sidebar on the left switches between **Today** and **Trash** and lists their tasks; the selected
task's details are on the right.

- **Today**: overdue (with **To today**), **Now** with "where I stopped", today (timed tasks first, by
  time) and done today, folded. One click ticks a task off. The context menu makes a task the one you
  work on now, moves it to today or tomorrow, archives it or moves it to the trash.
- **Task details**: title, status, "working on it now" with the resume note, the day and time (a date
  phrase, **Today**, **No day**, **Remove the time**), labels, the checklist and the note. Links are shown.
  For repeat and reminder editors and read-only agent work, see [Mac app features](../macos/README.md).
- **History** at the bottom of the details: who changed the task (you in the app, you with `dayhand`,
  or an agent by name) and when, each field from its old value to the new one. It comes from the
  server; offline, the last copy stays.
- **Trash**: deleted tasks, newest first, with the day each was deleted and the day it goes for good.
  **Restore** works offline. The server keeps deleted tasks for 30 days.

## Quick add

Quick add is at the top of Today, in the menu bar, and in a floating panel from any app with
**⌃⌥N** (change the shortcut in Settings). A date phrase at the end of the line sets the day and time:
"Call the accountant fri 2pm", "Pay rent the 1st", "Plan next week". The line below the field says
what was understood; **Keep in title** keeps the words as text. Without a phrase, the task is for
today. The phrases are English in every language ([dates](cli.md#topic-dates)).

## Menu bar

The menu bar icon shows how many tasks are open today, with a warning mark when some are overdue. Its
menu has quick add and today's open tasks to tick off without opening the window. Closing the window
keeps Dayhand in the menu bar, so reminders keep coming.

## Reminders and the morning summary

Reminders and the morning summary are macOS notifications, worked out on the Mac from its copy of the
plan with the same rules as the phone, in the time zone of the server's settings (this Mac's until a
server has sent them). Overdue tasks never ring. The summary is quiet and waits in Notification Center.
A reminder's **Done** completes the task. Dayhand asks for permission when the first reminder is
planned, or from Settings. Editing the summary time and default reminders:
[Mac notification settings](../macos/README.md).

## Language

Dayhand follows the Mac's languages. **Settings → General → Language** picks one of the eight, and the
windows change at once; the menus that come with macOS follow after **Restart Dayhand**.

## Updates

The app has an updater (Sparkle) with its own window and **Settings → Updates**. It works only in a
build signed with the project's release key, and none is published yet: a build you made yourself says
"Updates aren't available in this build" and never checks. Update it by pulling the repository and
building again.

## How it stays in sync

Every change goes into the Mac's database and an outbox at once, so the window never waits for the
network. Task sync and plan-health refresh rules: [Mac sync behavior](../macos/README.md#how-it-works).

| What | Where |
|---|---|
| Tasks and the outbox | `~/Library/Application Support/Dayhand/dayhand.sqlite` |
| The sign-in to the server | the login Keychain, item `io.github.maiarowsky.dayhand` |
| Preferences (shortcut, window, updates, language) | the defaults domain `io.github.maiarowsky.dayhand` |

`DAYHAND_DATA_DIR=<folder>` uses another database (for a second profile or a test),
`DAYHAND_CREDENTIALS=memory` keeps the sign-in until the app quits, and `DAYHAND_LANG=<code>` starts it
in a language without changing Settings.

## Not on the Mac yet

The remaining features are listed in [What is left for parity](macos.md#what-is-left-for-parity-with-the-android-app).
