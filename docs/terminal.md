# Dayhand in the terminal

`dayhand` is two things in one command: plain commands for people, scripts and agents
(`dayhand add`, `dayhand done 3`), and `dayhand ui`, the plan full screen in the terminal. Both use your
server's MCP tools with the key that `dayhand login` stored, so every change shows up in the apps at
once and is signed `cli` in the history. Installing it: [Install](install.md#command-line-dayhand).

## Everyday commands

| To | Run |
|---|---|
| See Today | `dayhand` (or `dayhand today`) |
| Add a task | `dayhand add Call the accountant --due "fri 2pm" -l admin` |
| See every open task | `dayhand list`, `dayhand list -l admin --due-before eow` |
| See the board | `dayhand board` |
| Finish a task | `dayhand done 3` (several at once: `dayhand done 3 4 now`) |
| Move it to another day | `dayhand move 3 "next mon 9am"` (`none` removes the day) |
| Work on it now, and note where you stopped | `dayhand now 3 --note "waiting for the bank"` |
| Read or change its note, checklist or fields | `dayhand note 3`, `dayhand checklist 3`, `dayhand edit 3` |
| See a task with who changed what | `dayhand show 3` |
| Delete and restore | `dayhand rm 3`, `dayhand trash`, `dayhand restore 3` |
| Check what a date phrase means | `dayhand when "in 3 days at 8:15"` |
| Try a change without saving it | add `--dry-run` to the command |

Tasks are referred to by number (`3` or `#3`), `now` for the now task, or their id. Dates are English
phrases in your time zone from the server settings ([dates](cli.md#topic-dates)). Bulk changes
[may ask for confirmation](cli.md#prompts) (or require `--yes` in a script). Every command and option:
[command reference](cli.md), also as `dayhand help <command>` and the manual page `man/dayhand.1`.

## dayhand ui

```sh
dayhand ui
```

It opens full screen with five views: **Today** (a coloured plan-health line, overdue, the now task with its resume note, today, done
today), the **Board** (to do, in progress, done), the **Week** (Monday to Sunday as bars, the selected day
in full below) the **Trash** and **Agents**. `Enter` opens a task with its history, which names who made each change:
`app`, `cli` or `agent: <name>`, so an agent's edits stand out; details also show who claimed the work, the acceptance criteria, plan, proof and what it waits on or is blocked by.

The keys most people need:

| Key | Does |
|---|---|
| `j` `k` (or the arrows) | Next and previous task |
| `h` `l` | Board column, week day |
| `Tab`, `1` `2` `3` `4` `5` | Next view; Today, Board, Week, Trash, Agents |
| `p`, `A`, `X` | In Agents: pause or resume changes; accept or reject a proposal (`Enter` opens a request, a digit picks an option, `Enter` confirms) |
| `a` | Add a task: `Pay rent fri 2pm #home` |
| `Space` or `x` | Done or not done |
| `s` | Start (doing) or stop (to do) |
| `n`, `N` | Make it the now task with a resume note; clear the now task |
| `e`, `E` | Edit title, day, labels and resume note; title and note in `$EDITOR` |
| `m` | Move: `tomorrow`, `fri 9am`, `none` |
| `d`, `u`, `r` | To the trash (asks first), undo, restore |
| `/` | Narrow the task list ([filter syntax](cli.md#topic-ui)) |
| `?`, `q` | Every key; quit |

The full list is `?` in the app, `dayhand help ui` and [the reference](cli.md#topic-ui). The layout and
keys follow vim and lazygit.

- **Quick add** (`a`) previews the line before `Enter` adds it. Date phrases, labels and project tokens
  follow [the quick-add rules](cli.md#topic-ui).
- **The mouse** selects and scrolls. Mouse reporting stops the terminal's own text selection: hold
  `Shift` while dragging to select anyway, or start `dayhand ui --no-mouse`.
- **Refresh**: what is on screen is read again every 12 seconds (`--interval 10` to `300`), within the
  key's limits of 120 reads and 60 changes a minute; `R` refreshes now. Without a connection it keeps the
  last data on screen, says so in red, and tries again.
- **Colours** are the terminal's 16 ANSI colours, so your terminal theme applies.
- **Language**: the screens speak English, Polish, German, Spanish, French, Brazilian Portuguese,
  Japanese or Simplified Chinese, following `--lang`, then `DAYHAND_LANG`, then the locale (`LC_ALL`,
  `LC_MESSAGES`, `LANG`). Date phrases, the other commands, `--json` and error codes stay English.
- `--view week` opens another view first.

`dayhand ui` shows the plan while it is open; it has no reminders. For reminders on a computer, use the
[macOS](macos-app.md) or [Linux](linux.md) app. On Omarchy, a launcher entry and a key make it an app of
its own: [dayhand ui on Omarchy](omarchy.md).

## Several servers and profiles

`dayhand login --url <address>` stores a key per server address. `config.toml` can name profiles and
aliases:

```toml
default_profile = "personal"

[profiles.personal]
url = "https://<deployment>.convex.site"

[profiles.work]
url = "https://<other>.convex.site"

[aliases]
week = "list --due-before eow"
```

`dayhand --profile work`, or `DAYHAND_PROFILE=work`, picks one; `dayhand week` runs the alias.
`dayhand whoami` shows which server, profile, key source and file are in use. Where the file lives and
how the URL and key are chosen: [config](cli.md#topic-config). The key itself never goes into
`config.toml`: `dayhand login` keeps it in the system keychain (macOS Keychain, Windows Credential Manager,
the Secret Service on Linux) or, without one, in a file only you can read ([login](cli.md#topic-login)).

## For scripts

- `--json` prints exactly what the server's tool returns, in a shape described by the
  [schemas](schemas/); `--plain` prints tab-separated rows without headers.
- Errors with `--json` are one JSON line on stderr, and the exit code says what to do next: 2 a usage
  error, 3 no or a wrong key, 4 not found, 5 the server is unavailable or the key made too many calls,
  6 refused by the task's state, 7 refused by the owner ([exit codes](cli.md#exit-codes)).
- After exit 5, run the same command again with the `--client-id` the error names: a change is never
  applied twice ([retries](cli.md#retries)).
- `dayhand` never asks anything without a terminal (`--no-input` or `DAYHAND_NO_INPUT=1` make sure).
- `DAYHAND_URL` and `DAYHAND_API_KEY` win over the stored login, so a script or an agent can use its own
  key ([agents](agents.md)).
