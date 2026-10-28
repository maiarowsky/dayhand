// `dayhand help <topic>`: longer explanations that do not belong to one command.
// docs/cli.md includes the same texts.
import { keysText } from "./ui/keys.js";
import { WHEN_EXAMPLES } from "./when/parse.js";

const dates = `Dates (--due, dayhand move, dayhand list --due-before/--due-after, dayhand when)

Dates are English phrases resolved in your time zone from the server settings
(dayhand settings), not the computer's. The same phrase at the same moment always
gives the same day. Try one with: dayhand when "<phrase>", or add --dry-run to a command.

  Days        today (tod), tomorrow (tmr), yesterday, day after tomorrow
  Weekdays    fri, friday, on mon: the first such day after today
              this fri: this week's (today included); next fri: next week's (weeks start on Monday)
  Periods     next week (its Monday), next month (the 1st), next year, weekend, next weekend
              eow / end of week (Sunday), eoww / end of work week (Friday),
              eom / end of month, eoy / end of year
  Relative    in 3 days, in a week, in 2 months, in 1 year, +3d, +2w, +1mo, +1y
              in 2 hours, in 30 min, +3h: a day and a time
  Calendar    23 oct, 23rd of october, oct 23, oct 23 2027, the 15th, 2026-10-23
              (without a year: the next such day, today included)
  Times       14:00, 9:30, 2pm, 2:30 pm, at 9, noon, midnight
              alone: today, or tomorrow once that time has passed
  Together    tomorrow at 9am, fri 14:30, 9am tomorrow, at 3pm on friday, in 3 days at 8:15

A time that does not exist because the clocks go forward (01:30 on the last
Sunday of March in London) moves forward by the gap (to 02:30) with a warning.
YYYY-MM-DD, today and tomorrow are sent to the server as typed; every other
phrase is sent as YYYY-MM-DD (and HH:MM). Anything else is refused (exit 2),
never guessed.

Examples: ${WHEN_EXAMPLES.join(", ")}
`;

const config = `Configuration (config.toml)

The file lives in:
  Linux     $XDG_CONFIG_HOME/dayhand/config.toml (~/.config/dayhand/config.toml)
  macOS     ~/Library/Application Support/dayhand/config.toml
  Windows   %APPDATA%\\dayhand\\config.toml
or in $DAYHAND_CONFIG_DIR. dayhand whoami prints the one in use. dayhand login creates it.

  url = "https://<deployment>.convex.site"     # used when no profile is chosen
  default_profile = "personal"

  [profiles.personal]
  url = "https://<deployment>.convex.site"

  [profiles.work]
  url = "https://<other>.convex.site"

  [aliases]
  home = "list -p Home --status todo,doing"    # dayhand home --json
  week = "list --due-before eow"

  [ui]
  color = "auto"                               # auto, always or never

Precedence. URL: --url, the profile named by --profile, DAYHAND_URL, the profile from
DAYHAND_PROFILE or default_profile, then the top-level url. Key: DAYHAND_API_KEY, then the
key dayhand login stored for that URL. Colors: --color/--no-color, [ui] color,
NO_COLOR/FORCE_COLOR, then whether the output is a terminal.

The API key never goes into this file: dayhand refuses keys named api_key, key,
token, secret or password. An unknown key or a wrong value is an error that names
the file and the key (exit 2). Aliases cannot hide a built-in command.
`;

const login = `Signing in (dayhand login, dayhand logout, dayhand whoami)

  dayhand login --url https://<deployment>.convex.site   # paste the key at the hidden prompt
  dayhand login --with-key < key.txt                     # or pipe it (scripts)
  dayhand whoami                                         # URL, profile, where the key came from
  dayhand logout

dayhand server deploy and dayhand server start make a key of kind cli and sign
in by themselves. For another computer, make one where dayhand is signed in
(dayhand key create laptop --kind cli --scope write) or with
npx convex run apiKeys:create. dayhand login checks it against the server, then stores
it for that URL in the OS keychain: macOS Keychain, Windows Credential Manager or
the Secret Service on Linux (GNOME Keyring, KWallet, KeePassXC). Without one (a
server, Omarchy without a keyring daemon) it says so and keeps the key in
credentials.json next to config.toml, readable only by you (mode 0600).
DAYHAND_CREDENTIAL_STORE=file or --store file chooses the file on purpose.

DAYHAND_API_KEY, when set, wins over the stored key: give agents and CI their own key
(kind agent) that way. The keychain keeps the key out of dotfiles, backups and shell
history; it does not hide it from programs running as you.
`;

const completion = `Shell completion (dayhand completion <shell>)

  bash         echo 'source <(dayhand completion bash)' >> ~/.bashrc
  zsh          dayhand completion zsh > "\${fpath[1]}/_dayhand"     (or source <(dayhand completion zsh) after compinit)
  fish         dayhand completion fish | tee ~/.config/fish/completions/{dayhand,dh}.fish >/dev/null
  PowerShell   dayhand completion powershell | Out-String | Invoke-Expression   (add it to $PROFILE)

Completes commands, aliases from config.toml, options and their values, task
numbers with their titles, project names, profiles and date words. Task
hints come from list_all, projects from list_projects; both are cached for 60 seconds
per server URL and credential in the cache folder (~/.cache/dayhand,
~/Library/Caches/dayhand or %LOCALAPPDATA%\\dayhand\\Cache). Completion never prompts;
server failures omit remote hints but leave local candidates available.
Bash leaves quoted, escaped or expansion-containing prefixes unchanged; start
with an unquoted prefix to complete a project name.
`;

const ui = `The terminal app (dayhand ui)

dayhand ui opens Dayhand full screen in the terminal: Today (overdue, the now task with
its resume note, today, done today), the board, the week (Monday to Sunday as
bars, the selected day in full below) and the trash. Enter opens a task with its
history, which names who made each change: app, cli or agent: <name>. It uses
the key from dayhand login and the same MCP tools as the other commands, refreshes
what is on screen every 12 seconds (--interval) within the key's limits, and
keeps the last data on screen with a red status line when the server cannot be
reached. Colours are the terminal's 16 ANSI colours, so its theme applies.
The mouse selects and scrolls (--no-mouse leaves it to the terminal).

Quick add (a) reads a date phrase at the end or the start of the line:
"Call the accountant fri 2pm +Home". The line below shows how
it was read before Enter adds it; "no date" adds no day, quotes keep it literal.
With backend 0.13.0 or later, the first recognized +project token selects an
existing active project. Names match in any case; hyphens may replace spaces
when unambiguous, but an exact name or id wins. Unknown, ambiguous or archived
project tokens stay in the title and are marked with ? in the preview.

The / filter accepts exact +project tokens with the same name resolution,
including archived projects; +Home does not match Home-office. Remaining text
searches titles, notes and task numbers as before.

${keysText()}

The layout and keys owe a lot to Backlog.md (github.com/MrLesk/Backlog.md, MIT)
and lazygit; no code is taken from either.
`;

export const TOPICS: Record<string, string> = { dates, config, login, completion, ui };
