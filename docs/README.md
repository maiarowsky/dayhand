# Dayhand documentation

Dayhand is a task list and day plan for people who run a business on their own, and for the AI
agents that work for them. The plan lives on your phone, your Mac and your Linux desktop and works
offline there; a server you run yourself keeps the copies in step and lets your agents add, plan
and finish tasks over MCP or the `dayhand` command line. Every change says who made it.

All of it is free and open source under the Apache License 2.0: the apps, the command line, the server
and these docs. There is nothing to buy and no account to create.

These pages are published at [dayhand.dev/docs](https://dayhand.dev/docs/) and kept in the
repository as `docs/*.md`. They describe what is in the `main` branch, not a published release.
`dayhand version` shows the CLI and server versions; each app shows its version under About.

## What Dayhand is made of

```text
 Android app ─┐                                       ┌─ /mcp      MCP for agents and dayhand
 macOS app ───┤  each keeps its own copy and an       │
 Linux app ───┤  outbox of changes, works offline ──> │  /api/v1   REST API, webhooks, import
              │                                       │
 dayhand ─────┤  command line and dayhand ui ───────> │  /auth     phone pairing and app sign-in
 AI agents ───┘  MCP, or dayhand with --json ───────> │  /cal      read-only calendar feed
                                                      └─ your own Dayhand server (Convex)
```

- **The plan.** Tasks with a day and an optional time, repeats, checklists, labels, links, reminders
  and a note. One task can be the *now* task, with a note of where you stopped. Today shows what is
  overdue, the now task, today and what you finished today; the board has three columns (to do, in
  progress, done); deleted tasks wait 30 days in the trash. Every task has a number (`#42`) that is
  never given to another task.
- **The apps.** [Android](android.md), [macOS](macos-app.md) and [Linux](linux.md) each keep the plan
  on the device, work offline and queue changes to send to the server in order when it can be reached.
  The command line (`dayhand`) and [terminal UI](terminal.md) (`dayhand ui`) need the server; they do
  not keep an offline plan or queue changes.
- **The server.** There is no hosted Dayhand service. You run the backend yourself: on your
  computer with one command, or on your own free Convex account ([your own server](deploy.md)). The
  Android, macOS and Linux apps also work with no server at all.
- **The agents.** Any MCP client, or any agent that runs shell commands, works on the same plan
  with its own key. Its changes are signed `agent: <name>`. Tasks can carry acceptance criteria and
  a plan, agents claim tasks for a while and finish them with proof ([agents](agents.md)).
- **You in charge.** Agents ask before risky steps and you answer on the phone, one switch pauses
  every agent, a policy per key allows, asks for or denies each tool, work nobody asked for waits
  in an inbox, and a health report shows what needs a look.

## Where to start

| You want to | Read |
|---|---|
| Try Dayhand on one computer in ten minutes | [Quick start](getting-started.md) |
| Install an app or the command line | [Install](install.md) |
| Use the phone app | [Android](android.md) |
| Use the Mac or Linux app | [macOS](macos-app.md), [Linux and Omarchy](linux.md) |
| Work in the terminal | [Terminal: dayhand ui](terminal.md), [command reference](cli.md) |
| Let an AI agent work on your plan | [Agents and you](agents.md), [MCP endpoint](mcp.md) |
| Connect the Claude apps | [Claude apps (OAuth)](oauth.md) |
| Run, update and back up your server | [Your own server](deploy.md) |
| Connect another tool | [REST API](api.md), [webhooks](webhooks.md), [calendar feed](calendar.md) |
| Know what is stored where and who can read it | [Security and privacy](security.md) |
| Fix something that does not work | [FAQ and troubleshooting](faq.md) |
| Change Dayhand itself | [Contributing](contributing.md), [architecture](architecture.md) |

## What exists and what is planned

Everything in these pages can be built and run from the source today. Nothing is published as a
package or a signed download yet:

| Piece | Today | Planned |
|---|---|---|
| `dayhand` CLI and `dayhand ui` | build from source (macOS, Linux, Windows) | npm and Homebrew, coming soon |
| Android app | build it yourself | a signed APK on GitHub Releases and Google Play, coming soon |
| Dayhand for macOS | build from source, runs on the Mac that built it | a signed, notarized download with updates, coming soon |
| Dayhand for Linux | Arch Linux and Omarchy package built from the repository; CMake elsewhere | no AUR package yet |
| iPhone and iPad | in development; nothing to install yet | an iOS app on the same backend |
| Windows desktop app | none; the CLI works on Windows with a server on Convex | |
| Backlog.md import and export | not in `main` | planned |

Pages that describe a planned piece say so where it matters, and give no command for it.

## Help and feedback

Dayhand is a personal open source project (Apache-2.0) with no hosted service and no support promise.
Issues on [GitHub](https://github.com/maiarowsky/dayhand/issues) are for bugs you can reproduce and for
feature ideas. Security problems go privately, never in an issue: see [security](security.md#reporting-a-problem).

The project was called Helm until backend 0.9.0 and CLI 0.10.0, and some old names keep working
with a warning ([renamed from Helm](rename.md)). The repository moved from `maiarowsky/helm` to
`maiarowsky/dayhand`; the old addresses redirect.
